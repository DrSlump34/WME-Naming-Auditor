/**
 * Tests du SONDAGE des panneaux d'agglomeration (v2.26.01).
 *
 * ⚠️⚠️ CE QUE CES TESTS PROTEGENT.
 *
 * Le sondage part TOUT SEUL a chaque changement de commune, et c'est lui qui
 * decide si « 🪧 Panneaux d'agglomération » est ouvert ou ferme. Il doit donc
 * tenir deux exigences contraires :
 *
 *  - CONCLURE quand il le peut. Signale par l'auteur le 27/07 sur
 *    Saint-Geniès-de-Comolas : bouton actif alors que la commune n'a AUCUN
 *    panneau. Mesure sur la source : le releve complet trouve 148 EB dans la
 *    bbox et **0 dans le contour** — mais le sondage tenait en UNE cellule, qui
 *    SATURE a 500 items (les B14 remplissent le quota avant les EB10 dans la
 *    vallee du Rhone). Il repondait « incertain », donc bouton actif.
 *    ⇒ Il doit pouvoir DESCENDRE d'un cran.
 *
 *  - RESTER LEGER. Descendre jusqu'au bout, c'est le releve complet (13 requetes
 *    sur Lattes) a chaque clic dans la liste des communes.
 *
 * ⚡ MESURE DU 27/07 SUR 8 COMMUNES — c'est elle qui a fixe les constantes :
 *   zoom 14, budget 12 : Saint-Geniès · Saint-Laurent · Lirac passent de
 *   « incertain » (1 req) a **« aucun »** (5 req) ; Gruissan reste a 1 req.
 *   Le zoom 15 ne change AUCUN verdict et coute plus cher (Lattes 13, Ploemeur 9).
 *
 * ⚠️ Fonction EXTRAITE du userscript, jamais recopiee. L'API est doublee : on
 * eprouve la STRATEGIE de decoupage, pas le reseau.
 *
 * Usage : node tools/test-sondage-panneaux.js
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

function extraire(nom) {
  const i = src.indexOf('async function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let prof = 0, j = src.indexOf('{', src.indexOf('(', i));
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
  else { ko++; lignes.push('  ECHEC ' + titre + '\n          attendu ' +
    JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
function titre(t) { lignes.push('\n' + t); }

// Les constantes reelles du script : si elles changent, les tests suivent.
const val = n => Number((src.match(new RegExp(n + '\\s*=\\s*([\\d.]+)')) || [])[1]);
const Z_DEPART = val('ZOOM_PANNEAUX_DEPART'), Z_MAX = val('ZOOM_PANNEAUX_MAX');
const PLAFOND = val('PLAFOND_API');
const S_ZOOM = val('SONDAGE_ZOOM_MAX'), S_BUDGET = val('SONDAGE_BUDGET');

/**
 * Rejoue `chargerPanneauxAgglo` sur une source SIMULEE.
 * `pleines(zoom)` dit si une cellule de ce zoom rend 500 items.
 */
async function jouer(limites, pleines, panneaux) {
  const appels = [];
  const charger = new Function(
    'ZOOM_PANNEAUX_DEPART', 'ZOOM_PANNEAUX_MAX', 'PLAFOND_API', 'demiEmprise',
    'clePanneau', 'telecharger', 'URL_PANNEAUX', 'AnnulationDemandee', 'log',
    extraire('chargerPanneauxAgglo') + '; return chargerPanneauxAgglo;')(
    Z_DEPART, Z_MAX, PLAFOND,
    z => { const k = Math.pow(2, Z_DEPART - z); return { dLat: 0.1651 * k, dLon: 0.2240 * k }; },
    p => [p.latitude, p.longitude, p.panneau_code].join('|'),
    async url => {
      const zoom = Number(url.match(/zoom=(\d+)/)[1]);
      appels.push(zoom);
      const n = pleines(zoom) ? PLAFOND : 3;
      const rs = [];
      for (let i = 0; i < n; i++) rs.push({ panneau_code: 'B14', latitude: 0, longitude: 0 });
      // Les panneaux d'agglo ne sont servis qu'au zoom ou on les a places.
      for (const p of (panneaux[zoom] || [])) rs.push(p);
      return JSON.stringify({ rs });
    },
    (lat, lon, zoom) => `x?lat=${lat}&lon=${lon}&zoom=${zoom}`,
    class AnnulationDemandee extends Error {}, () => {});
  // bbox d'une petite commune : une seule cellule de depart.
  const r = await charger([4.70, 44.03, 4.73, 44.06], null, limites);
  return { ...r, appels };
}

const SONDAGE = { zoomMax: S_ZOOM, budget: S_BUDGET };
const jamaisPleine = () => false;
const toujoursPleine = () => true;
const pleineJusqua = z => zoom => zoom <= z;

(async () => {

titre('⭐ LE CAS SAINT-GENIÈS : la cellule sature, mais la commune n\'a rien');
{
  // Une cellule z13 pleine, les z14 ne le sont plus et ne contiennent aucun EB.
  const r = await jouer(SONDAGE, pleineJusqua(13), {});
  verifier('1. ⭐ le sondage DESCEND au lieu de renoncer', r.appels.length > 1, true);
  verifier('2. ⭐ il conclut : plus de doute (`tronque` faux)', r.tronque, false);
  verifier('3. ⭐ 0 panneau ⇒ etat « aucun » ⇒ bouton GRISE',
    (r.panneaux.length ? 'des' : r.tronque ? 'incertain' : 'aucun'), 'aucun');
  verifier('4. ⚡ et ca coute 5 requetes, comme mesure en vrai', r.appels.length, 5);
  verifier('5. … dont une seule au zoom de depart',
    r.appels.filter(z => z === Z_DEPART).length, 1);
}

titre('⚠️ MAIS IL RESTE LEGER : il ne se transforme pas en releve complet');
{
  const r = await jouer(SONDAGE, toujoursPleine, {});
  verifier('6. ⭐ le budget borne le pire cas', r.appels.length <= S_BUDGET, true);
  verifier('7. ⭐ et il ne descend JAMAIS sous son zoom maximal',
    Math.max(...r.appels) <= S_ZOOM, true);
  verifier('8. ⭐ budget epuise ⇒ on ne conclut PAS (« incertain », bouton actif)',
    r.tronque, true);
  verifier('9. ⚠️ un doute ne doit jamais se lire « aucun panneau »',
    (r.panneaux.length ? 'des' : r.tronque ? 'incertain' : 'aucun'), 'incertain');
}

titre('Le cas simple, et le releve complet');
{
  const r = await jouer(SONDAGE, jamaisPleine, {});
  verifier('10. cellule non pleine ⇒ UNE requete suffit (cas Gruissan)', r.appels.length, 1);
  verifier('11. … et la reponse est ferme', r.tronque, false);

  const eb = { 13: [{ panneau_code: 'EB10', latitude: 44.04, longitude: 4.71 }] };
  const r2 = await jouer(SONDAGE, jamaisPleine, eb);
  verifier('12. des panneaux ⇒ ils remontent', r2.panneaux.length, 1);

  // ⚠️ Le RELEVE, lui, n'a ni budget ni zoom bride : c'est un geste explicite de
  // l'editeur, il a le droit de couter. Le confondre avec le sondage ferait
  // perdre des panneaux EN SILENCE.
  const r3 = await jouer(null, toujoursPleine, {});
  verifier('13. ⭐ le releve complet descend jusqu\'au zoom maximal du script',
    Math.max(...r3.appels), Z_MAX);
  verifier('14. ⭐ et il n\'est PAS borne par le budget du sondage',
    r3.appels.length > S_BUDGET, true);
}

titre('Verrous sur le SOURCE');
{
  verifier('15. ⭐ les constantes du sondage existent et valent ce que la mesure a dit',
    { zoom: S_ZOOM, budget: S_BUDGET }, { zoom: 14, budget: 12 });
  verifier('16. ⭐ le sondage passe bien ces limites (et non plus un booleen)',
    /zoomMax: SONDAGE_ZOOM_MAX, budget: SONDAGE_BUDGET/.test(src), true);
  verifier('17. ⚠️ l\'ancien drapeau `sansSubdivision` a disparu partout',
    /sansSubdivision/.test(src), false);
}

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);

})();
