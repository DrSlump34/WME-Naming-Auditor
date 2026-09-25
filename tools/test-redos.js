/**
 * DICTIONNAIRE : une regle qui pourrait figer WME est ecartee au chargement (audit du 25/09/2026).
 *
 * La feuille « public » vit sans validation ; un motif a quantificateurs imbriques peut backtracker
 * en temps exponentiel, et `replace` ne s'interrompt pas. `regleDangereuse` et `analyserDictionnaire`
 * sont EXTRAITES du script. Le motif designe les suspectes ; l'essai sur etalon tranche.
 * Mesure du 25/09/2026 sur les feuilles reelles : 1 435 regles, AUCUNE ecartee — dont 5 designees
 * par le motif (parkings, echangeurs) et saines : elles doivent rester.
 * Temoin : sans l'appel a `regleDangereuse`, la regle piegee entre dans la cascade.
 *
 * Usage : node tools/test-redos.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'WME-Naming-Auditor.user.js', 'utf8');
const fn = (s, nom) => { const a = s.indexOf('function ' + nom + '('); if (a < 0) throw new Error(nom);
  let n = 0, b = s.indexOf('{', a); for (; b < s.length; b++) { if (s[b] === '{') n++; else if (s[b] === '}') { n--; if (!n) break; } }
  return s.slice(a, b + 1); };
const cst = (s, nom) => s.match(new RegExp('const ' + nom + ' = [^\\n]+'))[0];
const monter = s => new Function('REF', cst(s, 'RE_QUANTIF_IMBRIQUE') + '\n' + cst(s, 'SEUIL_REGLE_LENTE_MS') + '\n' +
  fn(s, 'regleDangereuse') + '\n' + fn(s, 'analyserDictionnaire') +
  '\nreturn { analyser: analyserDictionnaire, dangereuse: regleDangereuse };')({ dicoFonctions: {} });

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
const api = monter(src);
const B = String.fromCharCode(92);   // barre oblique inverse, fabriquee (jamais tapee dans un gabarit)

console.log('\n=== Les regles piegees sont reconnues ===');
for (const m of ['(a+)+b', '(a*)*b', '(x+x+)+y']) {
  const t = Date.now();
  verifier('« ' + m + ' » est dangereuse', api.dangereuse(new RegExp(m)), true);
  verifier('   … et l\'essai reste court (' + (Date.now() - t) + ' ms < 500)', Date.now() - t < 500, true);
}
console.log('\n=== Les regles saines restent ===');
// Les formes des 5 regles reelles designees par le motif (feuille publique, 25/09/2026).
const parking = '(Parking[s]*[ ]*|pkg[ ]*|' + B + '[P' + B + '][ ]*)+((Public[s]* |Gratuit[s]* )*)';
verifier('la forme « parkings » de la feuille publique n\'est pas écartée', api.dangereuse(new RegExp(parking, 'gi')), false);
verifier('une regle sans quantificateur imbrique n\'est meme pas essayee', api.dangereuse(/( |^)Av[.] /gi), false);

console.log('\n=== Dans le chargement ===');
const csv = ['/( |^)Av[.] /gi,"$1Avenue "', '/(a+)+b/,"x"'].join('\n');
const r = api.analyser(csv, 1);
verifier('la saine entre, la piegee est ecartee et comptee', [r.regles.length, r.dangereuses], [1, 1]);
verifier('le chargement DIT les regles ecartees', /règle\(s\) écartée\(s\), trop lente\(s\)/.test(src), true);

console.log('\n=== Temoin ===');
const mutant = src.replace('if (regleDangereuse(re)) { dangereuses++; return; }', '');
if (mutant === src) { ko++; console.log('  ECHEC temoin introuvable'); }
else verifier('TEMOIN : sans le filtre, la regle piegee entre dans la cascade', monter(mutant).analyser(csv, 1).regles.length, 2);

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
