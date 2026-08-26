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

/**
 * La garde « la carte y est-elle deja ? » LIT le SDK : elle ne peut pas se
 * tester comme une fonction pure. On la reconstruit donc autour d'un SDK
 * simule, injecte cas par cas — y compris un SDK qui LEVE, parce qu'un cadrage
 * qui ne se fait pas par accident est pire que le cadrage de trop.
 */
/**
 * ⚠️⚠️⚠️ CE HARNAIS A MENTI EN PASSANT AU VERT (v2.38). `carteDejaDans` se
 * termine par `catch (e) { return false; }` — un filet VOULU, pour qu'un SDK
 * muet ne fige jamais la carte. Mais quand la fonction a gagne deux constantes
 * que le harnais n'injectait pas, chaque appel levait un ReferenceError, le
 * filet le convertissait en `false`... et les tests restaient tous verts : ils
 * n'attendaient `false` que dans les cas de refus. La regle neuve n'etait pas
 * testee du tout.
 *
 * ⭐⭐⭐ TOUTE CONSTANTE QUE LA FONCTION LIT DOIT ETRE INJECTEE ICI. Le garde-fou
 * qui l'impose est le cas de bordure plus bas : il attend `true`, ce qu'aucune
 * levee ne peut produire. Un test qui n'attend que des `false` ne peut pas
 * distinguer un refus d'un plantage.
 */
function nombre(nom) {
  const m = src.match(new RegExp('const ' + nom + ' = ([\\d.]+)'));
  if (!m) throw new Error('constante introuvable : ' + nom);
  return parseFloat(m[1]);
}
const VUE_PART_MIN = nombre('VUE_PART_MIN');
const VUE_GRILLE = nombre('VUE_GRILLE');

function fabriquerGarde(sdk) {
  return new Function('sdk', [
    'const ZOOM_CHARGEMENT = ' + ZOOM_CHARGEMENT + ';',
    'const VUE_PART_MIN = ' + VUE_PART_MIN + ';',
    'const VUE_GRILLE = ' + VUE_GRILLE + ';',
    extraire('pointInRing'), extraire('pointInRings'), extraire('pointInGeom'),
    extraire('carteDejaDans'),
    'return carteDejaDans;'
  ].join('\n'))(sdk);
}
/**
 * La meme garde, mais pour le DEPART DU TRACE : elle lit en plus la commune en
 * cours, qui est une variable de module dans le userscript.
 */
function fabriquerGardeTrace(sdk, communeActive) {
  return new Function('sdk', 'communeActive', [
    'const ZOOM_CHARGEMENT = ' + ZOOM_CHARGEMENT + ';',
    'const VUE_PART_MIN = ' + VUE_PART_MIN + ';',
    'const VUE_GRILLE = ' + VUE_GRILLE + ';',
    extraire('pointInRing'), extraire('pointInRings'), extraire('pointInGeom'),
    extraire('carteDejaDans'), extraire('pointDejaEnVue'),
    extraire('departDejaSousLesYeux'),
    'return departDejaSousLesYeux;'
  ].join('\n'))(sdk, communeActive);
}
/** Un SDK de carte reduit a ce que les gardes lisent vraiment. */
const sdkSimule = (lon, lat, zoom, demi) => {
  const d = demi === undefined ? 0.02 : demi;
  return { Map: {
    getZoomLevel: () => zoom,
    getMapCenter: () => ({ lon, lat }),
    getMapExtent: () => [lon - d, lat - d, lon + d, lat + d]
  } };
};

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
// 8. CHOISIR UNE COMMUNE OU L'ON TRAVAILLE DEJA NE DEPLACE RIEN
//
// ⚠️⚠️ RETOUR TERRAIN Glenan56 (14/08/2026) : « je choisis une commune et mon
// zoom est deja correct, le script me fait un zoom arriere trop eloigne et je
// suis oblige de le reprendre systematiquement ».
//
// ⭐ La liste ne propose QUE les communes de la vue : etre deja dans celle
// qu'on choisit est le cas COURANT. Le cadrage sur la commune entiere reste
// juste pour qui arrive de loin — il ne doit plus rien coûter aux autres.
// ===========================================================================
{
  // Un carre d'environ 6 km de cote : une commune ordinaire.
  const commune = { type: 'Polygon', coordinates: [[
    [1.70, 43.50], [1.80, 43.50], [1.80, 43.56], [1.70, 43.56], [1.70, 43.50]]] };

  verifie('la carte posee DANS la commune, a un zoom de travail, ne bouge plus',
    fabriquerGarde(sdkSimule(1.75, 43.53, 16))(commune) === true);
  verifie('au zoom de chargement pile, la carte ne bouge pas non plus',
    fabriquerGarde(sdkSimule(1.75, 43.53, ZOOM_CHARGEMENT))(commune) === true);

  // --- TEMOIN : sans ces trois refus, la garde bloquerait des cadrages utiles.
  verifie('une commune VOISINE se cadre toujours (la carte n\'y est pas)',
    fabriquerGarde(sdkSimule(1.90, 43.53, 16))(commune) === false);
  verifie('vu de trop loin, on cadre : sous le zoom 14, WME n\'a rien charge',
    fabriquerGarde(sdkSimule(1.75, 43.53, ZOOM_CHARGEMENT - 1))(commune) === false);
  verifie('une commune sans contour se cadre par son emprise, comme avant',
    fabriquerGarde(sdkSimule(1.75, 43.53, 16))(null) === false);

  // Un SDK muet ne doit pas immobiliser la carte : en cas de doute, on cadre.
  const sdkMuet = { Map: { getZoomLevel() { throw new Error('SDK indisponible'); },
                           getMapCenter() { throw new Error('SDK indisponible'); } } };
  verifie('un SDK qui leve fait cadrer, il ne fige pas la carte en silence',
    fabriquerGarde(sdkMuet)(commune) === false);

  // ═══════════════════════════════════════════════════════════════════════
  // LE TRAVAIL EN BORDURE (v2.38)
  //
  // ⚠️⚠️ Le critere « le centre de la vue est dans le contour » laissait passer
  // le cas le plus COURANT du travail en zone : suivre une route le long d'une
  // limite communale. Le centre est alors DEHORS, la commune occupe la moitie
  // de l'ecran, et choisir cette commune catapultait l'editeur sur elle
  // entiere — le defaut meme que la garde devait supprimer.
  //
  // ⭐ CES DEUX CAS ATTENDENT `true`, ET C'EST LEUR ROLE : aucune levee, aucun
  // plantage, aucune constante oubliee ne peut produire un `true`. Ce sont eux
  // qui empechent le harnais de mentir en passant au vert.
  // ═══════════════════════════════════════════════════════════════════════
  // La commune s'arrete a lon 1.80. L'editeur est a 1.805 : son centre est
  // dehors, mais la moitie gauche de sa vue est dans la commune.
  verifie('en bordure : le centre est DEHORS, mais la commune remplit la moitie de la vue',
    fabriquerGarde(sdkSimule(1.805, 43.53, 16, 0.02))(commune) === true,
    'l\'editeur qui longe une limite communale est encore catapulte');
  // Un simple COIN de commune ne suffit pas : la, le cadrage lui apprend ou elle est.
  verifie('un coin de commune au bord de l\'ecran fait toujours cadrer',
    fabriquerGarde(sdkSimule(1.84, 43.53, 16, 0.05))(commune) === false,
    'on ne cadre plus alors que la commune n\'est qu\'un lisere a l\'ecran');
  verifie('le seuil est une part de vue, entre 0 et 1', VUE_PART_MIN > 0 && VUE_PART_MIN < 0.5,
    'VUE_PART_MIN = ' + VUE_PART_MIN);
  verifie('la grille de sondage est assez fine pour mesurer ce seuil',
    VUE_GRILLE * VUE_GRILLE * VUE_PART_MIN >= 4,
    'moins de 4 sondes decident du seuil : la mesure serait un tirage');

  // Le trou d'un contour (enclave). ⚠️ CE CAS A CHANGE DE REPONSE en v2.38, et
  // c'est assume : pose dans une enclave, l'editeur voit la commune TOUT AUTOUR
  // de lui. Le cadrage ne lui apprendrait rien — c'est la doctrine « cadrer ne
  // se justifie que si ca MONTRE quelque chose qu'il n'a pas deja ».
  const avecEnclave = { type: 'Polygon', coordinates: [
    commune.coordinates[0],
    [[1.74, 43.52], [1.76, 43.52], [1.76, 43.54], [1.74, 43.54], [1.74, 43.52]]] };
  verifie('dans une enclave CERNEE par la commune, la carte ne bouge plus',
    fabriquerGarde(sdkSimule(1.75, 43.53, 16))(avecEnclave) === true,
    'la commune occupe pourtant l\'essentiel de la vue');
  // Mais une enclave assez GRANDE pour remplir la vue, elle, fait toujours cadrer :
  // l'editeur n'y voit pas la commune.
  const grandeEnclave = { type: 'Polygon', coordinates: [
    commune.coordinates[0],
    [[1.71, 43.505], [1.79, 43.505], [1.79, 43.555], [1.71, 43.555], [1.71, 43.505]]] };
  verifie('dans une enclave qui remplit l\'ecran, on cadre encore',
    fabriquerGarde(sdkSimule(1.75, 43.53, 16))(grandeEnclave) === false);
}

// ===========================================================================
// 9. LE DEPART DU TRACE NE RENVOIE PLUS L'EDITEUR A L'AUTRE BOUT DE LA COMMUNE
//
// ⚠️⚠️ RETOUR TERRAIN Glenan56 (14/08/2026), captures a l'appui, sur CARAMAN
// dont l'agglomeration principale etait DEJA tracee : cliquer « ＋ Tracer »
// posait la carte sur la commune entiere — cinq communes voisines a l'ecran.
// A ce zoom-la WME DECHARGE les segments, et en revenant il avait perdu
// l'affichage des limitations de vitesse de la Toolbox : « je rezoome et je
// constate que je n'ai plus les LV ».
//
// ⭐ CADRER N'EST PAS GRATUIT : ça vide la vue de WME et emporte au passage ce
// que les autres scripts y dessinent. Un cadrage ne se paie que s'il MONTRE
// quelque chose que l'editeur n'a pas deja devant lui.
// ===========================================================================
{
  const commune = { type: 'Polygon', coordinates: [[
    [1.70, 43.50], [1.80, 43.50], [1.80, 43.56], [1.70, 43.56], [1.70, 43.50]]] };
  const dansLaCommune = { lon: 1.75, lat: 43.53 };

  // --- Le cas exact de Caraman : plus de secteur libre, pas de mairie.
  const large = { centre: dansLaCommune, zoom: 13, quoi: 'Caraman', large: true };
  verifie('CARAMAN : le repli « commune entiere » ne s\'impose plus a qui y est deja',
    fabriquerGardeTrace(sdkSimule(1.75, 43.53, 16), { nom: 'Caraman', geom: commune })(large) === true);

  // --- TEMOINS : ce repli garde tout son sens quand il apprend quelque chose.
  verifie('venu d\'ailleurs, le trace cadre encore la commune entiere',
    fabriquerGardeTrace(sdkSimule(1.95, 43.53, 16), { nom: 'Caraman', geom: commune })(large) === false);
  verifie('vu de trop loin, le trace cadre : sous le zoom 14, WME n\'a rien charge',
    fabriquerGardeTrace(sdkSimule(1.75, 43.53, ZOOM_CHARGEMENT - 1), { nom: 'Caraman', geom: commune })(large) === false);

  // --- LA HAGUE : une cible PRECISE (secteur d'entrees, mairie) se cadre des
  // qu'elle n'est pas a l'ecran — c'est tout l'interet du guidage, il reste.
  const precis = { centre: { lon: 1.85, lat: 43.53 }, zoom: 15, quoi: 'le bourg (mairie)' };
  verifie('LA HAGUE : un bourg hors ecran se cadre toujours',
    fabriquerGardeTrace(sdkSimule(1.75, 43.53, 16), { nom: 'Caraman', geom: commune })(precis) === false);
  verifie('un bourg deja au milieu de l\'ecran ne fait plus bouger la carte',
    fabriquerGardeTrace(sdkSimule(1.75, 43.53, 16), { nom: 'Caraman', geom: commune })(
      { centre: dansLaCommune, zoom: 15, quoi: 'le bourg' }) === true);
  verifie('un bourg colle au bord de l\'ecran se cadre quand meme',
    fabriquerGardeTrace(sdkSimule(1.75, 43.53, 16), { nom: 'Caraman', geom: commune })(
      { centre: { lon: 1.7655, lat: 43.53 }, zoom: 15, quoi: 'le bourg' }) === false,
    'a 0.0155° du bord d\'une vue de 0.04°, la cible est dans la marge');

  // Un SDK muet fait cadrer, il ne fige pas la carte en silence.
  const sdkMuet = { Map: { getZoomLevel() { throw new Error('SDK indisponible'); },
                           getMapCenter() { throw new Error('SDK indisponible'); },
                           getMapExtent() { throw new Error('SDK indisponible'); } } };
  verifie('un SDK qui leve fait cadrer le trace, comme avant',
    fabriquerGardeTrace(sdkMuet, { nom: 'Caraman', geom: commune })(large) === false &&
    fabriquerGardeTrace(sdkMuet, { nom: 'Caraman', geom: commune })(precis) === false);
  verifie('sans depart, rien a annuler', fabriquerGardeTrace(sdkSimule(1.75, 43.53, 16), { nom: 'Caraman', geom: commune })(null) === false);
}

// ===========================================================================
// 10. VERROU DE CONTRAT — le garde-fou du garde-fou
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
  // ⚠️ La garde ne vaut que si le CHOIX DE COMMUNE la consulte : testee toute
  // seule, elle peut etre parfaite et n'etre appelee nulle part.
  verifie('le choix d\'une commune ne cadre plus que si la carte n\'y est pas',
    /if \(communeActive && !carteDejaDans\(communeActive\.geom\)\)/.test(src),
    'le `onchange` de la liste de communes cadre sans consulter `carteDejaDans`');
  verifie('le trace ne cadre plus que si son depart n\'est pas deja a l\'ecran',
    /if \(depart && !departDejaSousLesYeux\(depart\)\)/.test(src),
    '`tracerAgglo` deplace la carte sans consulter `departDejaSousLesYeux`');
  // ⚠️⚠️ `large` NE MARQUE QUE L'AVEU D'IGNORANCE. Le poser sur les replis
  // precis (secteur libre, mairie) ferait rentrer LA HAGUE par la fenetre :
  // l'editeur serait laisse devant sa vue, sans savoir par ou commencer.
  verifie('un seul depart de trace porte `large` : celui de la commune entiere',
    (extraire('departDuTrace').match(/large: true/g) || []).length === 1,
    'departDuTrace : ' + (extraire('departDuTrace').match(/large: true/g) || []).length + ' repli(s) marques `large`');
  verifie('le repli « commune entiere » est bien le dernier de departDuTrace',
    extraire('departDuTrace').indexOf('large: true') >
    extraire('departDuTrace').indexOf('mairie'));

  // ═════════════════════════════════════════════════════════════════════════
  // LA TRACE DES CADRAGES (v2.38)
  //
  // ⚠️⚠️ Glenan56 signale un zoom arriere residuel depuis le 14/08 et on ne
  // peut PAS savoir lequel des cadrages le produit chez lui : un deplacement
  // de carte ne laissait aucune trace. Un cadrage muet se diagnostique par
  // devinettes, et chaque devinette coute une version.
  //
  // ⭐ UN MOTIF SANS APPELANT NE SERT A RIEN : la trace ne vaut que si CHAQUE
  // appel le renseigne. Un cadrage anonyme dans la console designerait tous
  // les appelants a la fois, donc aucun.
  // ═════════════════════════════════════════════════════════════════════════
  verifie('tout cadrage laisse une trace dans la console',
    /function centrerSurZoneVisible\(lonLat, zoomCible, motif\)/.test(src) &&
    /log\('cadrage'/.test(src),
    'centrerSurZoneVisible ne journalise pas, ou ne prend pas de motif');
  verifie('la trace dit le zoom AVANT et le zoom demande',
    /zoom ' \+ zAvant/.test(src) && /' → ' \+ zoomCible/.test(src),
    'sans les deux zooms, la ligne ne dit pas s\'il y a eu recul');
  verifie('la trace SIGNALE le zoom arriere',
    /zoomCible < zAvant/.test(src),
    'un recul de zoom se lit comme un cadrage ordinaire');
  // ⚠️ Le journal ne doit JAMAIS empecher le cadrage : il vit dans son propre
  // try, avant celui du calcul.
  // ⚠️⚠️ CE VERROU A DEJA TENU SUR UNE DISTANCE EN CARACTERES, et il est tombe
  // a la premiere ligne ajoutee dans le bloc — alors que le contrat protege
  // etait INTACT. On lit donc la STRUCTURE : le premier `catch` qui suit la
  // trace est bien celui qui l'absorbe.
  {
    const i = src.indexOf("log('cadrage'");
    const j = src.indexOf('catch (e)', i);
    verifie('la trace ne peut pas empecher le cadrage',
      i > 0 && j > i && /la trace ne doit jamais empecher le cadrage/.test(src.slice(j, j + 120)),
      'le premier catch qui suit la trace n\'est pas celui qui l\'absorbe');
  }

  // ── Le plancher de zoom (v2.38) ────────────────────────────────────────
  // ⭐ La regle existait DEJA dans `cadrageDeReport` (« au-dela, WME ne
  // descendrait plus rien ») mais ne valait que pour les reports : les cadrages
  // de GEOMETRIE posaient l'editeur au zoom 12-13, sur une carte vide.
  verifie('aucun cadrage ne descend sous le zoom de chargement',
    /zoomCible != null && zoomCible < ZOOM_CHARGEMENT[\s\S]{0,140}zoomCible = ZOOM_CHARGEMENT;/.test(src),
    'un cadrage peut encore poser l\'editeur la ou WME n\'a rien charge');
  // ⚠️ Le relevement doit se faire AVANT la trace, sinon la ligne annonce un
  // zoom qui ne sera pas applique — et c'est elle qui sert a diagnostiquer.
  verifie('la trace annonce le zoom REELLEMENT applique',
    src.indexOf('zoomCible = ZOOM_CHARGEMENT;') < src.indexOf("log('cadrage'"),
    'la trace est calculee avant le relevement : elle annoncera le mauvais zoom');
  verifie('la trace DIT quand elle a relevé le zoom',
    /zoomDemande != null \?/.test(src),
    'le relevement est silencieux : la ligne laisse croire que le zoom demande a ete applique');

  // Chaque appel de la fonction, sauf sa definition, passe un motif.
  {
    const appels = (src.match(/centrerSurZoneVisible\((?!lonLat)[^\n]*/g) || []);
    const muets = appels.filter(a => !/,\s*'|,\s*"|, *['"]|motif/.test(a) ||
      (a.match(/,/g) || []).length < 2);
    verifie('les ' + appels.length + ' cadrages sont tous nommes',
      appels.length >= 5 && muets.length === 0,
      muets.length + ' cadrage(s) sans motif : ' + muets.join(' | '));
  }
}

console.log((ko ? '✗' : '✓') + ' ' + ok + ' verification(s), ' + ko + ' echec(s)');
process.exit(ko ? 1 : 0);
