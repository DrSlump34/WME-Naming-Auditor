/**
 * ⚡ DE GROUPE : un report marque d'un doute ne part pas en lot.
 *
 * ⚠️ ORIGINE : audit du 25/09/2026 (A4). Le ⚡ de groupe appliquait tous les reports
 * automatisables, doute compris (SPECIFICATIONS §11 points 4 et 5) ; sa confirmation comptait
 * aussi les segments verrouilles, qu'il ne touche pas.
 *
 * `corrigeableEnGroupe` est EXTRAITE du userscript ; `planDeCorrection` est simule (non nul).
 * Temoin : le filtre d'avant (`planDeCorrection` seul) doit laisser passer la rocade devinee.
 *
 * Usage : node tools/test-lot-doute.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'WME-Naming-Auditor.user.js', 'utf8');

function extraire(s, nom) {
  const i = s.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let prof = 0, j = s.indexOf('{', i);
  for (; j < s.length; j++) {
    if (s[j] === '{') prof++;
    else if (s[j] === '}') { prof--; if (!prof) break; }
  }
  return s.slice(i, j + 1);
}
const lot = new Function('planDeCorrection', extraire(src, 'corrigeableEnGroupe') +
  '\nreturn corrigeableEnGroupe;')(f => f.plan === false ? null : [{}]);

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}

console.log('\n=== Qui part en lot ===');
verifier('report sans doute : oui', lot({ nb: 1, doute: null }), true);
verifier('rocade devinee d\'apres son nom : NON', lot({ nb: 1, doute: 'identifiée comme rocade d\'après son nom' }), false);
verifier('village rattache indeductible : NON', lot({ nb: 1, doute: 'village rattaché : aucune ville sur le segment' }), false);
verifier('segment qui deborde sur la voisine : NON', lot({ nb: 1, doute: 'déborde de 40 m sur la commune voisine' }), false);
verifier('cartouche sur principal (son « doute » previent, il ne doute pas) : oui',
         lot({ nb: 3, cartouche: { streetId: 1 }, doute: 's\'applique à toute la voie' }), true);
verifier('tous les segments verrouilles : NON', lot({ nb: 2, verrouilles: 2, doute: null }), false);
verifier('une partie verrouillee : oui', lot({ nb: 2, verrouilles: 1, doute: null }), true);
verifier('rien d\'automatisable : NON', lot({ nb: 1, plan: false }), false);

console.log('\n=== Branchements ===');
verifier('le ⚡ de groupe filtre avec corrigeableEnGroupe',
         /const aFaire = membres\.filter\(corrigeableEnGroupe\)/.test(src), true);
verifier('le bouton de groupe s\'affiche ET se masque selon corrigeableEnGroupe',
         (src.match(/membres\.some\(corrigeableEnGroupe\)/g) || []).length, 2);
verifier('le nombre de segments annonce retire les verrouilles',
         /nbSeg = aFaire\.reduce\(\(n, x\) => n \+ Math\.max\(0, \(x\.nb \|\| 1\) - \(x\.verrouilles \|\| 0\)\)/.test(src), true);
verifier('la confirmation annonce les reports laisses de cote',
         /avec un doute ne sont pas incluses : à faire une par une/.test(src), true);

console.log('\n=== Temoin ===');
const fn = extraire(src, 'corrigeableEnGroupe');
const mutant = fn.replace('return !(f.doute && !f.cartouche);', 'return true;');
if (mutant === fn) { ko++; console.log('  ECHEC temoin : la garde du doute est introuvable'); }
else verifier('TEMOIN : sans la garde du doute, la rocade devinee part en lot',
  new Function('planDeCorrection', mutant + '\nreturn corrigeableEnGroupe;')(() => [{}])(
    { nb: 1, doute: 'identifiée comme rocade d\'après son nom' }), true);

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
