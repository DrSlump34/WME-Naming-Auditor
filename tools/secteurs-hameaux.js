#!/usr/bin/env node
// secteurs-hameaux.js — sur combien de communes WNA applique-t-il le schema 1 ?
//
// POURQUOI (2026-09-16)
// ---------------------
// Vote des Champs `t411162` clos le 14/09 : schema 2, 6-0. Un hameau ou un lieu-dit dote
// de panneaux EB10/EB20 reste HORS agglomeration. Or WNA reclame un polygone par
// « secteur d entrees » (groupe de panneaux) et pre-trace ceux qui forment une surface :
// tout secteur SECONDAIRE y est donc audite comme une agglomeration. Engagement public :
// chiffrer l ampleur AVANT d aligner — pour l annoncer, pas pour choisir.
//
// CE QUE LA MESURE SAIT DIRE, ET CE QU ELLE NE SAIT PAS
// * Secteurs : regroupement IDENTIQUE au script (voir `secteurs`).
// * Principal : le secteur le plus proche de la MAIRIE (comme `trierSecteurs`).
// * Un secondaire a moins de 2 km du centre d une commune ASSOCIEE ou DELEGUEE
//   (geo.api `communes_associees_deleguees`) est une ancienne commune : il garde son
//   polygone dans les deux schemas.
// * Le reste est « hameau OU village » : la difference (centre identifiable, > 200 hab.)
//   ne se lit dans aucune source ouverte. C est un MAJORANT des secteurs a revoir.
//
// Usage : node secteurs-hameaux.js [deps=35,34,56,50] [pas=8] [budget=24]
'use strict';



// Budget de cellules PAR COMMUNE. Celui du script (12) sert a son sondage, qui doit rester
// instantane ; ici on cherche un CHIFFRE, on peut payer plus cher. Trop bas, il gonflerait
// artificiellement les « incertain » et la mesure repondrait a cote.


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


const DEPS = (process.argv[2] || '35,34,56,50').split(',');
const PAS_ECH = Number(process.argv[3] || 8);
const BUDGET_C = Number(process.argv[4] || 24);
const PORTE_FUSION_M = 60, CLUSTER_SEUIL_M = 2000, LARGEUR_MIN_AGGLO_M = 150, ANCIENNE_M = 2000;

const versM = ref => {
    const kx = 111320 * Math.cos(ref.lat * Math.PI / 180), ky = 110540;
    return p => [(p[0] - ref.lon) * kx, (p[1] - ref.lat) * ky];
};
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
}
// Meme regroupement que `proposerPolygones` du script : portes a 60 m, liaison simple a 2 km,
// tracable = >= 3 portes, aire >= 15 % de la boite, largeur moyenne >= 150 m.
function secteurs(panneaux, ref) {
    const proj = versM(ref);
    const portes = [];
    for (const p of panneaux) {
        const m = proj([p.longitude, p.latitude]);
        const prox = portes.find(g => d2(g.m, m) <= PORTE_FUSION_M ** 2);
        if (!prox) portes.push({ m });
    }
    const groupes = [], restant = portes.slice();
    while (restant.length) {
        const g = [restant.shift()];
        let bouge = true;
        while (bouge) {
            bouge = false;
            for (let i = restant.length - 1; i >= 0; i--)
                if (g.some(x => d2(x.m, restant[i].m) <= CLUSTER_SEUIL_M ** 2)) { g.push(restant.splice(i, 1)[0]); bouge = true; }
        }
        groupes.push(g);
    }
    return groupes.map(g => {
        const m = g.map(x => x.m);
        let tracable = false;
        if (m.length >= 3) {
            const h = hull(m);
            if (h.length >= 3) {
                let aire = 0;
                for (let k = 0; k < h.length; k++) { const a = h[k], b = h[(k + 1) % h.length]; aire += a[0] * b[1] - b[0] * a[1]; }
                aire = Math.abs(aire) / 2;
                const lx = Math.max(...h.map(p => p[0])) - Math.min(...h.map(p => p[0]));
                const ly = Math.max(...h.map(p => p[1])) - Math.min(...h.map(p => p[1]));
                let diam = 0;
                for (let a = 0; a < h.length; a++) for (let b = a + 1; b < h.length; b++) diam = Math.max(diam, Math.hypot(h[a][0] - h[b][0], h[a][1] - h[b][1]));
                tracable = aire >= 0.15 * Math.max(1, lx * ly) && diam > 0 && aire / diam >= LARGEUR_MIN_AGGLO_M;
            }
        }
        const c = [m.reduce((s, p) => s + p[0], 0) / m.length, m.reduce((s, p) => s + p[1], 0) / m.length];
        return { portes: g.length, tracable, c };
    });
}

const CLES = ['mes', 'avec', 'multi', 'sec', 'secTr', 'anc', 'aRevoir', 'aRevoirTr', 'communesARevoir', 'communesARevoirTr', 'tronq'];

(async () => {
    const total = Object.fromEntries(CLES.map(k => [k, 0]));
    const parDep = [];
    for (const DEP of DEPS) {
        const gj = await json('https://geo.api.gouv.fr/departements/' + DEP + '/communes?fields=nom,code,contour,mairie&format=geojson&geometry=contour');
        const toutes = (gj.features || []).filter(f => f.geometry).sort((a, b) => String(a.properties.code).localeCompare(String(b.properties.code)));
        const ech = toutes.filter((_, i) => i % PAS_ECH === 0);
        const anciennes = (await json('https://geo.api.gouv.fr/communes_associees_deleguees?codeDepartement=' + DEP + '&fields=nom,code,type,centre'))
            .filter(a => a.centre).map(a => ({ nom: a.nom, pt: a.centre.coordinates }));
        const r = Object.assign({ dep: DEP, exemples: [] }, Object.fromEntries(CLES.map(k => [k, 0])));
        console.log('\n=== ' + DEP + ' : ' + toutes.length + ' communes, ' + ech.length + ' mesurees, ' + anciennes.length + ' communes associees/deleguees ===');
        for (const f of ech) {
            r.mes++;
            const { nom, mairie } = f.properties;
            let pan, tronque;
            try { ({ panneaux: pan, tronque } = await balayer(bboxOf(f.geometry), BUDGET_C)); }
            catch (e) { r.tronq++; console.log('  ' + nom + ' PANNE ' + e.message); continue; }
            if (tronque) r.tronq++;
            const dedans = pan.filter(p => pointInGeom(p.longitude, p.latitude, f.geometry));
            if (!dedans.length) continue;
            r.avec++;
            const ref = mairie ? { lon: mairie.coordinates[0], lat: mairie.coordinates[1] } : { lon: dedans[0].longitude, lat: dedans[0].latitude };
            const proj = versM(ref);
            const secs = secteurs(dedans, ref);
            if (secs.length < 2) continue;
            r.multi++;
            // Principal = le plus proche de la mairie, comme `trierSecteurs`.
            const mz = proj([ref.lon, ref.lat]);
            secs.sort((a, b) => d2(a.c, mz) - d2(b.c, mz));
            const second = secs.slice(1);
            const anc = anciennes.filter(a => pointInGeom(a.pt[0], a.pt[1], f.geometry)).map(a => ({ nom: a.nom, m: proj(a.pt) }));
            let ancN = 0, rev = 0, revTr = 0;
            const pris = new Set();
            for (const s of second) {
                const a = anc.find(x => !pris.has(x.nom) && d2(x.m, s.c) <= ANCIENNE_M ** 2);
                if (a) { pris.add(a.nom); ancN++; continue; }
                rev++; if (s.tracable) revTr++;
            }
            r.sec += second.length; r.secTr += second.filter(s => s.tracable).length;
            r.anc += ancN; r.aRevoir += rev; r.aRevoirTr += revTr;
            if (rev) r.communesARevoir++;
            if (revTr) r.communesARevoirTr++;
            if (rev && r.exemples.length < 6) r.exemples.push(nom + ' (' + rev + ')');
            console.log('  ' + nom.padEnd(26).slice(0, 26) + ' ' + secs.length + ' secteurs, ' + ancN + ' anc. commune(s), ' + rev + ' a revoir (' + revTr + ' pre-traces)' + (tronque ? ' [TRONQUE]' : ''));
        }
        parDep.push(r);
        for (const k of CLES) total[k] += r[k];
    }
    console.log('\n=== RESULTAT (echantillon 1 commune sur ' + PAS_ECH + ') ===');
    console.log('dep | mesurees | avec panneaux | >= 2 secteurs | secondaires (dont pre-traces) | anc. communes | a revoir (dont pre-traces) | communes a revoir (dont pre-trace) | tronquees');
    for (const r of [...parDep, Object.assign({ dep: 'TOTAL' }, total)])
        console.log([r.dep, r.mes, r.avec, r.multi, r.sec + ' (' + r.secTr + ')', r.anc, r.aRevoir + ' (' + r.aRevoirTr + ')', r.communesARevoir + ' (' + r.communesARevoirTr + ')', r.tronq].join(' | '));
    for (const r of parDep) if (r.exemples.length) console.log('  ' + r.dep + ' ex. : ' + r.exemples.join(', '));
    console.log('appels API : ' + appels);
})();
