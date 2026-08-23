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
    // `readNaming` retombe sur le SDK quand un segment n'a pas de `_nam` ; nos
    // segments de test en portent un, la doublure evite juste l'explosion.
    'const sdk = { DataModel: { Segments: { getAddress(){ return null; } } } };',
    'const TOL_MITOYEN_M = 12; const DEG_PAR_M = 1 / 111320;',
    'let cacheCotes = { code: null, cotes: null };',
    extraire('pointInRing'), extraire('pointInRings'), extraire('pointInGeom'),
    extraire('cotesDuContour'), extraire('distanceALaLimite'),
    extraire('positionPoi'), extraire('sommetsDe'), extraire('poiDansCommune'),
    'function libelleCategorie(c){ return c || "POI"; }',
    // v2.19 : `auditerPoi` propose desormais une adresse aux POI incomplets.
    // ⚠️ Les constantes sont RELUES dans le source, jamais recopiees.
    relire('RPP_MARGE_VOIE_M'), relire('POI_PORTEE_VOIE_M'),
    relire('POI_MARGE_VOIE_M'), relire('POI_PORTEE_NUM_M'),
    'const distanceM = (a, b) => Math.hypot((a[0]-b[0]) * 111320 * Math.cos((a[1]+b[1]) * Math.PI / 360), (a[1]-b[1]) * 110540);',
    extraire('distPointSegment'), extraire('distanceAuTrace'), extraire('readNaming'),
    relire('RE_ROUTE'),
    // v2.37 : adresse d'autoroute (aires, echangeurs, jonctions, peages).
    relire('RE_AUTOROUTE'), relire('POI_CATEGORIES_AUTOROUTE'),
    extraire('numeroLePlusProche'), extraire('proposerAdressePoi'),
    extraire('auditerPoi'),
    'return { auditerPoi, positionPoi, poiDansCommune, proposerAdressePoi };'
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
               13: { id: 13, name: 'Rue sans ville', cityID: 102 },
               // v2.37 : l'adresse d'un POI d'autoroute est le nom de la
               // freeway, sans ville (102 = ville vide).
               // ⚠️ 20 et 21, PAS 14 : le cas 35 ECRASE `RUES[14]` en cours de
               // route (« D121 »). Une cle reutilisee ici rendait le cas 37
               // faux — et faux en silence, puisqu'il aurait teste D121.
               20: { id: 20, name: 'A9', cityID: 102 },
               21: { id: 21, name: 'A9', cityID: 101 } };   // … avec une ville EN TROP
const VILLES = { 100: { id: 100, name: 'Saint-Laurent-des-Arbres' },
                 101: { id: 101, name: 'Saint-Geniès-de-Comolas' },
                 102: { id: 102, name: '', isEmpty: true } };
function auditer(pois, controles) {
  const api = monter(controles || DEFAUT);
  const stats = { poiAudites: 0, poiHorsCommune: 0, poiNaturels: 0, poiBati: 0,
                  poiAutoroute: 0, poiConformes: 0 };
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

// ===========================================================================
// PROPOSER UNE ADRESSE A UN POI QUI N'EN A PAS (v2.19)
//
// ⚠️ Ce que ces tests protegent : la proposition sera appliquee d'un CLIC. Une
// proposition fausse est donc pire que pas de proposition du tout. La regle
// posee par l'auteur (26/07) est « pas de match pertinent ⇒ l'utilisateur prend
// ses responsabilites » — c'est le drapeau `fiable` qui l'incarne.
// ===========================================================================
lignes.push('\n=== Proposition d\'adresse (v2.19) ===');
const apiProp = api;
const { proposerAdressePoi } = apiProp;

// Deux rues paralleles a 110 m, comme dans test-rpp-agglo. 0,0001° lat = 11 m.
const rue = (nom, lat, ville) => ({ id: nom,
  geometry: { type: 'LineString', coordinates: [[4.700, lat], [4.720, lat]] },
  _nam: { primary: { name: nom, cityName: ville || 'Saint-Laurent-des-Arbres' }, alts: [] } });
const R_POSTE = rue('Rue de la Poste', 44.0600);
const R_MOULIN = rue('Rue du Moulin', 44.0610);            // 110 m au nord
const ALLEE = { id: 'a', geometry: { type: 'LineString', coordinates: [[4.700, 44.06002], [4.720, 44.06002]] },
                _nam: { primary: { name: '', cityName: '' }, alts: [] } };
const RESEAU = [R_POSTE, R_MOULIN];

{
  const p = proposerAdressePoi([4.710, 44.0601], RESEAU, []);
  verifier('23. la voie nommée la plus proche est proposée', p.rue, 'Rue de la Poste');
  verifier('23. et la proposition est nette', p.fiable, true);
  verifier('23. la distance est rendue (11 m)', Math.round(p.dist), 11);
}
{
  // POI a mi-chemin : les deux rues se le disputent ⇒ piste, pas proposition.
  const p = proposerAdressePoi([4.710, 44.0605], RESEAU, []);
  verifier('24. deux voies à égalité ⇒ pas fiable', p.fiable, false);
  verifier('24. mais la piste est quand même rendue', !!p.rue, true);
}
{
  // ⚠️ Le segment le PLUS PROCHE est une allee anonyme : elle ne fournit aucune
  // adresse. Mesure a Saint-Laurent : c'est le cas le plus frequent.
  const p = proposerAdressePoi([4.710, 44.06003], [ALLEE, R_POSTE, R_MOULIN], []);
  verifier('25. une allée sans nom ne fournit pas d\'adresse', p.rue, 'Rue de la Poste');
}
verifier('26. aucune voie nommée à portée ⇒ aucune proposition',
  proposerAdressePoi([4.710, 44.0640], RESEAU, []), null);
{
  // ⚠️⚠️ UN NUMERO DE ROUTE N'EST PAS UNE ADRESSE (doctrine de `rueDuPoi`).
  // Releve du 26/07 : sans ce filtre, « D121 » etait propose comme rue au camp
  // militaire de Saint-Laurent-des-Arbres.
  const D121 = rue('D121', 44.06005);            // plus proche que la Rue de la Poste
  const p = proposerAdressePoi([4.710, 44.0601], [D121, R_POSTE, R_MOULIN], []);
  verifier('26bis. un numéro de route n\'est jamais proposé comme rue', p.rue, 'Rue de la Poste');
  // ⚠️ REGLE AFFINEE le 26/07 : s'il n'y a QUE lui, on ne le propose pas
  // d'office (`rue` reste vide) mais il reste CHOISISSABLE — l'auteur veut
  // pouvoir prendre « D121 » ou saisir librement.
  const seule = proposerAdressePoi([4.710, 44.0601], [D121], []);
  verifier('26bis. seul un numéro de route : rien n\'est proposé d\'office', seule.rue, null);
  verifier('26bis. mais il reste choisissable', seule.candidats.map(c => c.nom), ['D121']);
  verifier('26bis. et rien n\'est applicable sans passer par la liste', seule.fiable, false);
}
verifier('27. sans position (POI sans géométrie exploitable) ⇒ rien',
  proposerAdressePoi(null, RESEAU, []), null);

// Le NUMERO : seulement s'il est sur la voie retenue ET tout pres.
const NUMS = [
  { p: [4.7101, 44.0600], num: '12', rue: 'Rue de la Poste', src: 'numéro de rue' },
  { p: [4.7100, 44.0610], num: '99', rue: 'Rue du Moulin', src: 'POI résidentiel' }
];
{
  const p = proposerAdressePoi([4.710, 44.0601], RESEAU, NUMS);
  verifier('28. le numéro proche, sur la voie retenue, est proposé', p.numero.num, '12');
  verifier('28. avec sa distance', p.numero.dist < 30, true);
}
{
  // Le n° 99 est sur l'AUTRE rue : il ne dit rien de ce lieu, meme s'il existe.
  const p = proposerAdressePoi([4.710, 44.0601], RESEAU, [NUMS[1]]);
  verifier('29. un numéro d\'une autre rue n\'est jamais repris', p.numero, null);
}
{
  const loin = [{ p: [4.7150, 44.0600], num: '80', rue: 'Rue de la Poste' }];
  const p = proposerAdressePoi([4.710, 44.0601], RESEAU, loin);
  verifier('30. un numéro trop loin sur la bonne rue n\'est pas repris', p.numero, null);
}

// ── Integration : ce que voit l'editeur ────────────────────────────────────
{
  const stats = { poiAudites: 0, poiHorsCommune: 0, poiNaturels: 0, poiBati: 0, poiConformes: 0 };
  // POI sans rue du tout, pose le long de la Rue de la Poste.
  const poi = POI({ streetID: null, houseNumber: '',
                    geometry: { type: 'Point', coordinates: [4.710, 44.0601] } });
  const out = apiProp.auditerPoi([poi], RUES, VILLES, COMMUNE, stats, RESEAU, NUMS);
  const e = out[0].ecarts.find(x => x.champ === 'adresse absente');
  verifier('31. l\'écart porte la proposition', /^proposition : Rue de la Poste/.test(e.apres), true);
  verifier('31. la commune proposée est celle du contour INSEE',
    /\/ Saint-Laurent-des-Arbres/.test(e.apres), true);
  verifier('31. le numéro apparaît comme une QUESTION, pas comme un fait',
    /n° 12 \?/.test(e.apres), true);
  verifier('31. la proposition est applicable', !!out[0].propositionAdresse, true);
  verifier('31. ⚠️ mais JAMAIS le numéro', out[0].propositionAdresse.numeroPropose, '12');
  verifier('31. et l\'aide explique d\'où elle sort', out[0].aide.length > 0, true);
}
{
  const stats = { poiAudites: 0, poiHorsCommune: 0, poiNaturels: 0, poiBati: 0, poiConformes: 0 };
  // Le meme POI, mais a mi-chemin entre deux rues : rien d'applicable.
  const poi = POI({ streetID: null, houseNumber: '',
                    geometry: { type: 'Point', coordinates: [4.710, 44.0605] } });
  const out = apiProp.auditerPoi([poi], RUES, VILLES, COMMUNE, stats, RESEAU, NUMS);
  const e = out[0].ecarts.find(x => x.champ === 'adresse absente');
  // ⚠️ REGLE CHANGEE le 26/07 par l'auteur : « il faut le ⚡ quand on a quelque
  // chose de concret a proposer ». Un cas ambigu garde donc son bouton — mais
  // le clic OUVRE LA LISTE au lieu d'ecrire (`direct: false`).
  verifier('32. ambigu : le texte donne les autres possibilités',
    /autres possibilités : Rue du Moulin/.test(e.apres), true);
  verifier('32. et invite à choisir', /\(⚡ pour choisir\)/.test(e.apres), true);
  verifier('32. ⚡ présent malgré l\'ambiguïté', !!out[0].propositionAdresse, true);
  verifier('32. ⚠️ mais il N\'APPLIQUE RIEN tout seul', out[0].propositionAdresse.direct, false);
  verifier('32. les deux voies sont proposées au choix',
    out[0].propositionAdresse.candidats.map(c => c.nom), ['Rue de la Poste', 'Rue du Moulin']);
}
{
  // ⚠️⚠️ LE CAS QUI A TOUT DECLENCHE (camp militaire de Saint-Laurent, signale
  // par l'auteur) : la voie proche porte « D121 » en PRINCIPAL et « Route de
  // Laudun » en ALTERNATIF. Ne lire que le principal, c'est ne jamais voir le
  // nom de rue — et proposer un numero de route comme adresse.
  const stats = { poiAudites: 0, poiHorsCommune: 0, poiNaturels: 0, poiBati: 0, poiConformes: 0 };
  const D121 = { id: 's-d121',
    geometry: { type: 'LineString', coordinates: [[4.700, 44.0600], [4.720, 44.0600]] },
    _nam: { primary: { name: 'D121', cityName: '' },
            alts: [{ name: 'D121', cityName: 'Saint-Laurent-des-Arbres' },
                   { name: 'Route de Laudun', cityName: 'Saint-Laurent-des-Arbres' }] } };
  // ⚠️ Le POI porte REELLEMENT « D121 » comme rue, et aucune commune : c'est
  // l'etat exact du camp militaire dans Waze. Le reproduire avec `streetID:
  // null` ratait le cas — c'est ce qui m'a fait ecrire un test qui passait a
  // cote la premiere fois.
  RUES[14] = { id: 14, name: 'D121', cityID: 102 };      // cityID 102 = ville vide
  const poi = POI({ name: 'Camp Militaire', streetID: 14, houseNumber: '',
                    geometry: { type: 'Point', coordinates: [4.710, 44.06015] } });
  const out = monter(DEFAUT).auditerPoi([poi], RUES, VILLES, COMMUNE, stats, [D121], []);
  const p = out[0].propositionAdresse;
  // ⚠️⚠️ CONTRAT DE RENDU — le defaut qui a fait dire a l'auteur « aucune
  // evolution visible » : les reports POI ne passent PAS par
  // `regrouperFindings`, donc personne ne leur pose `nb` ni `verrouilles`. Le
  // rendu du bouton ⚡ teste `f.verrouilles !== f.nb` : avec deux `undefined`,
  // la comparaison est fausse et le bouton n'est JAMAIS dessine. Tout le calcul
  // etait juste, seul le bouton manquait — et aucun test ne regardait ca.
  verifier('35. ⚠️ le report porte `nb` et `verrouilles` (sans quoi le ⚡ n\'est pas dessiné)',
    [out[0].nb, out[0].verrouilles], [1, 0]);
  verifier('35. … et la comparaison du rendu autorise bien le bouton',
    out[0].verrouilles !== out[0].nb, true);
  verifier('35. ⭐ le nom ALTERNATIF est proposé, pas le numéro de route', p.rue, 'Route de Laudun');
  verifier('35. le numéro de route reste proposable, mais en dernier',
    p.candidats.map(c => c.nom + (c.estRoute ? ' (route)' : '')),
    ['Route de Laudun', 'D121 (route)']);
  verifier('35. et le ⚡ ouvre la liste au lieu d\'écrire', p.direct, false);
  const e = out[0].ecarts.find(x => x.champ === 'rue = numéro de route');
  verifier('35. l\'écart DIT que « D121 » n\'est pas une adresse', !!e, true);
  verifier('35. … en montrant la valeur fautive', e.avant, 'D121');
}
{
  // ⚠️⚠️ NE JAMAIS ECRASER UNE RUE DEJA JUSTE. Un POI qui porte un vrai nom de
  // voie mais pas de commune ne doit PAS voir sa rue remplacee par la
  // proposition : seule la commune manque.
  const stats = { poiAudites: 0, poiHorsCommune: 0, poiNaturels: 0, poiBati: 0, poiConformes: 0 };
  // streetID 13 = « Rue sans ville » : nom de rue valable, commune vide.
  const poi = POI({ streetID: 13, houseNumber: '',
                    geometry: { type: 'Point', coordinates: [4.710, 44.0601] } });
  const out = monter(DEFAUT).auditerPoi([poi], RUES, VILLES, COMMUNE, stats, RESEAU, []);
  const p = out[0].propositionAdresse;
  verifier('36. ⚠️ la rue existante est CONSERVEE, pas remplacée', p.rue, 'Rue sans ville');
  verifier('36. la commune INSEE est appliquée', p.ville, 'Saint-Laurent-des-Arbres');
  verifier('36. et rien n\'est à choisir : le ⚡ applique directement', p.direct, true);
  const e = out[0].ecarts.find(x => x.champ === 'commune absente');
  verifier('36. la ligne dit que la rue est conservée', /est conservée/.test(e.apres), true);
  verifier('36. aucun écart « numéro de route » sur une rue valable',
    !out[0].ecarts.some(x => x.champ === 'rue = numéro de route'), true);
}
{
  // ── Le NUMERO absent : c'est la que la proposition sert le plus (43 cas
  // mesures a Saint-Laurent-des-Arbres, contre 10 d'adresse incomplete).
  const stats = { poiAudites: 0, poiHorsCommune: 0, poiNaturels: 0, poiBati: 0, poiConformes: 0 };
  const poi = POI({ streetID: 10, houseNumber: '',      // rue connue, numero absent
                    geometry: { type: 'Point', coordinates: [4.7101, 44.0601] } });
  const nums = [{ p: [4.7101, 44.0600], num: '12', rue: 'Rue de la Poste', src: 'numéro de rue' }];
  const out = apiProp.auditerPoi([poi], RUES, VILLES, COMMUNE, stats, RESEAU, nums)
    // ⚠️ le controle « numero » est decoche par defaut : on le coche ici.
    ;
  const outNum = monter(TOUS).auditerPoi([poi], RUES, VILLES, COMMUNE,
    { poiAudites: 0, poiHorsCommune: 0, poiNaturels: 0, poiBati: 0, poiConformes: 0 }, RESEAU, nums);
  const e = outNum[0].ecarts.find(x => x.champ === 'numéro absent');
  verifier('34. le numéro le plus proche de SA rue est proposé', /^n° 12 \?/.test(e.apres), true);
  verifier('34. avec sa distance et sa provenance', /m, numéro de rue\)/.test(e.apres), true);
  verifier('34. contrôle décoché ⇒ pas d\'écart de numéro',
    out.length ? !out[0].ecarts.some(x => x.champ === 'numéro absent') : true, true);
}
{
  const stats = { poiAudites: 0, poiHorsCommune: 0, poiNaturels: 0, poiBati: 0, poiConformes: 0 };
  // Sans segments (mode balayage) : on ne propose rien, on ne plante pas.
  const poi = POI({ streetID: null, houseNumber: '',
                    geometry: { type: 'Point', coordinates: [4.710, 44.0601] } });
  const out = apiProp.auditerPoi([poi], RUES, VILLES, COMMUNE, stats, [], []);
  const e = out[0].ecarts.find(x => x.champ === 'adresse absente');
  verifier('33. sans segments : message d\'origine, aucun bouton',
    [/renseigner la rue/.test(e.apres), out[0].propositionAdresse], [true, null]);
}

// ===========================================================================
// ADRESSE D'AUTOROUTE (v2.37)
//
// ⚠️⚠️ CE QUE CES TESTS PROTEGENT : une regle FR ecrite — « Le nom sera celui de
// l'autoroute a laquelle l'aire est rattachee. Aucune Ville. » (Discuss 70053,
// et Wazeopedia « Lieux Particuliers » §2.4 / 2.12 / 2.13). Avant la v2.37, une
// aire renseignee EXACTEMENT comme la regle l'exige recevait DEUX ecarts —
// « rue = numero de route » et « commune absente » — dont l'application
// l'aurait rendue NON conforme. Le script reclamait une degradation.
//
// ⭐ Le vrai risque de la correction est l'exces inverse : se taire sur les POI
// ordinaires. Le cas 40 est le TEMOIN qui l'attrape.
// ===========================================================================
lignes.push('\n=== Adresse d\'autoroute (v2.37) ===');
const STATS = () => ({ poiAudites: 0, poiHorsCommune: 0, poiNaturels: 0, poiBati: 0,
                       poiAutoroute: 0, poiConformes: 0 });
// Une A9 qui longe la commune, sans ville — comme un vrai segment d'autoroute.
const A9 = { id: 'A9', geometry: { type: 'LineString', coordinates: [[4.700, 44.0600], [4.720, 44.0600]] },
             _nam: { primary: { name: 'A9', cityName: '' }, alts: [] } };
const AIRE = o => POI(Object.assign({ categories: ['REST_AREAS'], name: 'Aire de Tavel',
                                      streetID: 20, houseNumber: '',
                                      geometry: { type: 'Point', coordinates: [4.7101, 44.0601] } }, o));
{
  // 37. L'aire CONFORME : rue = A9, aucune ville, aucun numero.
  const s = STATS();
  const out = monter(TOUS).auditerPoi([AIRE({})], RUES, VILLES, COMMUNE, s, [A9], []);
  verifier('37. ⭐ une aire conforme ne dit RIEN', out.length, 0);
  verifier('37. … et elle est comptée conforme', s.poiConformes, 1);
  verifier('37. … et comptée sous la règle autoroute', s.poiAutoroute, 1);
}
{
  // 38. Un echangeur SANS adresse : on dit la bonne cible, pas la commune.
  const s = STATS();
  const poi = AIRE({ categories: ['JUNCTION_INTERCHANGE'], name: 'Échangeur 23 - Tavel',
                     streetID: null });
  const out = monter(DEFAUT).auditerPoi([poi], RUES, VILLES, COMMUNE, s, [A9], []);
  const e = out[0].ecarts.find(x => x.champ === 'adresse absente');
  verifier('38. l\'autoroute proche est proposée', /« A9 » \(autoroute à \d+ m\)/.test(e.apres), true);
  verifier('38. ⭐ et la consigne dit AUCUNE commune', /AUCUNE commune/.test(e.apres), true);
  verifier('38. la commune INSEE n\'est PAS proposée',
    e.apres.indexOf('Saint-Laurent-des-Arbres'), -1);
}
{
  // 39. Aucune autoroute a portee : la cible reste juste, sans nom a citer.
  const s = STATS();
  const out = monter(DEFAUT).auditerPoi([AIRE({ streetID: null })], RUES, VILLES, COMMUNE, s, [], []);
  const e = out[0].ecarts.find(x => x.champ === 'adresse absente');
  verifier('39. sans autoroute à portée, la règle est quand même dite',
    /nom de l'autoroute dont ce lieu dépend/.test(e.apres), true);
}
{
  // 40. ⚠️⚠️ TEMOIN — la regle ne doit PAS avaler les POI ordinaires. Une
  // station-service de village sans commune reste signalee.
  const s = STATS();
  const poi = POI({ categories: ['GAS_STATION'], streetID: 13, houseNumber: '',
                    geometry: { type: 'Point', coordinates: [4.710, 44.0601] } });
  const out = monter(DEFAUT).auditerPoi([poi], RUES, VILLES, COMMUNE, s, RESEAU, []);
  verifier('40. ⚠️ TEMOIN : une station-service ordinaire reste signalée',
    !!out.length && out[0].ecarts.some(x => x.champ === 'commune absente'), true);
  verifier('40. … et n\'est PAS comptée sous la règle autoroute', s.poiAutoroute, 0);
}
{
  // 41. Le numero : une aire n'a pas d'adresse postale, donc pas de numero.
  const s = STATS();
  const out = monter(TOUS).auditerPoi([AIRE({})], RUES, VILLES, COMMUNE, s, [A9], []);
  verifier('41. aucun écart « numéro absent » sur une aire',
    out.some(f => f.ecarts.some(x => x.champ === 'numéro absent')), false);
}
{
  // 42. Une aire qui porte une ville : on se TAIT (l'ecart « ville en trop »
  // serait un controle NEUF, hors du perimetre arbitre le 23/08). Ce que le test
  // fige, c'est qu'on ne lui propose SURTOUT pas la commune de la carte.
  const s = STATS();
  const out = monter(DEFAUT).auditerPoi([AIRE({ streetID: 21 })], RUES, VILLES, COMMUNE, s, [A9], []);
  verifier('42. aucune « commune à vérifier » sur une aire',
    out.some(f => f.ecarts.some(x => x.champ === 'commune à vérifier')), false);
}
{
  // 43. ⚠️ RE_AUTOROUTE, PAS RE_ROUTE : « D121 » n'est pas une adresse legitime.
  // C'est la frontiere exacte entre la doctrine de `rueDuPoi` et l'exception.
  const s = STATS();
  const poi = POI({ streetID: 12, houseNumber: '',        // « Chemin de la Planque »
                    geometry: { type: 'Point', coordinates: [4.7101, 44.0601] } });
  const outD = monter(DEFAUT).auditerPoi(
    [POI({ categories: ['RESTAURANT'], streetID: 13, houseNumber: '',
           geometry: { type: 'Point', coordinates: [4.710, 44.0601] } })],
    RUES, VILLES, COMMUNE, s, RESEAU, []);
  verifier('43. un POI ordinaire sans commune est toujours signalé',
    outD[0].ecarts.some(x => x.champ === 'commune absente'), true);
  verifier('43. … et « Chemin de la Planque » n\'est pas une autoroute',
    monter(DEFAUT).auditerPoi([poi], RUES, VILLES, COMMUNE, STATS(), RESEAU, [])
      .length > 0, true);
}

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
