/**
 * Tests du GARDE-FOU TERRITORIAL (v2.03, corrige en 2.19.04).
 *
 * Ce que ces tests protegent, dans les deux sens :
 *  - le script ne doit JAMAIS appliquer des regles francaises hors de France
 *    (c'est tout l'objet du garde-fou) ;
 *  - mais il ne doit PAS NON PLUS se bloquer devant une commune francaise
 *    parfaitement identifiee. C'est ce qui est arrive a GRUISSAN le 27/07 :
 *    apres le cadrage, le centre du canvas tombait EN MER (hors contour) et le
 *    zoom etait trop faible pour que WME charge un segment — les deux preuves
 *    muettes, donc « territoire indetermine » sur une commune selectionnee.
 *    Arbitrage de l'auteur : « Gruissan est en France. Point barre. »
 *
 * ⚠️ Fonctions et constantes EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-territoire.js
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
function relire(nom) {
  const m = src.match(new RegExp('const\\s+' + nom + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('constante introuvable : ' + nom);
  return 'const ' + nom + ' = ' + m[1] + ';';
}

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else { ko++; lignes.push('  ECHEC ' + titre +
    '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
function titre(t) { lignes.push('\n' + t); }

/**
 * Monte `detecterPays` avec un faux SDK. `etat` decrit la situation :
 *   centre    — centre de la carte rendu par le SDK
 *   extent    — emprise de la vue
 *   communes  — contours INSEE charges
 *   active    — commune selectionnee dans la liste
 *   segments  — segments charges, avec leur pays
 */
function monter(etat) {
  const sdk = {
    Map: {
      getMapCenter: () => etat.centre,
      getMapExtent: () => etat.extent
    },
    DataModel: {
      Segments: {
        getAll: () => (etat.segments || []).map((s, i) => ({ id: i, geometry: s.geometry })),
        getAddress: ({ segmentId }) => ({ country: (etat.segments || [])[segmentId].pays })
      }
    }
  };
  const code = [
    relire('bboxIntersecte'),
    extraire('pointInRing'), extraire('pointInRings'), extraire('pointInGeom'),
    extraire('communeDuPoint'), extraire('detecterPays'),
    'return detecterPays;'
  ].join('\n');
  return new Function('sdk', 'communes', 'communeActive', 'bboxIntersecte_unused', code)
    .call(null, sdk, etat.communes || [], etat.active || null);
}

// Gruissan, tel qu'il est en base : un contour cotier. La mer est a l'EST.
const carre = (x0, y0, x1, y1) => ({ type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const GRUISSAN = { code: '11170', nom: 'Gruissan',
  geom: carre(3.05, 43.08, 3.12, 43.15), bbox: [3.05, 43.08, 3.12, 43.15] };
const EN_MER = { lon: 3.30, lat: 43.11 };          // a l'est du contour
const SUR_TERRE = { lon: 3.08, lat: 43.11 };       // dans le contour
const VUE_LARGE = [3.00, 43.00, 3.60, 43.25];      // englobe la commune ET la mer

titre('Le cas GRUISSAN — une commune choisie est francaise, point barre');
verifier('1. commune sélectionnée, centre EN MER, aucun segment chargé ⇒ France',
  monter({ centre: EN_MER, extent: VUE_LARGE, communes: [GRUISSAN], active: GRUISSAN, segments: [] })(),
  { nom: 'France', code: 'FR' });
verifier('2. … même sans emprise lisible (SDK muet)',
  monter({ centre: EN_MER, extent: null, communes: [GRUISSAN], active: GRUISSAN, segments: [] })(),
  { nom: 'France', code: 'FR' });
verifier('3. … et même si la carte est partie ailleurs : l\'analyse porte sur le CONTOUR',
  monter({ centre: { lon: 2.17, lat: 41.38 }, extent: [2.1, 41.3, 2.3, 41.5],
           communes: [GRUISSAN], active: GRUISSAN, segments: [] })(),
  { nom: 'France', code: 'FR' });

titre('La preuve historique (v2.03) reste intacte');
verifier('4. pas de commune choisie, mais le centre tombe dans un contour ⇒ France',
  monter({ centre: SUR_TERRE, extent: VUE_LARGE, communes: [GRUISSAN], active: null, segments: [] })(),
  { nom: 'France', code: 'FR' });
verifier('5. ⚠️ pas de commune choisie, centre EN MER, rien de chargé ⇒ INDÉTERMINÉ',
  monter({ centre: EN_MER, extent: VUE_LARGE, communes: [GRUISSAN], active: null, segments: [] })(),
  null);

titre('⚠️ VERROU : hors de France, rien ne doit passer');
const SEG_ES = { geometry: { type: 'LineString', coordinates: [[2.17, 41.38], [2.18, 41.39]] },
                 pays: { name: 'Spain', abbr: 'SP' } };
verifier('6. Barcelone, aucune commune choisie ⇒ Spain (le blocage joue)',
  monter({ centre: { lon: 2.17, lat: 41.38 }, extent: [2.1, 41.3, 2.3, 41.5],
           communes: [GRUISSAN], active: null, segments: [SEG_ES] })(),
  { nom: 'Spain', code: 'SP' });
verifier('7. ⚠️ des contours FR chargés ne suffisent PAS à se croire en France',
  monter({ centre: { lon: 2.17, lat: 41.38 }, extent: [2.1, 41.3, 2.3, 41.5],
           communes: [GRUISSAN], active: null, segments: [] })(),
  null);
verifier('8. aucun contour, aucun segment ⇒ indéterminé (et non « France » par défaut)',
  monter({ centre: SUR_TERRE, extent: VUE_LARGE, communes: [], active: null, segments: [] })(),
  null);

titre('Le pays MAJORITAIRE des segments de la vue');
const SEG_FR = { geometry: { type: 'LineString', coordinates: [[3.08, 43.11], [3.09, 43.12]] },
                 pays: { name: 'France', abbr: 'FR' } };
verifier('9. deux segments FR contre un ES ⇒ France',
  monter({ centre: EN_MER, extent: VUE_LARGE, communes: [], active: null,
           segments: [SEG_FR, { ...SEG_ES,
             geometry: { type: 'LineString', coordinates: [[3.10, 43.10], [3.11, 43.11]] } }, SEG_FR] })(),
  { nom: 'France', code: 'FR' });
verifier('10. ⚠️ un segment hors de la vue ne compte pas (rémanence après un saut)',
  monter({ centre: EN_MER, extent: [3.00, 43.00, 3.20, 43.20], communes: [], active: null,
           segments: [SEG_ES] })(),        // Barcelone, hors emprise
  null);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(60));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
