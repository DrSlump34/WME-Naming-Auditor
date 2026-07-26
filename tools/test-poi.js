/**
 * Tests de l'audit des VRAIS POI (pas les RPP) — v2.15.
 *
 * Deux controles demandes par l'auteur le 26/07 :
 *   1. adresse INCOMPLETE (rue, commune, et le numero A PART, decoche) ;
 *   2. un POI dans le contour INSEE doit porter la ville de CETTE commune.
 * Plus les regles de perimetre : elements du paysage ecartes, et position prise
 * sur le POINT D'ACCES PRINCIPAL.
 *
 * ⚠️ Fonctions et constantes EXTRAITES du userscript.
 *
 * Usage : node tools/test-poi.js
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
function relire(nom) {
  const m = src.match(new RegExp('const\\s+' + nom + '\\s*=\\s*([\\s\\S]*?);\\n'));
  if (!m) throw new Error('constante introuvable : ' + nom);
  return 'const ' + nom + ' = ' + m[1] + ';';
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

// Commune carree de 0,02 degre de cote, autour de (4,71 ; 44,06).
const X0 = 4.70, Y0 = 44.05, X1 = 4.72, Y1 = 44.07;
const COMMUNE = {
  code: '30278', nom: 'Saint-Laurent-des-Arbres',
  geom: { type: 'Polygon', coordinates: [[[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1], [X0, Y0]]] }
};
const DEDANS = [4.710, 44.060];      // bien au centre
const DEHORS = [4.750, 44.060];      // franchement a l'exterieur
const PRES_LIMITE = [4.7199, 44.060];  // ~8 m du bord est

function monter(controles) {
  const code = [
    relire('POI_CATEGORIES_NATURELLES'),
    'const options = { controles: ' + JSON.stringify(controles) + ' };',
    'const esc = s => String(s == null ? "" : s);',
    'const TOL_MITOYEN_M = 12; const DEG_PAR_M = 1 / 111320;',
    'let cacheCotes = { code: null, cotes: null };',
    extraire('pointInRing'), extraire('pointInRings'), extraire('pointInGeom'),
    extraire('cotesDuContour'), extraire('distanceALaLimite'),
    extraire('positionPoi'), extraire('sommetsDe'), extraire('poiDansCommune'),
    'function libelleCategorie(c){ return c || "POI"; }',
    extraire('auditerPoi'),
    'return { auditerPoi, positionPoi, poiDansCommune };'
  ].join('\n');
  return new Function(code)();
}
const TOUS = { poiAdresse: true, poiVilleCommune: true, poiNumero: true };
const DEFAUT = { poiAdresse: true, poiVilleCommune: true, poiNumero: false };

/** Fabrique un POI. `pt` = position ponctuelle, `acces` = points d'acces. */
const POI = (o) => Object.assign({
  id: 'v1', residential: false, name: 'Chez Paul', categories: ['RESTAURANT'],
  streetID: 10, houseNumber: '12',
  geometry: { type: 'Point', coordinates: DEDANS }, entryExitPoints: []
}, o);
const RUES = { 10: { id: 10, name: 'Rue de la Poste', cityID: 100 },
               11: { id: 11, name: '', isEmpty: true, cityID: 100 },
               12: { id: 12, name: 'Chemin de la Planque', cityID: 101 },
               13: { id: 13, name: 'Rue sans ville', cityID: 102 } };
const VILLES = { 100: { id: 100, name: 'Saint-Laurent-des-Arbres' },
                 101: { id: 101, name: 'Saint-Geniès-de-Comolas' },
                 102: { id: 102, name: '', isEmpty: true } };
function auditer(pois, controles) {
  const api = monter(controles || DEFAUT);
  const stats = { poiAudites: 0, poiHorsCommune: 0, poiNaturels: 0, poiBati: 0,
                  poiConformes: 0 };
  const out = api.auditerPoi(pois, RUES, VILLES, COMMUNE, stats);
  return { out, stats };
}

console.log('\n=== Perimetre : qui est audite, qui est ecarte ===\n');

// 1. Un POI complet et bien place ne dit rien.
let r = auditer([POI({})]);
verifier('1. adresse complète — aucun écart', r.out.length, 0);
verifier('1. compté comme conforme', r.stats.poiConformes, 1);

// 2. Les RPP relèvent de l'autre onglet.
r = auditer([POI({ residential: true, streetID: null })]);
verifier('2. POI résidentiel — ignoré', [r.out.length, r.stats.poiAudites], [0, 0]);

// 3. ⚠️ Elements du paysage : aucune adresse a reclamer (demande de l'auteur).
for (const cat of ['RIVER_STREAM', 'SEA_LAKE_POOL', 'ISLAND', 'FOREST_GROVE',
                   'CANAL', 'SWAMP_MARSH', 'NATURAL_FEATURES', 'BEACH']) {
  r = auditer([POI({ categories: [cat], name: '', streetID: null })]);
  verifier('3. ' + cat + ' — écarté', [r.out.length, r.stats.poiNaturels], [0, 1]);
}
// ⚠️ Et ceux qu'il ne FAUT PAS ecarter : ce sont des lieux batis, avec adresse.
for (const cat of ['FARM', 'SEAPORT_MARINA_HARBOR', 'SWIMMING_POOL', 'CARPOOL_SPOT']) {
  r = auditer([POI({ categories: [cat], streetID: null })]);
  verifier('3. ' + cat + ' — audité (lieu bâti)', r.stats.poiAudites, 1);
}

// 3bis. ⚠️ LE BATI SANS NOM n'est pas une adresse (precision de l'auteur) : une
//       ZONE sans nom sert a dessiner un batiment sur l'ecran de l'application ;
//       les commerces qu'elle abrite sont des POI a part, eux-memes audites.
const ZONE = { type: 'Polygon',
               coordinates: [[[4.709, 44.059], [4.711, 44.059], [4.711, 44.061], [4.709, 44.061], [4.709, 44.059]]] };
r = auditer([POI({ name: '', geometry: ZONE, streetID: null,
                   categories: ['SHOPPING_AND_SERVICES'] })]);
verifier('3bis. zone SANS NOM — écartée (bâti)', r.out.length, 0);
verifier('3bis. et comptée comme bâti', r.stats.poiBati, 1);
verifier('3bis. pas comptée comme auditée', r.stats.poiAudites, 0);
// La meme zone AVEC un nom est un vrai POI : elle reste auditee.
r = auditer([POI({ name: 'Intermarché', geometry: ZONE, streetID: null })]);
verifier('3bis. zone AVEC un nom — auditée', [r.out.length, r.stats.poiBati], [1, 0]);
// Un POI PONCTUEL sans nom ne dessine rien : il n'a pas cette excuse.
r = auditer([POI({ name: '', streetID: null })]);
verifier('3bis. POINT sans nom — audité quand même', r.out.length, 1);
verifier('3bis. et pas compté comme bâti', r.stats.poiBati, 0);

// 4. Hors du contour : ce n'est pas notre commune.
r = auditer([POI({ geometry: { type: 'Point', coordinates: DEHORS } })]);
verifier('4. hors contour — écarté', [r.out.length, r.stats.poiHorsCommune], [0, 1]);

console.log('\n=== Contrôle 1 : adresse incomplète ===\n');

r = auditer([POI({ streetID: null })]);
verifier('5. aucune adresse — 1 écart', r.out.length, 1);
verifier('5. libellé « adresse absente »', r.out[0].ecarts[0].champ, 'adresse absente');
verifier('5. et le remède nomme la commune',
         /Saint-Laurent-des-Arbres/.test(r.out[0].ecarts[0].apres), true);

r = auditer([POI({ streetID: 11 })]);              // Street vide
verifier('6. rue vide — signalée', r.out[0].ecarts.some(e => e.champ === 'rue absente'), true);

r = auditer([POI({ streetID: 13 })]);              // ville vide
verifier('7. commune vide — signalée',
         r.out[0].ecarts.some(e => e.champ === 'commune absente'), true);

console.log('\n=== Contrôle 2 : le numéro, à part et décoché ===\n');

r = auditer([POI({ houseNumber: '' })], DEFAUT);
verifier('8. numéro manquant, contrôle DÉCOCHÉ — rien', r.out.length, 0);
r = auditer([POI({ houseNumber: '' })], TOUS);
verifier('9. numéro manquant, contrôle coché — signalé',
         r.out[0].ecarts.some(e => e.champ === 'numéro absent'), true);
r = auditer([POI({ streetID: null, houseNumber: '' })], TOUS);
verifier('10. sans adresse du tout — pas de doublon sur le numéro',
         r.out[0].ecarts.filter(e => e.champ === 'numéro absent').length, 0);

console.log('\n=== Contrôle 3 : commune différente du contour INSEE ===\n');

// Le cas REEL : « Guinguette la Grange », sur une voie mitoyenne.
r = auditer([POI({ streetID: 12, name: 'Guinguette la Grange',
                   geometry: { type: 'Point', coordinates: PRES_LIMITE } })]);
let e = r.out[0].ecarts.find(x => x.champ === 'commune à vérifier');
verifier('11. ville ≠ commune INSEE — signalée', !!e, true);
verifier('11. la ville actuelle est rappelée', e && e.avant, 'Saint-Geniès-de-Comolas');
verifier('11. présenté comme À VÉRIFIER près d\'une limite',
         /limite communale/.test((e && e.apres) || ''), true);
lignes.push('  ~~    11. message : « ' + (e && e.apres) + ' »');

// Loin de toute limite : le doute n'a plus de raison d'être formule pareil.
r = auditer([POI({ streetID: 12, geometry: { type: 'Point', coordinates: DEDANS } })]);
e = r.out[0].ecarts.find(x => x.champ === 'commune à vérifier');
verifier('12. loin de la limite — signalée aussi', !!e, true);
verifier('12. sans invoquer la commune voisine',
         /peut être la bonne/.test((e && e.apres) || ''), false);
lignes.push('  ~~    12. message : « ' + (e && e.apres) + ' »');

// La bonne ville ne dit rien.
r = auditer([POI({ streetID: 10 })]);
verifier('13. ville = commune INSEE — rien', r.out.length, 0);

console.log('\n=== La position : le POINT D\'ACCÈS PRINCIPAL d\'abord ===\n');

const api = monter(DEFAUT);
// ⚠️ Regle de l'auteur : c'est l'acces qui compte, pas le centre. Ici le POI est
// a cheval, son centre est DEHORS, mais son acces principal est DEDANS.
const surCheval = {
  type: 'Polygon',
  coordinates: [[[4.7195, 44.0595], [4.7300, 44.0595], [4.7300, 44.0605], [4.7195, 44.0605], [4.7195, 44.0595]]]
};
let p = api.positionPoi({ geometry: surCheval, entryExitPoints: [
  { point: { type: 'Point', coordinates: [4.7250, 44.060] }, entry: true, primary: false },
  { point: { type: 'Point', coordinates: DEDANS }, entry: true, primary: true }
] });
verifier('14. le point PRIMARY est préféré', p.point, DEDANS);
verifier('14. et la source est dite', p.source, 'accès principal');

p = api.positionPoi({ geometry: surCheval, entryExitPoints: [
  { point: { type: 'Point', coordinates: DEDANS }, entry: true, primary: false }] });
verifier('15. sans primary — un accès d\'entrée suffit', p.source, 'point d\'accès');

p = api.positionPoi({ geometry: { type: 'Point', coordinates: DEDANS }, entryExitPoints: [] });
verifier('16. POI ponctuel sans accès — sa position', p.source, 'position du lieu');

// Dernier recours : part de surface. Le POI ci-dessus est majoritairement DEHORS.
let d = api.poiDansCommune({ geometry: surCheval, entryExitPoints: [] }, COMMUNE);
verifier('17. surfacique sans accès — part de surface', d.source, 'part de surface');
verifier('17. majoritairement dehors — écarté', d.dedans, false);
lignes.push('  ~~    17. part mesurée : ' + Math.round((d.part || 0) * 100) + ' % dans la commune');

// Le meme POI, mais avec son acces DEDANS : il releve de la commune.
d = api.poiDansCommune({ geometry: surCheval, entryExitPoints: [
  { point: { type: 'Point', coordinates: DEDANS }, entry: true, primary: true }] }, COMMUNE);
verifier('18. le même, accès principal dedans — retenu',
         [d.dedans, d.source], [true, 'accès principal']);

// ── Le cadrage d'un POI SURFACIQUE ─────────────────────────────────────────
// ⚠️ Bug signale par l'auteur le 26/07 : « le clic sur un ecart de POI ne centre
// pas dessus ». `cadrerSur` etalait `coordinates` a la main, ce qui donnait des
// ANNEAUX au lieu de points pour un Polygone : l'emprise partait en NaN. Verrou
// de non-regression sur l'aplatissement, quelle que soit la profondeur.
console.log('\n=== Cadrage : emprise d\'une géométrie, quel que soit son type ===\n');
const g = new Function(extraire('sommetsDe') + '\n' + extraire('emprise') +
                       '\nreturn { sommetsDe, emprise };')();
const empriseDe = geom => g.emprise(g.sommetsDe(geom));
let em = empriseDe({ type: 'Point', coordinates: [4.71, 44.06] });
verifier('19. Point — centre exact', [em.centre.lon, em.centre.lat], [4.71, 44.06]);
em = empriseDe({ type: 'LineString', coordinates: [[4.70, 44.05], [4.72, 44.07]] });
verifier('20. LineString — centre au milieu', [em.centre.lon, em.centre.lat], [4.71, 44.06]);
em = empriseDe(ZONE);
verifier('21. Polygon — centre calculable (pas NaN)',
         [isFinite(em.centre.lon), isFinite(em.centre.lat), isFinite(em.rx)], [true, true, true]);
// ⚠️ `emprise` rend le CENTRE DE GRAVITE (moyenne des points), pas le centre de
// la boite — c'est voulu dans ce projet. L'anneau etant FERME, son premier point
// compte deux fois : le centre penche donc de ~20 m vers ce sommet. Sans effet
// pour un cadrage, d'ou la tolerance ici plutot qu'un correctif dans `emprise`,
// utilisee partout ailleurs.
verifier('21. et il tombe au centre de la zone à ~50 m près',
         [Math.abs(em.centre.lon - 4.71) < 5e-4, Math.abs(em.centre.lat - 44.06) < 5e-4],
         [true, true]);
em = empriseDe({ type: 'MultiPolygon', coordinates: [ZONE.coordinates] });
verifier('22. MultiPolygon — centre calculable aussi',
         [isFinite(em.centre.lon), Math.abs(em.centre.lat - 44.06) < 5e-4], [true, true]);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
