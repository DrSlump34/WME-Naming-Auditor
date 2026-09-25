/**
 * ✕ D'UN POLYGONE D'AGGLOMERATION : un sursis avec « Annuler », pas une suppression seche.
 *
 * ⚠️ ORIGINE : audit du 25/09/2026 (A13). Le ✕ supprimait d'un clic et enregistrait aussitot
 * (donc propageait aux autres postes). Recommandation : pas de `confirm`, mais « Polygone
 * supprimé — Annuler » quelques secondes AVANT `saveAgglos`.
 *
 * `supprimerPolygone`, `validerSuppression` et `annulerSuppression` sont EXTRAITES du userscript ;
 * la minuterie est simulee (on la declenche a la main). Temoin : la version d'avant enregistre
 * des le clic.
 *
 * Usage : node tools/test-suppression-polygone.js [fichier.user.js]
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
const delai = src.match(/const SURSIS_SUPPRESSION_MS = (\d+);/);

function monter(s) {
  const monde = { sauvegardes: 0, minuteries: [], agglos: {} };
  const api = new Function('agglos', 'communeActive', 'saveAgglos', 'redrawAgglos', 'renderAgglos',
    'setTimeout', 'clearTimeout',
    'const SURSIS_SUPPRESSION_MS = ' + (delai ? delai[1] : 0) + ';\nlet sursis = null;\n' +
    extraire(s, 'supprimerPolygone') + '\n' + extraire(s, 'validerSuppression') + '\n' +
    extraire(s, 'annulerSuppression') +
    '\nreturn { supprimerPolygone, validerSuppression, annulerSuppression };')(
    monde.agglos, { code: '11106' }, () => { monde.sauvegardes++; }, () => {}, () => {},
    (fn, ms) => { monde.minuteries.push({ fn, ms, vive: true }); return monde.minuteries.length - 1; },
    id => { if (monde.minuteries[id]) monde.minuteries[id].vive = false; });
  monde.echeance = () => monde.minuteries.filter(m => m.vive).forEach(m => { m.vive = false; m.fn(); });
  return { api, monde };
}

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
const P = n => ({ label: n, ring: [] });

verifier('le sursis dure quelques secondes (entre 3 et 10 s)',
         !!delai && +delai[1] >= 3000 && +delai[1] <= 10000, true);

console.log('\n=== Supprimer puis laisser courir ===');
let { api, monde } = monter(src);
monde.agglos['11106'] = [P('Bourg'), P('Hameau')];
api.supprimerPolygone(monde.agglos['11106'], 1);
verifier('le polygone disparait tout de suite', monde.agglos['11106'].map(a => a.label), ['Bourg']);
verifier('… mais RIEN n\'est enregistre pendant le sursis', monde.sauvegardes, 0);
monde.echeance();
verifier('a l\'echeance, la suppression est enregistree', monde.sauvegardes, 1);

console.log('\n=== Supprimer puis Annuler ===');
({ api, monde } = monter(src));
monde.agglos['11106'] = [P('Bourg'), P('Hameau'), P('Plage')];
api.supprimerPolygone(monde.agglos['11106'], 1);
api.annulerSuppression();
verifier('le polygone revient A SA PLACE', monde.agglos['11106'].map(a => a.label), ['Bourg', 'Hameau', 'Plage']);
monde.echeance();
verifier('l\'echeance ne supprime plus rien', monde.agglos['11106'].length, 3);

console.log('\n=== Le DERNIER polygone ===');
({ api, monde } = monter(src));
monde.agglos['11106'] = [P('Seul')];
api.supprimerPolygone(monde.agglos['11106'], 0);
verifier('la cle reste, vide (v2.26.04)', monde.agglos['11106'], []);
api.annulerSuppression();
verifier('Annuler le rend', monde.agglos['11106'].map(a => a.label), ['Seul']);

console.log('\n=== Deux ✕ de suite ===');
({ api, monde } = monter(src));
monde.agglos['11106'] = [P('A'), P('B'), P('C')];
api.supprimerPolygone(monde.agglos['11106'], 0);
api.supprimerPolygone(monde.agglos['11106'], 0);
verifier('la premiere suppression part quand la seconde commence', monde.sauvegardes, 1);
api.annulerSuppression();
verifier('Annuler ne rend que la seconde', monde.agglos['11106'].map(a => a.label), ['B', 'C']);

console.log('\n=== Branchements ===');
verifier('le ✕ passe par supprimerPolygone', /\.agn-del'\)\.onclick = \(\) => supprimerPolygone\(liste, i\)/.test(src), true);
verifier('le bandeau s\'affiche aussi quand la liste est devenue vide',
         (src.match(/afficherSursis\(\);/g) || []).length, 2);
verifier('aucun confirm sur le ✕', /agn-del[\s\S]{0,200}confirm\(/.test(src), false);

console.log('\n=== Temoin ===');
const mutant = src.replace(/(function supprimerPolygone\([^)]*\) \{[\s\S]*?)redrawAgglos\(\); renderAgglos\(\);/,
                           '$1saveAgglos(); redrawAgglos(); renderAgglos();');
if (mutant === src) { ko++; console.log('  ECHEC temoin introuvable'); }
else {
  const m = monter(mutant);
  m.monde.agglos['11106'] = [P('Bourg')];
  m.api.supprimerPolygone(m.monde.agglos['11106'], 0);
  verifier('TEMOIN : enregistrer au clic, c\'est enregistrer pendant le sursis', m.monde.sauvegardes, 1);
}

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
