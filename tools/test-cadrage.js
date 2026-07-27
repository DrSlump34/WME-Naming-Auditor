/**
 * Tests du CADRAGE AVANT SELECTION (v2.27).
 *
 * ⚠️⚠️ CE QUE CES TESTS PROTEGENT — retour terrain de Glenan56 (27/07/2026) :
 * « je confirme, pour avoir fait plusieurs autres Dxxx hors ville de cette
 * commune, que le script, la premiere fois, zappe pratiquement toujours la
 * selection de l'ensemble des segments », et surtout son diagnostic, qui etait
 * le bon : « j'ai note que le zoom etait un peu trop fort suite a la demande de
 * selection ».
 *
 * ⭐ LA REGLE PHYSIQUE : on ne peut selectionner que ce que WME a CHARGE, et WME
 * ne charge QUE la vue, et seulement a partir du zoom 14. Un cadrage qui laisse
 * un tronçon dehors le rend donc INSELECTIONNABLE — et aucune tentative de
 * rattrapage n'y changera rien, puisqu'elle guette un modele qui ne se remplira
 * pas. C'est pour ca que ces tests portent sur le CADRAGE et pas sur les essais
 * de selection : c'est la decision de cadrage qui tranche, tout le reste suit.
 *
 * Deux fautes vecues, deux garde-fous :
 *   1. le cadrage se posait sur le TRONÇON LE PLUS LONG des qu'un report etait
 *      eparpille (> 1 km) — les autres tronçons ne rentraient jamais dans la vue ;
 *   2. le zoom etait calcule sur `window.innerWidth`, alors que le centrage
 *      decale ensuite la carte pour degager la cible de sous nos fenetres : la
 *      place promise etait reprise juste apres, et une part du report sortait.
 *
 * ⚠️ Fonctions et constantes EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-cadrage.js
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

function extraire(nom) {
  const i = src.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let par = 0, j = src.indexOf('(', i);
  for (; j < src.length; j++) {
    if (src[j] === '(') par++;
    else if (src[j] === ')') { par--; if (!par) { j++; break; } }
  }
  let prof = 0; j = src.indexOf('{', j);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, j + 1);
}
function constante(nom) {
  const m = src.match(new RegExp('const ' + nom + ' = (\\d+)'));
  if (!m) throw new Error('constante introuvable : ' + nom);
  return parseInt(m[1], 10);
}

const ZOOM_CHARGEMENT = constante('ZOOM_CHARGEMENT');
const ZOOM_PLANCHER = constante('ZOOM_PLANCHER');
const ZOOM_NUMEROS = constante('ZOOM_NUMEROS');

// `options` n'est utilise que par la valeur par defaut de `vue`, qu'on ne
// declenche jamais ici : tous les appels passent une vue explicite.
const api = new Function([
  'const ZOOM_CHARGEMENT = ' + ZOOM_CHARGEMENT + ';',
  'const ZOOM_PLANCHER = ' + ZOOM_PLANCHER + ';',
  'const ZOOM_NUMEROS = ' + ZOOM_NUMEROS + ';',
  'const placeDisponible = () => { throw new Error("vue non fournie"); };',
  extraire('longueur'), extraire('sommetsDe'), extraire('emprise'),
  extraire('zoomPour'), extraire('cadrageDeReport'),
  'return { zoomPour, cadrageDeReport, emprise, sommetsDe };'
].join('\n'))();

let ok = 0, ko = 0;
function verifie(titre, condition, detail) {
  if (condition) { ok++; return; }
  ko++;
  console.log('  ECHEC : ' + titre + (detail ? '\n           ' + detail : ''));
}

// --- Outils de fabrication -------------------------------------------------
const VUE = { largeur: 1400, hauteur: 900, zoomNiveau: 17 };
/** Une ligne droite est-ouest, longue de `km`, posee a (lon, lat). */
function ligne(lon, lat, km) {
  const dLon = km / (111.32 * Math.cos(lat * Math.PI / 180));
  return { type: 'LineString', coordinates: [[lon, lat], [lon + dLon, lat]] };
}
/** Le report tel que `regrouperFindings` le fabrique. */
function report(geoms, extra) {
  return Object.assign({
    geoms, geom: geoms[0], segIds: geoms.map((g, i) => 1000 + i),
    centre: { lon: geoms[0].coordinates[0][0], lat: geoms[0].coordinates[0][1] }
  }, extra || {});
}
/** Toutes les geometries tiennent-elles dans la vue, au cadrage rendu ? */
function toutTient(plan, geoms, vue) {
  const degParPx = 360 / (256 * Math.pow(2, plan.zoom));
  const demiLon = (vue.largeur / 2) * degParPx;
  const demiLat = (vue.hauteur / 2) * degParPx * Math.cos(plan.centre.lat * Math.PI / 180);
  return geoms.every(g => api.sommetsDe(g).every(c =>
    Math.abs(c[0] - plan.centre.lon) <= demiLon && Math.abs(c[1] - plan.centre.lat) <= demiLat));
}

console.log('— Cadrage avant selection —');

// ===========================================================================
// 1. LE CAS DE GLENAN56 : une Dxxx en tronçons eparpilles
// ===========================================================================
{
  // Une departementale qui traverse la commune : trois tronçons sur 3 km, donc
  // « disperse » au sens du script (seuil ~1 km).
  const geoms = [ligne(1.74, 43.53, 0.3), ligne(1.755, 43.535, 0.3), ligne(1.77, 43.54, 0.4)];
  const f = report(geoms, { disperse: true });
  const plan = api.cadrageDeReport(f, VUE);

  verifie('Dxxx eparpillee : le cadrage se dit complet', plan.tout === true,
    'tout=' + plan.tout);
  verifie('Dxxx eparpillee : TOUS les tronçons tiennent dans la vue',
    toutTient(plan, geoms, VUE),
    'zoom=' + plan.zoom + ' centre=' + JSON.stringify(plan.centre));
  verifie('Dxxx eparpillee : le zoom permet a WME de charger',
    plan.zoom >= ZOOM_CHARGEMENT, 'zoom=' + plan.zoom);

  // ⭐ LE COEUR DE LA REGRESSION : le centre ne doit PAS etre celui du tronçon
  // le plus long (l'ancien comportement), mais celui de l'ensemble.
  const emTotale = api.emprise(geoms.flatMap(g => api.sommetsDe(g)));
  verifie('Dxxx eparpillee : on ne se pose plus sur le seul tronçon le plus long',
    Math.abs(plan.centre.lon - emTotale.centre.lon) < 1e-9,
    'centre=' + plan.centre.lon + ' attendu=' + emTotale.centre.lon);
}

// ===========================================================================
// 2. LA PATTE D'OIE : des tronçons proches, mais plusieurs
// ===========================================================================
{
  // Le cas cite par Glenan : « il oublie les pattes d'oie ou certains segments
  // apres l'intersection ». Emprise courte — mais l'arrondi du zoom decidait.
  const geoms = [ligne(1.74, 43.53, 0.12), ligne(1.7415, 43.5302, 0.1)];
  const f = report(geoms);
  const plan = api.cadrageDeReport(f, VUE);
  verifie('patte d\'oie : les deux branches tiennent dans la vue',
    toutTient(plan, geoms, VUE), 'zoom=' + plan.zoom);
  verifie('patte d\'oie : cadrage complet', plan.tout === true);
}

// ===========================================================================
// 3. L'ARRONDI DU ZOOM — la faute qui laissait un tronçon dehors
// ===========================================================================
{
  // ⚠️ Arrondir au plus proche peut zoomer JUSQU'A ~1,4x de trop. Sur un report
  // multi-segments, ce demi-niveau suffit a sortir un tronçon de la vue. On
  // eprouve donc l'arrondi lui-meme, a taille choisie pour tomber juste au
  // dessus d'un demi-niveau.
  const auPlusProche = api.zoomPour(0.01, 0.006, 43.5, Object.assign({ serrer: false }, VUE));
  const versLeBas = api.zoomPour(0.01, 0.006, 43.5, Object.assign({ serrer: true }, VUE));
  verifie('un seul segment : arrondi au plus proche (on ne perd pas un niveau entier)',
    auPlusProche >= versLeBas, auPlusProche + ' vs ' + versLeBas);
  verifie('plusieurs segments : le zoom ne depasse jamais celui du plus proche',
    versLeBas <= auPlusProche, versLeBas + ' vs ' + auPlusProche);

  // Balayage : sur 200 emprises, un cadrage multi-segments ne doit JAMAIS
  // laisser quoi que ce soit dehors. C'est la propriete qui compte, et elle se
  // verifie par la mesure, pas par relecture des branches.
  let dehors = 0;
  for (let i = 1; i <= 200; i++) {
    const km = i * 0.03;                       // de 30 m a 6 km
    const geoms = [ligne(1.74, 43.53, km), ligne(1.74, 43.5305, km * 0.6)];
    const plan = api.cadrageDeReport(report(geoms), VUE);
    if (plan.tout && !toutTient(plan, geoms, VUE)) dehors++;
  }
  verifie('200 emprises : un cadrage annonce complet l\'est vraiment', dehors === 0,
    dehors + ' cadrage(s) laissaient un tronçon dehors');
}

// ===========================================================================
// 4. LA ZONE VISIBLE, PAS LA FENETRE
// ===========================================================================
{
  // Le volet et la fenetre de travail mangent la droite de l'ecran. Avec moins
  // de place, on doit cadrer PLUS LARGE (zoom plus petit) — pas faire comme si
  // de rien n'etait, sinon la moitie du report finit sous nos propres fenetres.
  const large = api.zoomPour(0.02, 0.01, 43.5, { largeur: 1900, hauteur: 900, zoomNiveau: 17, serrer: true });
  const etroit = api.zoomPour(0.02, 0.01, 43.5, { largeur: 700, hauteur: 900, zoomNiveau: 17, serrer: true });
  verifie('moins de place visible ⇒ cadrage plus large', etroit < large,
    'etroit=' + etroit + ' large=' + large);
}

// ===========================================================================
// 5. LES BORNES
// ===========================================================================
{
  const petit = api.cadrageDeReport(report([ligne(1.74, 43.53, 0.01)]), VUE);
  verifie('un tronçon minuscule ne depasse pas le plafond de zoom reglé',
    petit.zoom <= VUE.zoomNiveau, 'zoom=' + petit.zoom);

  // Emprise enorme : aucun cadrage ne peut tout montrer au zoom ou WME charge.
  // On ne ment pas — `tout: false` — et on reste au zoom de chargement.
  const enorme = [ligne(1.0, 43.53, 40), ligne(2.0, 43.9, 40)];
  const plan = api.cadrageDeReport(report(enorme), VUE);
  verifie('emprise trop grande : le cadrage ne se dit PAS complet', plan.tout === false,
    'tout=' + plan.tout);
  verifie('emprise trop grande : on reste au zoom ou WME charge encore',
    plan.zoom >= ZOOM_CHARGEMENT, 'zoom=' + plan.zoom);
  verifie('emprise trop grande : on se pose sur un tronçon, pas entre les deux',
    plan.centre.lon < 1.5 || plan.centre.lon > 1.9,
    'centre=' + plan.centre.lon);
}

// ===========================================================================
// 6. LES REPORTS D'ADRESSE gardent leur zoom technique
// ===========================================================================
{
  // Sous le zoom 18, WME ne descend pas les numeros de rue : ce n'est pas un
  // confort de lecture, c'est la condition pour que la correction fonctionne.
  const plan = api.cadrageDeReport(
    report([ligne(1.74, 43.53, 0.05)], { adresse: true, sousType: 'hn', segIds: [1] }), VUE);
  verifie('report d\'adresse : zoom >= ' + ZOOM_NUMEROS, plan.zoom >= ZOOM_NUMEROS,
    'zoom=' + plan.zoom);
}

// ===========================================================================
// 7. LES CAS DEGENERES ne cassent rien
// ===========================================================================
{
  verifie('aucune geometrie, mais un centre : on cadre quand meme',
    api.cadrageDeReport({ geoms: [], centre: { lon: 1, lat: 43 } }, VUE) !== null);
  verifie('aucune geometrie ni centre : rien a cadrer, pas d\'exception',
    api.cadrageDeReport({ geoms: [] }, VUE) === null);
  verifie('geometrie vide de sommets : on retombe sur le centre',
    api.cadrageDeReport({ geoms: [{ type: 'LineString', coordinates: [] }],
                          centre: { lon: 1, lat: 43 } }, VUE) !== null);
}

// ===========================================================================
// 8. VERROU DE CONTRAT — le garde-fou du garde-fou
// ===========================================================================
{
  // ⚠️ Lecon de l'extracteur du test 21 (v2.26) : un harnais qui n'extrait plus
  // rien rend un verdict qui ment. On verifie donc que ce qu'on a extrait vit
  // encore, et que les constantes ne sont pas des valeurs de repli inventees.
  verifie('ZOOM_CHARGEMENT vaut bien le seuil de chargement mesure de WME',
    ZOOM_CHARGEMENT === 14, 'lu = ' + ZOOM_CHARGEMENT);
  verifie('ZOOM_CHARGEMENT est au-dessus du plancher de cadrage',
    ZOOM_CHARGEMENT > ZOOM_PLANCHER, ZOOM_CHARGEMENT + ' vs ' + ZOOM_PLANCHER);
  verifie('cadrageDeReport lit bien la zone visible qu\'on lui passe',
    /vue\.largeur/.test(extraire('zoomPour')));
  verifie('le cadrage d\'un report ne se pose plus sur `disperse`',
    !/f\.disperse/.test(extraire('cadrageDeReport')),
    'cadrageDeReport regarde encore f.disperse');
  // Le constat de selection partielle doit exister ET etre appelé.
  verifie('le constat de selection partielle existe', /function direSelection\(/.test(src));
  verifie('le constat est mis a jour a chaque tentative de selection',
    /direSelection\(dispo\.length, attendus\)/.test(src));
  verifie('les tentatives d\'un report abandonne sont annulees',
    /gen !== selGen/.test(src));
}

console.log((ko ? '✗' : '✓') + ' ' + ok + ' verification(s), ' + ko + ' echec(s)');
process.exit(ko ? 1 : 0);
