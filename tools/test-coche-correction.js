/**
 * COCHE D'UNE CORRECTION : elle ne se retient pas comme un ✓ de l'editeur.
 *
 * ⚠️ ORIGINE : audit du 25/09/2026 (A12). Une correction appliquee barrait la ligne ET l'inscrivait
 * dans `traites[INSEE]`, synchronise entre postes. Apres un Ctrl+Z ou un refus a l'enregistrement,
 * l'ecart revenu reapparaissait barre a chaque analyse : faux negatif durable. Et `resteAlaMain`
 * n'etait appelee nulle part : une correction partielle barrait aussi la ligne.
 *
 * `marquerTraite` est EXTRAITE du userscript, sur un DOM et un stockage simules.
 * Temoin : sans la garde `persister`, la coche d'une correction s'ecrit dans `traites`.
 *
 * Usage : node tools/test-coche-correction.js [fichier.user.js]
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
function monter(fn) {
  const etat = { traites: {}, sauve: 0 };
  const marquer = new Function('communeActive', 'traites', 'clesTraite', 'saveTraites', 'redrawEcarts',
    'majCompteurTraites', 'majBoutonsGroupes', 'replierThematiquesFinies',
    fn + '\nreturn marquerTraite;')(
    { code: '11106' }, etat.traites, f => ['seg:' + f.segId], () => { etat.sauve++; },
    () => {}, () => {}, () => {}, () => {});
  return { marquer, etat };
}
const noeud = () => ({ classList: { toggle() {} } });

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}

const fn = extraire(src, 'marquerTraite');
console.log('\n=== La coche d\'une correction ===');
let { marquer, etat } = monter(fn);
let f = { segId: 42 };
marquer(f, noeud(), true, false);
verifier('la ligne est barree pour la session', f.traite, true);
verifier('… mais rien n\'est retenu dans traites', etat.traites, {});
verifier('… ni sauve', etat.sauve, 0);

console.log('\n=== Le ✓ de l\'editeur (inchange) ===');
({ marquer, etat } = monter(fn));
f = { segId: 43 };
marquer(f, noeud());
verifier('le ✓ se retient', etat.traites, { 11106: { 'seg:43': true } });
marquer(f, noeud());
verifier('le ✓ decoche se retire (la cle reste, vide)', etat.traites, { 11106: {} });

console.log('\n=== Branchements dans corriger ===');
const corps = extraire(src, 'corriger');
verifier('corriger consulte resteAlaMain avant de barrer', /const reste = resteAlaMain\(f\)/.test(corps), true);
verifier('corriger barre SANS retenir', /marquerTraite\(f, noeuds\[i\], true, false\)/.test(corps), true);
verifier('corriger ne barre plus en retenant', /marquerTraite\(f, noeuds\[i\], true\)/.test(corps), false);

console.log('\n=== Temoin ===');
const mutant = fn.replace('if (insee && persister !== false)', 'if (insee)');
if (mutant === fn) { ko++; console.log('  ECHEC temoin : la garde est introuvable'); }
else {
  const m = monter(mutant);
  m.marquer({ segId: 44 }, noeud(), true, false);
  verifier('TEMOIN : sans la garde, la coche d\'une correction se retient', m.etat.traites, { 11106: { 'seg:44': true } });
}

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
