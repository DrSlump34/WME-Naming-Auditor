#!/usr/bin/env node
// couverture-eb10.js — sur combien de communes le chemin FACILE de WNA est-il ouvert ?
//
// POURQUOI CETTE MESURE (2026-08-28)
// ----------------------------------
// YvesWi a demande a WNA exactement ce que WNA sait deja faire : « le script n est pas en
// mesure de proposer un polygone [...] afin d eviter de tracer ? ». L aide du script
// repond oui — « 🪧 Panneaux d agglomeration : A ESSAYER EN PREMIER », puis « ✏️ Proposer
// un trace » fabrique les polygones. Mais le mode operatoire donne a YvesWi dit l inverse :
// « tu cherches les panneaux avec le bouton, MAIS GENERALEMENT tu va devoir tracer ».
//
// Avant d ecrire le moindre tutoriel il faut donc savoir lequel des deux dit vrai : on
// n enseigne pas un chemin sans savoir s il est ouvert. C est une question de FAIT, elle
// se mesure.
//
// CE QUI EST DEJA CONNU (mesure de l auteur le 23/07, dans le source du script) :
// la source couvre 86 departements sur 101, pas l Ile-de-France. Ce qui n est pas connu,
// c est la couverture COMMUNE PAR COMMUNE a l interieur d un departement servi.
//
// ⚠️ ON REPRODUIT LA SEMANTIQUE DU SCRIPT, pas une approximation : trois etats, et
// « aucun panneau » n est PAS confondu avec « je n ai pas pu voir ». La reponse de l API
// est plafonnee a 500 items et les B14 (limitations de vitesse) saturent le quota bien
// avant les EB10 : sans le decoupage adaptatif on perdrait des panneaux EN SILENCE, et on
// annoncerait une couverture trop basse avec l aplomb d une mesure.
'use strict';

const DEP = process.argv[2] || '35';
const PAS = Number(process.argv[3] || 5);   // 1 commune sur PAS, par code INSEE croissant
// Budget de cellules PAR COMMUNE. Celui du script (12) sert a son sondage, qui doit rester
// instantane ; ici on cherche un CHIFFRE, on peut payer plus cher. Trop bas, il gonflerait
// artificiellement les « incertain » et la mesure repondrait a cote.
const BUDGET = Number(process.argv[4] || 24);

// Emprise d une requete, MESUREE par l auteur le 23/07 sur Carcassonne (elle n est pas
// documentee par l API) : elle se divise par deux a chaque niveau de zoom.
const DEMI_LAT_Z13 = 0.1651, DEMI_LON_Z13 = 0.2240;
const Z_DEPART = 13, Z_MAX = 16, PLAFOND = 500;
const demiEmprise = z => {
    const k = Math.pow(2, Z_DEPART - z);
    return { dLat: DEMI_LAT_Z13 * k, dLon: DEMI_LON_Z13 * k };
};

const dors = ms => new Promise(r => setTimeout(r, ms));

async function json(url, essais = 3) {
    for (let i = 0; i < essais; i++) {
        try {
            const r = await fetch(url, { headers: { 'User-Agent': 'WNA-mesure-couverture/1.0' } });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.json();
        } catch (e) {
            if (i === essais - 1) throw e;
            await dors(800 * (i + 1));
        }
    }
}

// ── Geometrie : point dans polygone (repris du script, meme logique) ────────
function pointInRing(lon, lat, ring) {
    let dedans = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) dedans = !dedans;
    }
    return dedans;
}
function pointInRings(lon, lat, rings) {
    if (!rings || !rings.length || !pointInRing(lon, lat, rings[0])) return false;
    for (let i = 1; i < rings.length; i++) if (pointInRing(lon, lat, rings[i])) return false;
    return true;
}
function pointInGeom(lon, lat, geom) {
    if (!geom) return false;
    if (geom.type === 'Polygon') return pointInRings(lon, lat, geom.coordinates);
    if (geom.type === 'MultiPolygon') return geom.coordinates.some(p => pointInRings(lon, lat, p));
    return false;
}
function bboxOf(geom) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const p = co => {
        if (typeof co[0] === 'number') {
            if (co[0] < a) a = co[0]; if (co[0] > c) c = co[0];
            if (co[1] < b) b = co[1]; if (co[1] > d) d = co[1];
        } else co.forEach(p);
    };
    p(geom.coordinates);
    return [a, b, c, d];
}

// ── Cellules : cache partage, les communes voisines interrogent les memes ───
const cache = new Map();
let appels = 0;

async function cellule(lat, lon, zoom) {
    const cle = lat.toFixed(4) + '|' + lon.toFixed(4) + '|' + zoom;
    if (cache.has(cle)) return cache.get(cle);
    appels++;
    const d = await json('https://api.wazefrance.com/rs?lat=' + lat + '&lon=' + lon + '&zoom=' + zoom);
    const liste = (d && d.rs) || [];
    const res = { liste, sature: liste.length >= PLAFOND };
    cache.set(cle, res);
    await dors(120);            // politesse : on n a aucune raison de marteler
    return res;
}

// Balaye une bbox, en redecoupant toute cellule saturee — c est le decoupage adaptatif
// du script. Rend les panneaux vus et un drapeau « la mesure est-elle complete ».
async function balayer(bbox, budget) {
    const vus = new Map();
    let tronque = false, cellules = 0;
    const aFaire = [];
    {
        const { dLat, dLon } = demiEmprise(Z_DEPART);
        const pasLat = dLat * 1.8, pasLon = dLon * 1.8;
        const nLat = Math.max(1, Math.ceil((bbox[3] - bbox[1]) / pasLat));
        const nLon = Math.max(1, Math.ceil((bbox[2] - bbox[0]) / pasLon));
        for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++)
            aFaire.push({ lat: bbox[1] + (i + 0.5) * (bbox[3] - bbox[1]) / nLat,
                          lon: bbox[0] + (j + 0.5) * (bbox[2] - bbox[0]) / nLon, zoom: Z_DEPART });
    }
    while (aFaire.length) {
        if (cellules >= budget) { tronque = true; break; }
        const { lat, lon, zoom } = aFaire.shift();
        cellules++;
        const { liste, sature } = await cellule(lat, lon, zoom);
        for (const p of liste) {
            if (p.panneau_code !== 'EB10' && p.panneau_code !== 'EB20') continue;
            vus.set([p.latitude.toFixed(5), p.longitude.toFixed(5), p.panneau_code].join('|'), p);
        }
        // Saturee : les EB10 ont pu etre evinces par les B14. On redecoupe en 4.
        if (sature && zoom < Z_MAX) {
            const { dLat, dLon } = demiEmprise(zoom + 1);
            for (const sl of [-1, 1]) for (const so of [-1, 1])
                aFaire.push({ lat: lat + sl * dLat, lon: lon + so * dLon, zoom: zoom + 1 });
        } else if (sature) {
            tronque = true;   // sature au zoom max : on ne pretend pas avoir tout vu
        }
    }
    return { panneaux: [...vus.values()], tronque };
}

(async () => {
    console.log('\n=== Couverture EB10/EB20 — departement ' + DEP + ', 1 commune sur ' + PAS + ' ===\n');
    const gj = await json('https://geo.api.gouv.fr/departements/' + DEP +
        '/communes?fields=nom,code,contour&format=geojson&geometry=contour');
    const toutes = (gj.features || []).filter(f => f.geometry);
    toutes.sort((a, b) => String(a.properties.code).localeCompare(String(b.properties.code)));
    // Echantillon REPRODUCTIBLE : un pas regulier sur le code INSEE, pas un tirage au sort.
    // Le code INSEE suit l ordre alphabetique des communes, l echantillon est donc reparti.
    const ech = toutes.filter((_, i) => i % PAS === 0);
    console.log(toutes.length + ' communes dans le departement, ' + ech.length + ' mesurees.\n');

    const res = { des: [], aucun: [], incertain: [] };
    for (let i = 0; i < ech.length; i++) {
        const f = ech[i];
        const nom = f.properties.nom, code = f.properties.code;
        let etat, nb = 0;
        try {
            const { panneaux, tronque } = await balayer(bboxOf(f.geometry), BUDGET);
            const dedans = panneaux.filter(p => pointInGeom(p.longitude, p.latitude, f.geometry));
            nb = dedans.length;
            etat = nb ? 'des' : (tronque ? 'incertain' : 'aucun');
        } catch (e) {
            etat = 'incertain';
        }
        res[etat].push({ nom, code, nb });
        process.stdout.write('  [' + String(i + 1).padStart(3) + '/' + ech.length + '] ' +
            nom.padEnd(28).slice(0, 28) + ' ' + etat.padEnd(10) + (nb ? nb + ' panneau(x)' : '') + '\n');
    }

    const n = ech.length;
    const pc = x => (100 * x / n).toFixed(0) + ' %';
    console.log('\n=== RESULTAT ===');
    console.log('  communes avec au moins un EB10/EB20 : ' + res.des.length + ' / ' + n + '  (' + pc(res.des.length) + ')');
    console.log('  aucun panneau, mesure COMPLETE      : ' + res.aucun.length + ' / ' + n + '  (' + pc(res.aucun.length) + ')');
    console.log('  incertain (mesure tronquee/panne)   : ' + res.incertain.length + ' / ' + n + '  (' + pc(res.incertain.length) + ')');
    const nbs = res.des.map(x => x.nb).sort((a, b) => a - b);
    if (nbs.length) console.log('  panneaux par commune servie : median ' + nbs[Math.floor(nbs.length / 2)] +
        ', min ' + nbs[0] + ', max ' + nbs[nbs.length - 1]);
    console.log('  appels API : ' + appels);
    if (res.aucun.length) console.log('\n  Sans aucun panneau : ' +
        res.aucun.slice(0, 12).map(x => x.nom).join(', ') + (res.aucun.length > 12 ? '…' : ''));
    console.log('');
})();
