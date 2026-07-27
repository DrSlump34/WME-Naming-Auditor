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
    bilanPreTrace: null, sondage: null, lastScan: null,
    // v2.23 : les secteurs d'entrees non couverts retiennent le parcours — une
    // agglomeration oubliee fausse toute l'analyse.
    secteurs: [], couverts: [],
    // v2.24.02 : « le releve a-t-il ete FAIT » ≠ « il y a des panneaux ».
    releveFait: false, voletOuvert: false
  }, etat);
  // Par commodite : renseigner `panneaux` implique que le releve a eu lieu.
  if (e.panneaux.length) e.releveFait = true;
  const fn = new Function(
    'options', 'pays', 'communes', 'communeActive', 'edition', 'agglos', 'sansAgglo',
    'panneaux', 'bilanPreTrace', 'sondageCourant', 'lastScan',
    'secteursCourants', 'secteurCouvert', 'releveFait', 'ui',
    extraire('etapeCourante') + '\nreturn etapeCourante();');
  return fn({ guidage: e.guidage }, { etat: e.paysEtat }, e.communes, e.communeActive,
            e.edition, e.agglos, e.sansAgglo, e.panneaux, e.bilanPreTrace,
            () => e.sondage, e.lastScan,
            e.secteurs, g => e.couverts.includes(g), e.releveFait,
            { volet: { classList: { contains: () => e.voletOuvert } } });
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
verifier('5. ⭐ un polygone existe, mais panneaux PAS relevés ⇒ les relever d\'abord',
  etape({ communeActive: COMMUNE, agglos: { '83119': [{ ring: [] }] } }), 'agglo-panneaux');
verifier('5. … c\'est le seul moyen de savoir si le polygone couvre TOUTE la commune',
  etape({ communeActive: COMMUNE, agglos: { '83119': [{ ring: [] }] },
          panneaux: [1, 2], bilanPreTrace: { tracables: 1 } }), 'analyse');
verifier('6. analyse faite ⇒ plus rien a guider (et pas de retour en boucle)',
  etape({ communeActive: COMMUNE, agglos: { '83119': [{ ring: [] }] }, lastScan: {} }), null);
verifier('6. … même sans panneaux relevés', etape({ communeActive: COMMUNE, lastScan: {} }), null);

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
// ⚠️ Un polygone issu du PRE-TRACE implique que les panneaux ont ete releves :
// l'etat « aAffiner sans panneaux » ne peut pas exister dans la vraie vie.
const RELEVE = [1, 2, 3];
verifier('10. un polygone issu du pre-trace ⇒ inviter a l\'affiner',
  etape({ communeActive: COMMUNE, panneaux: RELEVE,
          agglos: { '83119': [{ ring: [], aAffiner: true }] } }), 'affiner');
verifier('11. ⚠️ une edition ouverte passe AVANT tout : rien n\'est enregistre tant qu\'elle dure',
  etape({ communeActive: COMMUNE, panneaux: RELEVE,
          agglos: { '83119': [{ ring: [], aAffiner: true }] },
          edition: { agglo: {} } }), 'terminer');
verifier('12. trace affine (drapeau retire) ⇒ on passe a l\'analyse',
  etape({ communeActive: COMMUNE, panneaux: RELEVE,
          agglos: { '83119': [{ ring: [] }] } }), 'analyse');

titre('⚠️ EXHAUSTIVITE : une agglomeration oubliee fausse toute l\'analyse');
{
  // Deux secteurs releves, un seul couvert par un polygone : il reste du travail,
  // et le guidage doit le dire AVANT de laisser passer a l'analyse.
  const s1 = { g: { centre: { lon: 0, lat: 0 }, portes: 4 } };
  const s2 = { g: { centre: { lon: 1, lat: 1 }, portes: 2 } };
  // Des secteurs connus supposent un releve : `panneaux` est donc renseigne.
  verifier('17. ⭐ un secteur non couvert ⇒ inviter a tracer la suite',
    etape({ communeActive: COMMUNE, panneaux: RELEVE, agglos: { '83119': [{ ring: [] }] },
            secteurs: [s1, s2], couverts: [s1.g] }), 'agglo-encore');
  verifier('18. tous les secteurs couverts ⇒ on passe a l\'analyse',
    etape({ communeActive: COMMUNE, panneaux: RELEVE, agglos: { '83119': [{ ring: [] }] },
            secteurs: [s1, s2], couverts: [s1.g, s2.g] }), 'analyse');
  verifier('19. ⚠️ le trace a affiner passe AVANT le rappel d\'exhaustivite',
    etape({ communeActive: COMMUNE, panneaux: RELEVE,
            agglos: { '83119': [{ ring: [], aAffiner: true }] },
            secteurs: [s1, s2], couverts: [] }), 'affiner');
  verifier('20. aucun secteur connu ⇒ pas de faux rappel (on ne sait rien)',
    etape({ communeActive: COMMUNE, panneaux: RELEVE, agglos: { '83119': [{ ring: [] }] },
            secteurs: [], couverts: [] }), 'analyse');
}

titre('⚠️ LE CAS LIRAC : un relevé qui ne rend RIEN');
{
  // 980 ha, 0 panneau dans le contour. Le sondage avait repondu « incertain »
  // (cellule pleine pres d'Avignon), donc le bouton restait actif.
  verifier('21. ⭐ relevé FAIT mais aucun panneau ⇒ tracer a la main',
    etape({ communeActive: COMMUNE, releveFait: true, panneaux: [],
            sondage: { etat: 'incertain', nb: 0 } }), 'agglo-tracer');
  verifier('22. ⚠️ et surtout PAS un retour sur le bouton qu\'on vient de cliquer',
    etape({ communeActive: COMMUNE, releveFait: true, panneaux: [] }) !== 'agglo-panneaux', true);
  verifier('23. relevé PAS ENCORE fait ⇒ la, on y envoie',
    etape({ communeActive: COMMUNE, releveFait: false, panneaux: [] }), 'agglo-panneaux');
}

titre('Le zonage est fait : refermer le volet, PUIS analyser');
{
  const pret = { communeActive: COMMUNE, panneaux: [1], agglos: { '83119': [{ ring: [] }] } };
  verifier('24. ⭐ volet OUVERT ⇒ inviter a le refermer (il recouvre le bouton d\'analyse)',
    etape(Object.assign({ voletOuvert: true }, pret)), 'volet-terminer');
  verifier('25. volet ferme ⇒ lancer l\'analyse',
    etape(Object.assign({ voletOuvert: false }, pret)), 'analyse');
  verifier('26. ⚠️ mais un secteur decouvert passe AVANT de proposer de terminer',
    etape(Object.assign({ voletOuvert: true,
      secteurs: [{ g: { centre: { lon: 0, lat: 0 }, portes: 2 } }], couverts: [] }, pret)),
    'agglo-encore');
}

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
