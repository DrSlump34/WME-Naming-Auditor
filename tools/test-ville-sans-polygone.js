/**
 * Tests du GARDE-FOU « ville sans polygone » — chantier fonctionnel de l'audit.
 *
 * C'est le garde-fou le plus important du script : une ville portee par le NOM
 * PRINCIPAL veut dire « je suis en agglomeration ». Si aucun segment qui l'annonce
 * ne tombe dans un polygone, c'est qu'il en manque un — et sans alerte, le script
 * reclame le RETRAIT de la ville sur tous ces segments : des corrections A
 * L'ENVERS, exactement ce que tout le reste cherche a eviter.
 *
 * ⚠️ Fonctions EXTRAITES du userscript. `lastScan` et `options` sont injectes.
 *
 * Usage : node tools/test-ville-sans-polygone.js
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

function extraire(nom) {
  const i = src.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let prof = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, j + 1);
}

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else {
    ko++;
    lignes.push('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) +
                '\n          obtenu  ' + JSON.stringify(obtenu));
  }
}

/** Monte les deux fonctions avec un `lastScan` fabrique. */
function monter(villes, interrompu, seuil) {
  const lastScan = { interrompu: !!interrompu, zones: { villes: new Map(Object.entries(villes)) } };
  const options = { seuil: seuil === undefined ? 0.8 : seuil };
  // ⚠️ La constante est RELUE dans le source, pas recopiee : une valeur figee ici
  // testerait autre chose que ce qui tourne.
  const mc = src.match(/const\s+PART_MIN_EN_POLYGONE\s*=\s*([^;]+);/);
  if (!mc) throw new Error('constante PART_MIN_EN_POLYGONE introuvable');
  const code = 'const PART_MIN_EN_POLYGONE = ' + mc[1] + ';\n' +
               extraire('villesSansPolygone') + '\n' + extraire('bandeauVillesSansPolygone') +
               '\nreturn { villesSansPolygone, bandeauVillesSansPolygone };';
  // `esc` est appele par le bandeau : on fournit le vrai comportement attendu.
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return new Function('lastScan', 'options', 'esc', code)(lastScan, options, esc);
}

console.log('\n=== Garde-fou « ville sans polygone » ===\n');

// 1. Cas d'ecole, celui de la v1.97 (Les Ayguades retirees) : une ville portee
//    par 27 segments, aucun dans un polygone.
let api = monter({ 'Les Ayguades': { total: 27, dansPolygone: 0 } });
let r = api.villesSansPolygone();
verifier('1. aucun segment en polygone — signalee', r.length, 1);
verifier('1. degre « aucun »', r[0] && r[0].degre, 'aucun');
verifier('1. le compte est juste', r[0] && r[0].total, 27);
let b = api.bandeauVillesSansPolygone();
verifier('1. le bandeau AFFIRME qu\'il manque un polygone',
         /Il manque au moins un polygone/.test(b), true);
verifier('1. le bandeau avertit du sens des corrections',
         /mauvais sens/.test(b), true);

// 2. Ville entierement couverte : rien a signaler.
api = monter({ Coursan: { total: 40, dansPolygone: 40 } });
verifier('2. tout en polygone — aucune alerte', api.villesSansPolygone().length, 0);
verifier('2. bandeau vide', api.bandeauVillesSansPolygone(), '');

// 3. Majoritairement couverte (debord normal d'un polygone) : pas d'alerte.
api = monter({ Coursan: { total: 40, dansPolygone: 36 } });
verifier('3. 36/40 en polygone — aucune alerte', api.villesSansPolygone().length, 0);

// 4. ⚠️ LE CAS QUE L'ANCIEN TEST LAISSAIT PASSER : 1 segment sur 27 dans le
//    polygone. « aucun » etait faux, donc silence — et 26 segments recevaient
//    quand meme des corrections a l'envers.
api = monter({ 'Les Ayguades': { total: 27, dansPolygone: 1 } });
r = api.villesSansPolygone();
verifier('4. 1/27 en polygone — signalee quand meme', r.length, 1);
verifier('4. degre « presque » (polygone trop petit)', r[0] && r[0].degre, 'presque');
verifier('4. le bandeau dit « probablement trop petit »',
         /trop petit/.test(api.bandeauVillesSansPolygone()), true);

// 5. Le garde-fou a SON seuil (25 %), distinct de celui du rattachement.
//    ⚠️ Verrou de non-regression : `1 - options.seuil` avait ete branche la par
//    elegance, et il INVERSAIT la logique — un seuil de rattachement plus
//    exigeant (90 %) rendait l'alerte moins sensible (10 %). Ces trois tests le
//    figent : le verdict ne doit pas bouger avec le seuil de rattachement.
api = monter({ X: { total: 27, dansPolygone: 12 } }, false, 0.6);   // 44 % en polygone
verifier('5. 44 % en polygone — pas d\'alerte', api.villesSansPolygone().length, 0);
api = monter({ X: { total: 27, dansPolygone: 5 } }, false, 0.6);    // 18 % en polygone
verifier('5. 18 % en polygone — alerte', api.villesSansPolygone().length, 1);
const a60 = monter({ X: { total: 27, dansPolygone: 5 } }, false, 0.6).villesSansPolygone().length;
const a90 = monter({ X: { total: 27, dansPolygone: 5 } }, false, 0.9).villesSansPolygone().length;
verifier('5. insensible au seuil de rattachement (60 % vs 90 %)', [a60, a90], [1, 1]);

// 6. ⚠️⚠️ ANALYSE INTERROMPUE : le constat n'est pas fiable (les segments en
//    polygone peuvent etre justement ceux qui n'ont pas ete vus). Meme doctrine
//    que les cartouches, qui ne concluent pas sur un recensement partiel.
api = monter({ 'Les Ayguades': { total: 27, dansPolygone: 0 } }, true);
b = api.bandeauVillesSansPolygone();
verifier('6. interrompue — la liste reste utile', api.villesSansPolygone().length, 1);
verifier('6. interrompue — n\'AFFIRME plus qu\'il manque un polygone',
         /Il manque au moins un polygone/.test(b), false);
verifier('6. interrompue — dit que le constat n\'est pas fiable',
         /n&#39;est pas fiable|pas fiable/.test(b), true);
verifier('6. interrompue — invite a relancer en entier',
         /Relance l&#39;analyse en entier|Relance l'analyse en entier/.test(b), true);

// 7. Classement : la ville la plus portee d'abord (c'est la plus urgente).
api = monter({ Petite: { total: 3, dansPolygone: 0 },
               Grande: { total: 30, dansPolygone: 0 } });
verifier('7. triee par nombre de segments décroissant',
         api.villesSansPolygone().map(v => v.nom), ['Grande', 'Petite']);

// 8. Un nom de ville venu de Waze est ECHAPPE dans le bandeau (il vient de
//    l'exterieur : n'importe quel editeur peut nommer une ville).
api = monter({ '<img src=x onerror=alert(1)>': { total: 5, dansPolygone: 0 } });
b = api.bandeauVillesSansPolygone();
verifier('8. le nom de ville est echappe', /<img/.test(b), false);
verifier('8. et rendu lisible', /&lt;img/.test(b), true);

// 9. Aucun scan : pas d'alerte, pas d'erreur.
const vide = new Function('lastScan', 'options', 'esc',
  extraire('villesSansPolygone') + '\nreturn villesSansPolygone;')(null, { seuil: 0.8 }, String);
verifier('9. sans analyse — liste vide', vide(), []);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
