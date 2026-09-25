/**
 * L'INTERFACE EN ITALIEN : branchements et mecanismes (audit du 25/09/2026).
 *
 * L'audit a trouve l'onglet Scripts jamais traduit, deux boites sur trois et la bulle hors de toute
 * traduction, le volet plus observe une fois sorti de la fenetre, les `confirm` et le bilan en dur,
 * et « INSEE » ecrit en Italie. Ce banc verifie :
 *  - `trf` (gabarit a marqueurs) et la recherche INSEE/ISTAT de `chercherTrad`, EXTRAITES du script ;
 *  - que chaque zone est bien branchee (lecture du source) ;
 *  - que chaque cle a marqueurs du dictionnaire garde ses marqueurs dans sa traduction.
 * Temoin : sans la bascule ISTAT → INSEE, le texte italien reste en francais.
 *
 * Usage : node tools/test-italien-interface.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'WME-Naming-Auditor.user.js', 'utf8');
const fn = (s, nom) => { const a = s.indexOf('function ' + nom + '('); if (a < 0) throw new Error(nom);
  let n = 0, b = s.indexOf('{', a); for (; b < s.length; b++) { if (s[b] === '{') n++; else if (s[b] === '}') { n--; if (!n) break; } }
  return s.slice(a, b + 1); };
const objet = debut => { const i = src.indexOf(debut); let n = 0, j = src.indexOf('{', i); const d = j;
  for (; j < src.length; j++) { if (src[j] === '{') n++; else if (src[j] === '}') { n--; if (!n) { j++; break; } } }
  return src.slice(d, j); };
const TEXTES = new Function('return ' + objet('const TEXTES = {') + ';')();
const monter = s => new Function('TEXTES', 'LANGUE', 'MOTIFS',
  fn(s, 'tr') + fn(s, 'trf') + fn(s, 'chercherTrad') + fn(s, 'traduireMotif') + '\nreturn { tr, trf };')(TEXTES, 'it', {});

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
const it = monter(src);

console.log('\n=== trf ===');
verifier('le bilan se traduit et se remplit',
  it.trf('<b>{ok}</b> correction(s) appliquée(s) sur <b>{n}</b> {unites}.', { ok: 3, n: 7, unites: it.tr('segment(s)') }),
  '<b>3</b> correzione/i applicata/e su <b>7</b> segmento/i.');
verifier('le total des echecs est donne', it.trf('Échecs ({n}) :', { n: 5 }), 'Errori (5):');

console.log('\n=== INSEE ou ISTAT ===');
verifier('un texte « ISTAT » se traduit par sa cle « INSEE », sigle rendu',
  it.tr('filtrer par nom ou code ISTAT…'), 'filtra per nome o codice ISTAT…');
verifier('le texte « INSEE » reste INSEE', it.tr('filtrer par nom ou code INSEE…'), 'filtra per nome o codice INSEE…');

console.log('\n=== Cles a marqueurs : memes marqueurs des deux cotes ===');
const marq = t => (t.match(/\{\w+\}/g) || []).sort().join(',');
const casses = Object.entries(TEXTES.it).filter(([k, v]) => /\{\w+\}/.test(k) && marq(k) !== marq(v)).map(([k]) => k);
verifier('aucune traduction ne perd ou n\'invente un marqueur', casses, []);

console.log('\n=== Branchements ===');
// Le dictionnaire, lui, GARDE ses cles en « INSEE » : c'est par elles que passe la bascule ISTAT.
const horsDico = src.replace(objet('const TEXTES = {'), '{}');
const b = (titre, re) => verifier(titre, re.test(src), true);
b('l\'onglet Scripts est traduit et observe', /traduireDOM\(pane\);\s*\n\s*observerTraduction\(pane\);/);
b('le volet est observe une fois dans le body', /document\.body\.appendChild\(ui\.volet\);[\s\S]{0,400}observerTraduction\(ui\.volet\);/);
b('la bulle est observee', /document\.body\.appendChild\(bulle\); observerTraduction\(bulle\);/);
verifier('les trois boites sont traduites', (src.match(/traduireDOM\(boite\)/g) || []).length, 3);
verifier('plus aucun confirm en dur', /confirm\('/.test(src), false);
verifier('plus aucun « INSEE » en dur dans un texte affiche par le code', [
  /contour INSEE \(' \+/, /commune INSEE qui est appliquée/, /D'après les contours INSEE/, /\(contour INSEE\)/,
  /code INSEE, ' \+/, /rangees par code INSEE/].filter(re => re.test(horsDico)).length, 0);

b('un démarrage raté se DIT à l\'écran (role=alert), pas seulement dans la console',
  /init\(\)\.catch\(e => \{[\s\S]{0,700}setAttribute\('role', 'alert'\)[\s\S]{0,900}document\.body\.appendChild\(d\)/);
verifier('… et son message est traduit',
  !!TEXTES.it['{nom} n\'a pas pu démarrer : {motif}. Recharge la page ; si ça persiste, signale-le sur le fil Discuss. (Clic pour fermer.)'], true);

console.log('\n=== Temoin ===');
const mutant = src.replace("if (t || !/\\bISTAT\\b/.test(cle)) return t;", 'return t;');
if (mutant === src) { ko++; console.log('  ECHEC temoin introuvable'); }
else verifier('TEMOIN : sans la bascule, le texte ISTAT reste en francais',
  monter(mutant).tr('filtrer par nom ou code ISTAT…'), 'filtrer par nom ou code ISTAT…');

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
