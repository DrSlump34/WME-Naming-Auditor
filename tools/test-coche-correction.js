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
// v2.50.11 : la persistance est sortie dans `retenirTraite`, les redessins dans `apresTraite`,
// et `marquerGroupe` (bouton « ✓ tout ») s'en sert aussi : on les monte ensemble.
function monter(fn) {
  const etat = { traites: {}, sauve: 0, redessins: 0 };
  const lot = new Function('communeActive', 'traites', 'clesTraite', 'saveTraites', 'redrawEcarts',
    'majCompteurTraites', 'majBoutonsGroupes', 'replierThematiquesFinies',
    fn + '\nreturn { marquerTraite, marquerGroupe };')(
    { code: '11106' }, etat.traites, f => ['seg:' + f.segId], () => { etat.sauve++; },
    () => { etat.redessins++; }, () => {}, () => {}, () => {});
  return { marquer: lot.marquerTraite, groupe: lot.marquerGroupe, etat };
}
const noeud = () => ({ classList: { toggle() {} } });

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}

const fn = ['marquerTraite', 'retenirTraite', 'apresTraite', 'marquerGroupe']
  .map(n => extraire(src, n)).join('\n');
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
const mutant = fn.replace('if (persister !== false && retenirTraite(f))', 'if (retenirTraite(f))');
if (mutant === fn) { ko++; console.log('  ECHEC temoin : la garde est introuvable'); }
else {
  const m = monter(mutant);
  m.marquer({ segId: 44 }, noeud(), true, false);
  verifier('TEMOIN : sans la garde, la coche d\'une correction se retient', m.etat.traites, { 11106: { 'seg:44': true } });
}

console.log('\n=== Le « ✓ tout » de l\'en-tete de groupe (v2.50.11) ===');
const g = monter(fn);
const lot = [{ segId: 1 }, { segId: 2, traite: true }, { segId: 3 }];
g.groupe(lot, lot.map(noeud));
verifier('un groupe en partie coche : tout se coche', lot.map(x => x.traite), [true, true, true]);
verifier('… et tout se retient, comme un ✓ de l\'editeur', g.etat.traites,
  { 11106: { 'seg:1': true, 'seg:2': true, 'seg:3': true } });
verifier('… en UNE sauvegarde et UN redessin', [g.etat.sauve, g.etat.redessins], [1, 1]);
g.groupe(lot, lot.map(noeud));
verifier('second clic sur un groupe tout coche : tout se decoche', lot.map(x => x.traite), [false, false, false]);
verifier('… et se retire (la cle reste, vide)', g.etat.traites, { 11106: {} });

console.log('\n=== Temoins du « ✓ tout » ===');
const m1 = fn.replace('const etat = !membres.every(f => f.traite);', 'const etat = !membres.some(f => f.traite);');
if (m1 === fn) { ko++; console.log('  ECHEC temoin : la regle de bascule est introuvable'); }
else {
  const m = monter(m1); const l = [{ segId: 1 }, { segId: 2, traite: true }];
  m.groupe(l, l.map(noeud));
  verifier('TEMOIN : avec « some », un groupe en partie coche se DECOCHE', l.map(x => x.traite), [false, false]);
}
const m2 = fn.replace('      if (retenirTraite(f)) aSauver = true;', '      if (retenirTraite(f)) { aSauver = true; saveTraites(); }');
if (m2 === fn) { ko++; console.log('  ECHEC temoin : la sauvegarde du lot est introuvable'); }
else {
  const m = monter(m2); const l = [{ segId: 1 }, { segId: 2 }, { segId: 3 }];
  m.groupe(l, l.map(noeud));
  verifier('TEMOIN : sauver dans la boucle ecrit 4 fois au lieu d\'une', m.etat.sauve, 4);
}

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
