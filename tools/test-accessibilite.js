/**
 * ACCESSIBILITE (audit du 25/09/2026) : zones de statut annoncees, boites en role=dialog, focus
 * conserve quand la liste des agglomerations se redessine.
 *
 * `memoFocus` et `rendreFocus` sont EXTRAITES du script et jouees sur un DOM simule.
 * Temoin : sans l'appel a `rendreFocus` dans `renderAgglos`, le focus n'est pas rendu.
 *
 * Usage : node tools/test-accessibilite.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'WME-Naming-Auditor.user.js', 'utf8');
const fn = (s, nom) => { const a = s.indexOf('function ' + nom + '('); if (a < 0) throw new Error(nom);
  let n = 0, b = s.indexOf('{', a); for (; b < s.length; b++) { if (s[b] === '{') n++; else if (s[b] === '}') { n--; if (!n) break; } }
  return s.slice(a, b + 1); };
let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}

// Un DOM de papier : une liste de polygones, chacun avec ses controles.
const doc = { activeElement: null };
function liste(nb) {
  const polys = [];
  const racine = { querySelectorAll: () => polys, contains: e => polys.some(p => p.ctrls.includes(e)),
                   querySelector: () => null };
  for (let i = 0; i < nb; i++) {
    const p = { ctrls: [] };
    ['agn-ratt', 'agn-del'].forEach(c => p.ctrls.push({ classList: [c], poly: p, focus() { doc.activeElement = this; },
      closest: () => p }));
    p.querySelector = sel => p.ctrls.find(c => '.' + c.classList[0] === sel) || null;
    polys.push(p);
  }
  return { racine, polys };
}
const api = new Function('document', fn(src, 'memoFocus') + fn(src, 'rendreFocus') + 'return { memoFocus, rendreFocus };')(doc);

let avant = liste(3); doc.activeElement = avant.polys[1].ctrls[0];          // « village rattaché » du 2e
const m = api.memoFocus(avant.racine);
let apres = liste(3); api.rendreFocus(apres.racine, m);
verifier('le focus revient au MEME controle du MEME polygone', doc.activeElement === apres.polys[1].ctrls[0], true);
avant = liste(3); doc.activeElement = avant.polys[2].ctrls[1];              // ✕ du dernier
const m2 = api.memoFocus(avant.racine);
apres = liste(2); api.rendreFocus(apres.racine, m2);
verifier('polygone supprime : le focus passe au meme controle du polygone suivant', doc.activeElement === apres.polys[1].ctrls[1], true);
doc.activeElement = { classList: ['ailleurs'] };
verifier('focus hors de la liste : rien a retenir', api.memoFocus(liste(2).racine), null);

console.log('\n=== Branchements ===');
verifier('renderAgglos retient puis rend le focus',
  /function renderAgglos\(\) \{\s*\n\s*const focusAvant = memoFocus\(ui\.listeAgglos\);/.test(src) &&
  /rendreFocus\(ui\.listeAgglos, focusAvant\);/.test(src), true);
verifier('les trois boites sont des dialogues', (src.match(/class="agn-modale-in" role="dialog" aria-modal="true"/g) || []).length, 3);
verifier('les zones de statut sont annoncees', /\[ui\.stats, ui\.bandeauFix, ui\.statutContours, ui\.zoneInfo, ui\.bilanPanneaux\]\.forEach\(z => \{\s*\n\s*if \(z\) \{ z\.setAttribute\('role', 'status'\)/.test(src), true);

console.log('\n=== Temoin ===');
const mutant = src.replace('rendreFocus(ui.listeAgglos, focusAvant);', '');
verifier('TEMOIN : sans l\'appel, le branchement echoue', /rendreFocus\(ui\.listeAgglos, focusAvant\);/.test(mutant), false);
console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
