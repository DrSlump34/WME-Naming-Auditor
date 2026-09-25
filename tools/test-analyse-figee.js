/**
 * LA COMMUNE EST FIGEE PENDANT UNE ANALYSE (audit du 25/09/2026).
 *
 * `scan()` attend une quinzaine de fois, et son balayage DEPLACE la carte : entre deux attentes,
 * « la carte a quitte la commune », une purge de departements, le vidage de la base ou le selecteur
 * changeaient `communeActive`. Ces chemins vivent dans des fonctions d'interface (DOM, carte) qu'on
 * ne rejoue pas ici : le banc verifie que chacun est garde par `analyseEnCours`, et que le drapeau
 * est leve puis rabattu autour de l'analyse, meme en cas d'echec (finally).
 *
 * Usage : node tools/test-analyse-figee.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'WME-Naming-Auditor.user.js', 'utf8');
let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
verifier('le drapeau existe', /let analyseEnCours = false;/.test(src), true);
verifier('il se leve avec l\'analyse, et le selecteur de commune se grise',
  /analyseEnCours = true; ui\.selCommune\.disabled = true;\s*\n\s*try \{ await scan\(\); \}/.test(src), true);
verifier('il retombe dans le finally (meme si l\'analyse echoue)',
  /finally \{[\s\S]{0,120}analyseEnCours = false; ui\.selCommune\.disabled = false;/.test(src), true);
verifier('« la carte a quitte la commune » ne la lache pas pendant l\'analyse',
  /else if \(communeActive && !analyseEnCours\) \{\s*\n\s*\/\/ ⚠️⚠️ LA CARTE A QUITTE LA COMMUNE/.test(src), true);
verifier('la purge ne la retire pas pendant l\'analyse',
  /if \(communeActive && !analyseEnCours && set\.has\(depDuCode\(communeActive\.code\)\)\)/.test(src), true);
verifier('le vidage de la base attend la fin de l\'analyse',
  /async function viderContours\(\) \{\s*\n\s*if \(analyseEnCours\) return;/.test(src), true);
verifier('aucune autre affectation de communeActive que les quatre connues (+ declaration)',
  (src.match(/communeActive = /g) || []).length, 5);
console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
