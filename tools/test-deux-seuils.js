/**
 * DEUX SEUILS DE RATTACHEMENT, BORNES — v2.50.11.
 *
 * ⚠️ ORIGINE : onryou, 30/09/2026 (fil WNA). Sur ses captures, « à couper au panneau EB10 » a
 * 0 %, 1 %, 2 % et 96 % dans l'agglomeration. Cause : un seul `seuil`, reglable de 50 a 100 %,
 * et le sien etait a 100 — tout segment qui depasse d'un metre devenait « a couper ».
 * Arbitrage de l'auteur : un seuil pour l'entree d'agglo, un pour la limite communale, bornes
 * 70-95 %, un bouton « Seuils par defaut ».
 *
 * `bornerSeuil`, `zonageAgglo` et la reprise des reglages sont EXTRAITS du userscript.
 * Temoins : a 100 %, les quatre cas d'onryou ressortent ; un branchement croise se voit.
 *
 * Usage : node tools/test-deux-seuils.js [fichier.user.js]
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
function entre(s, debut, fin) {
  const i = s.indexOf(debut);
  if (i < 0) throw new Error('introuvable : ' + debut);
  const j = s.indexOf(fin, i);
  if (j < 0) throw new Error('introuvable : ' + fin);
  return s.slice(i, j + fin.length);
}

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}

const consts = entre(src, 'const SEUIL_DEFAUT', ';');
const borner = new Function(consts + '\n' + extraire(src, 'bornerSeuil') + '\nreturn bornerSeuil;')();
const zonage = new Function('ROADTYPE_SANS_PANNEAU_EB10', extraire(src, 'zonageAgglo') + '\nreturn zonageAgglo;')(new Set([8]));

console.log('\n=== Bornes ===');
verifier('100 % est ramene a 95 %', borner(1), 0.95);
verifier('50 % est ramene a 70 %', borner(0.5), 0.7);
verifier('90 % reste 90 %', borner(0.9), 0.9);
verifier('une valeur illisible rend le defaut (80 %)', borner(NaN), 0.8);
verifier('undefined rend le defaut', borner(undefined), 0.8);

console.log('\n=== Les captures d\'onryou (rue, route principale) ===');
// Parts mesurees sur ses captures : « 0 % » affiche = moins de 0,5 %.
const CAS = [0.004, 0.01, 0.02, 0.96];
verifier('a 90 % : aucun des quatre n\'est a couper', CAS.map(p => zonage(p, 1, 0.9).aCouper), [false, false, false, false]);
verifier('a 90 % : 96 % est en agglo, les autres dehors', CAS.map(p => zonage(p, 1, 0.9).enAgglo), [false, false, false, true]);
verifier('au defaut (80 %), 50 % reste a couper', zonage(0.5, 1, 0.8).aCouper, true);
verifier('TEMOIN : a 100 % (son reglage), les quatre ressortent', CAS.map(p => zonage(p, 1, 1).aCouper), [true, true, true, true]);
verifier('… et au plus haut permis (95 %), plus aucun', CAS.map(p => zonage(p, 1, borner(1)).aCouper), [false, false, false, false]);

console.log('\n=== Reprise des reglages enregistres ===');
const reprise = entre(src, 'const ancien = memo.options.seuil;', 'options.seuilCommune = bornerSeuil(options.seuilCommune);');
// L'extrait ferme le bloc `if (memo.options) {` du userscript : on le rouvre.
const reprendre = new Function('memo', 'options', consts + '\n' + extraire(src, 'bornerSeuil') +
  '\nif (memo.options) {\n' + reprise + '\nreturn options;');
const defaut = () => ({ seuilAgglo: 0.8, seuilCommune: 0.8 });
verifier('un ancien seuil a 100 % devient 95 % pour les deux',
  reprendre({ options: { seuil: 1 } }, Object.assign(defaut(), { seuil: 1 })), { seuilAgglo: 0.95, seuilCommune: 0.95 });
verifier('un ancien seuil a 85 % sert aux deux',
  reprendre({ options: { seuil: 0.85 } }, Object.assign(defaut(), { seuil: 0.85 })), { seuilAgglo: 0.85, seuilCommune: 0.85 });
verifier('sans ancien seuil : le defaut',
  reprendre({ options: {} }, defaut()), { seuilAgglo: 0.8, seuilCommune: 0.8 });
verifier('deux seuils deja enregistres : gardes tels quels',
  reprendre({ options: { seuilAgglo: 0.9, seuilCommune: 0.75, seuil: 1 } },
    Object.assign(defaut(), { seuilAgglo: 0.9, seuilCommune: 0.75, seuil: 1 })), { seuilAgglo: 0.9, seuilCommune: 0.75 });

console.log('\n=== Branchements dans l\'analyse ===');
const analyse = extraire(src, 'analyserSegments');
verifier('haut/bas viennent du seuil COMMUNAL, hautAgglo du seuil d\'agglo',
  /const haut = options\.seuilCommune, bas = 1 - options\.seuilCommune, hautAgglo = options\.seuilAgglo;/.test(analyse), true);
verifier('les deux appels au zonage d\'agglo prennent hautAgglo',
  (analyse.match(/zonageAgglo\(loc\.partAgglo, seg\.roadType, hautAgglo\)/g) || []).length, 2);
verifier('aucun appel au zonage d\'agglo ne prend le seuil communal',
  /zonageAgglo\([^)]*\bhaut\)/.test(analyse), false);
verifier('l\'ancien options.seuil ne sert plus nulle part dans le code',
  src.split('\n').filter(l => /options\.seuil\b/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/memo\.options\.seuil|delete options\.seuil/.test(l)), []);

console.log('\n=== Interface ===');
const champs = src.match(/<input type="number" id="agn-r-seuil-(agglo|commune)" min="(\d+)" max="(\d+)"/g) || [];
verifier('deux champs, bornes 70-95', champs.map(c => c.replace(/.*id="([^"]+)" min="(\d+)" max="(\d+)"/, '$1 $2-$3')),
  ['agn-r-seuil-agglo 70-95', 'agn-r-seuil-commune 70-95']);
verifier('le bouton « Seuils par défaut » existe et est branche',
  /id="agn-r-seuils-defaut"/.test(src) && /q\('#agn-r-seuils-defaut'\)\.onclick/.test(src), true);

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
