/**
 * Tests du GUIDAGE PAS A PAS (v2.21) et du parcours « agglomeration » (v2.22).
 *
 * Ce que ces tests protegent : le guidage doit montrer LE geste suivant, et un
 * seul. Une etape franchie doit s'eteindre — sinon l'animation devient un bruit
 * de fond. Et l'ordre doit suivre le parcours reel : relever les panneaux, en
 * tirer un trace, l'affiner, puis analyser.
 *
 * ⚠️ Defaut vecu (v2.21.00) : `majGuidage()` etait a la seule FIN de
 * `renderAgglos`, qui sort par plusieurs chemins — le guidage restait donc muet
 * exactement la ou il sert le plus, quand aucune commune n'est choisie.
 *
 * ⚠️ Fonctions extraites du userscript, jamais recopiees.
 *
 * Usage : node tools/test-guidage.js
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

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else { ko++; lignes.push('  ECHEC ' + titre + '\n          attendu ' +
    JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
function titre(t) { lignes.push('\n' + t); }

/**
 * Monte `etapeCourante` avec un etat complet. Tout est injecte : c'est une
 * fonction de DECISION, elle ne doit dependre de rien d'autre que de l'etat.
 */
function etape(etat) {
  const e = Object.assign({
    guidage: true, paysEtat: 'fr', communes: [{}], communeActive: null,
    edition: null, agglos: {}, sansAgglo: {}, panneaux: [],
    bilanPreTrace: null, sondage: null, lastScan: null
  }, etat);
  const fn = new Function(
    'options', 'pays', 'communes', 'communeActive', 'edition', 'agglos', 'sansAgglo',
    'panneaux', 'bilanPreTrace', 'sondageCourant', 'lastScan',
    extraire('etapeCourante') + '\nreturn etapeCourante();');
  return fn({ guidage: e.guidage }, { etat: e.paysEtat }, e.communes, e.communeActive,
            e.edition, e.agglos, e.sansAgglo, e.panneaux, e.bilanPreTrace,
            () => e.sondage, e.lastScan);
}

const COMMUNE = { code: '83119', nom: 'Saint-Tropez' };

titre('Le parcours, dans l\'ordre');
verifier('1. aucun contour ⇒ amener la carte sur la commune',
  etape({ communes: [] }), 'contours');
verifier('2. des contours, pas de commune choisie ⇒ la choisir',
  etape({}), 'commune');
verifier('3. commune choisie, panneaux non relevés ⇒ les relever',
  etape({ communeActive: COMMUNE, sondage: { etat: 'des', nb: 7 } }), 'agglo-panneaux');
verifier('4. panneaux relevés et exploitables ⇒ proposer un tracé',
  etape({ communeActive: COMMUNE, sondage: { etat: 'des', nb: 7 },
          panneaux: [1, 2, 3], bilanPreTrace: { tracables: 1, rubans: 0, isoles: 0 } }),
  'agglo-proposer');
verifier('5. un polygone existe ⇒ lancer l\'analyse',
  etape({ communeActive: COMMUNE, agglos: { '83119': [{ ring: [] }] } }), 'analyse');
verifier('6. analyse faite ⇒ plus rien a guider',
  etape({ communeActive: COMMUNE, agglos: { '83119': [{ ring: [] }] }, lastScan: {} }), null);

titre('⚠️ Quand les panneaux ne servent a rien, on envoie au trace manuel');
verifier('7. ⭐ aucun panneau sur la commune (cas Gruissan) ⇒ tracer a la main',
  etape({ communeActive: COMMUNE, sondage: { etat: 'aucun', nb: 0 } }), 'agglo-tracer');
verifier('8. ⭐ panneaux relevés mais AUCUN tracé possible (cas Lattes) ⇒ tracer a la main',
  etape({ communeActive: COMMUNE, sondage: { etat: 'des', nb: 5 },
          panneaux: [1, 2, 3, 4, 5], bilanPreTrace: { tracables: 0, rubans: 1, isoles: 1 } }),
  'agglo-tracer');
verifier('9. sondage incertain (source muette, reseau) ⇒ on n\'empeche rien',
  etape({ communeActive: COMMUNE, sondage: { etat: 'incertain', nb: 0 } }), 'agglo-panneaux');

titre('Affiner puis enregistrer le trace propose');
verifier('10. un polygone issu du pre-trace ⇒ inviter a l\'affiner',
  etape({ communeActive: COMMUNE, agglos: { '83119': [{ ring: [], aAffiner: true }] } }), 'affiner');
verifier('11. ⚠️ une edition ouverte passe AVANT tout : rien n\'est enregistre tant qu\'elle dure',
  etape({ communeActive: COMMUNE, agglos: { '83119': [{ ring: [], aAffiner: true }] },
          edition: { agglo: {} } }), 'terminer');
verifier('12. trace affine (drapeau retire) ⇒ on passe a l\'analyse',
  etape({ communeActive: COMMUNE, agglos: { '83119': [{ ring: [] }] } }), 'analyse');

titre('Les cas ou le guidage doit se TAIRE');
verifier('13. guidage decoche ⇒ rien, jamais', etape({ guidage: false }), null);
verifier('14. ⚠️ hors de France : le garde-fou parle deja, on ne le double pas',
  etape({ paysEtat: 'hors', communeActive: COMMUNE }), null);
verifier('15. territoire indetermine ⇒ silence aussi', etape({ paysEtat: 'inconnu' }), null);
verifier('16. commune declaree « sans agglomeration » ⇒ on ne reclame pas de polygone',
  etape({ communeActive: COMMUNE, sansAgglo: { '83119': true } }), 'analyse');

titre('Verrous sur le SOURCE');
{
  const rA = src.slice(src.indexOf('function renderAgglos'));
  const corps = rA.slice(0, rA.indexOf('\n  function ', 10));
  const appels = (corps.match(/majGuidage\(\)/g) || []).length;
  verifier('17. ⚠️ `renderAgglos` rafraichit le guidage sur CHACUNE de ses sorties',
    appels >= 3, true);
  const ordre = src.indexOf('id="agn-panneaux"');
  verifier('18. l\'ordre des boutons suit la progression : panneaux → proposer → tracer',
    ordre < src.indexOf('id="agn-pretrace"') &&
    src.indexOf('id="agn-pretrace"') < src.indexOf('id="agn-tracer"'), true);
}

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(60));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
