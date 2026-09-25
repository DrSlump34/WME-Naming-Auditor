/**
 * CHARTE — CONTRASTE DES PASTILLES PLEINES (arbitrage de l'auteur, 25/09/2026, audit WPEU).
 *
 * Texte blanc sur #2196f3 = 3,12:1 : echoue WCAG AA. Toute pastille PLEINE a texte blanc passe en
 * #1976d2 (4,60:1) ; #2196f3 reste aux titres, au rail allume des interrupteurs, aux barres sans texte.
 * Le banc lit le CSS du script, regle par regle : aucune ne doit poser un texte blanc sur #2196f3
 * (ou sur `--agn-bleu`, qui vaut #2196f3). Temoin : le bouton principal remis en #2196f3 est vu.
 *
 * Usage : node tools/test-charte-couleurs.js [fichier.user.js]
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
/** Les regles CSS du gabarit `CSS`, en { selecteur, corps }. */
function regles(s) {
  const a = s.indexOf('const CSS = `'), b = s.indexOf('`;', a);
  const css = s.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  css.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, corps) => { out.push({ sel: sel.trim(), corps }); return m; });
  return out;
}
const blancSurClair = s => regles(s).filter(r =>
  /(^|;)\s*color:\s*#fff\b/.test(r.corps) &&
  /background(-color)?:\s*(#2196f3|var\(--agn-bleu\b)/.test(r.corps)).map(r => r.sel);

verifier('aucune règle ne pose un texte blanc sur #2196f3', blancSurClair(src), []);
verifier('le bouton principal de la fenêtre est en #1976d2', /\.agn-btn\.primary\{background:#1976d2;color:#fff\}/.test(src), true);
verifier('le bouton principal de l\'onglet est en #1976d2', /\.agn-sb-b\.agn-sb-p\{background:#1976d2;color:#fff\}/.test(src), true);
verifier('#2196f3 reste au rail allumé des interrupteurs', /input\[type=checkbox\]\.agn-ratt:checked\{background:#2196f3\}/.test(src), true);
const mutant = src.replace('.agn-btn.primary{background:#1976d2;color:#fff}', '.agn-btn.primary{background:#2196f3;color:#fff}');
verifier('TEMOIN : le bouton principal remis en #2196f3 est vu', mutant !== src && blancSurClair(mutant).includes('.agn-btn.primary'), true);
console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
