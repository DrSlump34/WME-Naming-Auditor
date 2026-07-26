/**
 * Tests du ZONAGE — chantier fonctionnel de l'audit.
 *
 * ⚠️ Les fonctions ne sont PAS recopiees : elles sont EXTRAITES du userscript et
 * evaluees telles quelles. Une copie divergerait au premier correctif et le test
 * passerait au vert sur du code qui n'est plus celui qui tourne.
 *
 * Chaque cas est construit pour que la reponse attendue soit calculable A LA
 * MAIN : carres, traversees a moitie, chevauchements de surface connue.
 *
 * Usage : node tools/test-zonage.js
 */
'use strict';
const fs = require('fs');

const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

/** Extrait le texte d'une fonction nommee, accolades equilibrees. */
function extraire(nom) {
  const i = src.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let prof = 0, j = src.indexOf('{', i);
  const debut = j;
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, j + 1);
}

// ⚠️ `partCote` doit etre extraite AVANT `partDedans`, qui l'appelle.
const NOMS = ['pointInRing', 'pointInRings', 'pointInGeom', 'longueur', 'partCote', 'partDedans'];
const code = NOMS.map(extraire).join('\n\n');
// ⚠️ Les constantes dont dependent ces fonctions sont RELUES dans le source, pas
// recopiees : une valeur figee ici testerait autre chose que ce qui tourne.
const CONSTANTES = ['PROF_SUBDIV'].map(n => {
  const m = src.match(new RegExp('const\\s+' + n + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('constante introuvable : ' + n);
  return 'const ' + n + ' = ' + m[1] + ';';
}).join('\n');
const ctx = {};
new Function('ctx', CONSTANTES + '\n' + code + '\n' +
             NOMS.map(n => `ctx.${n}=${n};`).join('')).call(null, ctx);
const { pointInRing, pointInRings, pointInGeom, longueur, partDedans } = ctx;

// ── outils de test ─────────────────────────────────────────────────────────
let ok = 0, ko = 0;
const messages = [];
function verifier(titre, obtenu, attendu, tolerance) {
  const t = tolerance === undefined ? 1e-9 : tolerance;
  const bon = typeof attendu === 'number'
    ? Math.abs(obtenu - attendu) <= t
    : obtenu === attendu;
  if (bon) { ok++; messages.push('  ok   ' + titre); }
  else { ko++; messages.push('  ECHEC ' + titre + '\n         attendu ' + attendu + ', obtenu ' + obtenu); }
}
function note(titre, texte) { messages.push('  ~~   ' + titre + ' : ' + texte); }

// Carre de 1 degre, coin bas-gauche a (0,0). Anneau FERME.
const CARRE = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];

console.log('\n=== 1. pointInRing : appartenance ===');
verifier('centre dedans', pointInRing(0.5, 0.5, CARRE), true);
verifier('nettement dehors', pointInRing(2, 2, CARRE), false);
verifier('juste dedans (0,999)', pointInRing(0.999, 0.5, CARRE), true);
verifier('juste dehors (1,001)', pointInRing(1.001, 0.5, CARRE), false);
// Un point pile sur la frontiere est indetermine par nature (ray casting) :
// on le CONSTATE sans en faire un echec, mais il faut le savoir.
note('point pile sur le bord vertical x=1', 'rend ' + pointInRing(1, 0.5, CARRE) +
     ' (indetermine par nature — ne jamais s\'appuyer dessus)');
note('point pile sur un sommet (0,0)', 'rend ' + pointInRing(0, 0, CARRE));

console.log('\n=== 2. longueur : approximation equirectangulaire ===');
// A la latitude 43 (Aude), 1 degre de longitude ~ cos(43) degre de latitude.
const l = longueur([3, 43], [4, 43]);
verifier('1 deg de longitude a lat 43 = cos(43)', l, Math.cos(43 * Math.PI / 180), 1e-6);
verifier('1 deg de latitude = 1', longueur([3, 43], [3, 44]), 1, 1e-9);
// Comparaison a la vraie distance (Haversine) sur 1 km : l'ecart doit etre infime
function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const A = [3.0, 43.2], B = [3.01, 43.21];
const rapport = (longueur(A, B) * 111320) / haversine(A, B);
// 0,15 % d'ecart : c'est l'approximation equirectangulaire, et elle est SANS
// consequence ici — on ne compare que des longueurs entre elles, l'erreur
// s'applique au numerateur comme au denominateur.
verifier('coherente avec Haversine a 0,2 % pres', rapport, 1, 0.002);

console.log('\n=== 3. partDedans : part de longueur dans une zone ===');
const dansCarre = (x, y) => pointInRing(x, y, CARRE);
// Segment horizontal de x=-1 a x=1, a mi-hauteur : exactement la moitie dedans.
// ⚠️ Extremite pile sur la frontiere (x=1) : `pointInRing` la dit dehors, donc
// les DEUX bouts sont « dehors ». Avant la v2.08 le cote etait ignore (0 %) ;
// la subdivision de `partCote` retrouve desormais la moitie.
let r = partDedans([[-1, 0.5], [1, 0.5]], dansCarre);
verifier('traversee finissant PILE sur la frontiere : 50 %', r.dans / r.total, 0.5, 1e-3);
r = partDedans([[-1, 0.5], [0.9, 0.5]], dansCarre);
verifier('traversee entrante (bout final dedans)', r.dans / r.total, 0.9 / 1.9, 1e-3);
// Entierement dedans
r = partDedans([[0.2, 0.5], [0.8, 0.5]], dansCarre);
verifier('entierement dedans : 100 %', r.dans / r.total, 1);
// Entierement dehors
r = partDedans([[2, 2], [3, 3]], dansCarre);
verifier('entierement dehors : 0 %', r.dans / r.total, 0);
// Trace en plusieurs cotes, 3 sur 4 dedans
r = partDedans([[-0.5, 0.5], [0.5, 0.5], [0.9, 0.5]], dansCarre);
verifier('deux cotes, un a cheval : 60 %',
         r.dans / r.total, (0.5 + 0.4) / (1.0 + 0.4), 1e-3);
// Segment degenere (longueur nulle)
r = partDedans([[0.5, 0.5], [0.5, 0.5]], dansCarre);
verifier('longueur nulle : total 0', r.total, 0);

console.log('\n=== 4. Traversees et echappees (defaut corrige en v2.08) ===');
// Un cote dont les DEUX extremites sont dehors mais qui coupe la zone. Avant la
// v2.08 : compte pour 0 %, car seules les extremites etaient testees.
r = partDedans([[-0.5, 0.5], [1.5, 0.5]], dansCarre);
verifier('corde traversante (les 2 bouts dehors) : 50 %', r.dans / r.total, 0.5, 1e-3);
// Le symetrique, celui qu'on a MESURE sur le terrain (1 segment a Coursan) :
// les deux bouts dedans, mais le cote sort par une echancrure du polygone.
const U = [[0, 0], [1, 0], [1, 1], [0.6, 1], [0.6, 0.3], [0.4, 0.3], [0.4, 1], [0, 1], [0, 0]];
const dansU = (x, y) => pointInRing(x, y, U);
r = partDedans([[0.2, 0.6], [0.8, 0.6]], dansU);
verifier('echappee (2 bouts dedans, milieu dehors)', r.dans / r.total, 0.4 / 0.6, 0.05);

console.log('\n=== 5. pointInRings : trous (anneaux interieurs) ===');
const TROU = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]];
verifier('dans le polygone, hors du trou', pointInRings(0.2, 0.2, [CARRE, TROU]), true);
verifier('dans le trou = dehors', pointInRings(0.5, 0.5, [CARRE, TROU]), false);
verifier('hors du polygone', pointInRings(2, 2, [CARRE, TROU]), false);

console.log('\n=== 6. pointInGeom : Polygon et MultiPolygon ===');
verifier('Polygon', pointInGeom(0.5, 0.5, { type: 'Polygon', coordinates: [CARRE] }), true);
const CARRE2 = [[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]];
const MP = { type: 'MultiPolygon', coordinates: [[CARRE], [CARRE2]] };
verifier('MultiPolygon, 1re partie', pointInGeom(0.5, 0.5, MP), true);
verifier('MultiPolygon, 2e partie', pointInGeom(5.5, 5.5, MP), true);
verifier('MultiPolygon, entre les deux', pointInGeom(3, 3, MP), false);
verifier('geometrie absente', pointInGeom(0, 0, null), false);
verifier('type inconnu (LineString)', pointInGeom(0, 0, { type: 'LineString', coordinates: [] }), false);

// ── recomposition de `localiser` : on reproduit SA formule pour mesurer le
// comportement du cumul de parts sur des polygones qui se chevauchent.
console.log('\n=== 7. POLYGONES QUI SE CHEVAUCHENT : le cumul des parts ===');
// Depuis la v2.08, `localiser` mesure la part de l'UNION et non la somme des
// parts. On reproduit les DEUX formules pour montrer ce que le correctif change.
function partUnion(coords, anneaux) {
  const rr = partDedans(coords, (x, y) => anneaux.some(ring => pointInRings(x, y, [ring])));
  return rr.total ? rr.dans / rr.total : 0;
}
function partSommeAncienne(coords, anneaux) {
  let s = 0;
  for (const ring of anneaux) {
    const rr = partDedans(coords, (x, y) => pointInRings(x, y, [ring]));
    if (rr.total) s += rr.dans / rr.total;
  }
  return Math.min(1, s);
}
// Deux carres qui se chevauchent sur [0,4 ; 0,6].
const G1 = [[0, 0], [0.6, 0], [0.6, 1], [0, 1], [0, 0]];
const G2 = [[0.4, 0], [1, 0], [1, 1], [0.4, 1], [0.4, 0]];
// Trace de x=0 a x=1 : il est en realite 100 % couvert par l'union.
verifier('entierement couvert par l\'union : 100 %',
         partUnion([[0, 0.5], [1, 0.5]], [G1, G2]), 1, 1e-3);
// Trace de x=0 a x=2 : l'union en couvre exactement la moitie (0 a 1 sur 2).
verifier('a moitie couvert par l\'union : 50 %',
         partUnion([[0, 0.5], [2, 0.5]], [G1, G2]), 0.5, 1e-3);
note('le meme cas avec l\'ANCIENNE formule (somme des parts)',
     partSommeAncienne([[0, 0.5], [2, 0.5]], [G1, G2]).toFixed(3) +
     ' au lieu de 0.500 — la portion commune etait comptee DEUX FOIS');
// Consequence sur la decision, avec le seuil par defaut de 80 %.
const seuil = 0.8;
const pu = partUnion([[0, 0.5], [2, 0.5]], [G1, G2]);
const pa = partSommeAncienne([[0, 0.5], [2, 0.5]], [G1, G2]);
const classe = v => v >= seuil ? 'EN AGGLO' : (v > 1 - seuil ? 'a couper' : 'hors agglo');
note('decision au seuil 80 %', 'union -> « ' + classe(pu) + ' » (juste) ; ancienne somme -> « ' +
     classe(pa) + ' »');

console.log(messages.join('\n'));
console.log('\n' + '='.repeat(64));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
console.log('Les lignes « ~~ » sont des CONSTATS, pas des echecs : elles decrivent');
console.log('un comportement reel a arbitrer, pas une regle violee.');
process.exit(ko ? 1 : 0);
