/**
 * LE DICTIONNAIRE DE TRADUCTION — verifie en l'EVALUANT, jamais en le relisant.
 *
 * ⭐⭐ LECON DE WDA (v0.06) : 11 cles manquantes y avaient ete manquees a
 * l'oeil sur un dictionnaire pourtant relu. Un dico i18n ne se contrôle pas en
 * le regardant — il se contrôle en confrontant ses cles au CODE REEL.
 *
 * Le mode de defaillance propre a ce dictionnaire : la cle EST le texte
 * francais. Retoucher une phrase du script — une virgule, un accent — orpheline
 * sa traduction EN SILENCE : `tr()` retombe sur le francais et rien ne le dit.
 * Un editeur italien verrait une ligne francaise au milieu de son interface,
 * sans que personne ne sache pourquoi. C'est ce que ce fichier attrape.
 *
 * Usage : node tools/test-i18n.js
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else { ko++; lignes.push('  ECHEC ' + titre +
    '\n          attendu ' + JSON.stringify(attendu) +
    '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
function titre(t) { lignes.push('\n' + t); }

/** Le bloc TEXTES, extrait et EVALUE — pas relu. */
function monterTextes() {
  const i = src.indexOf('const TEXTES = {');
  if (i < 0) throw new Error('TEXTES introuvable');
  let prof = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return new Function(src.slice(i, j + 1) + '; return TEXTES;')();
}
const TEXTES = monterTextes();

/** La fonction `tr` du script, extraite telle quelle. */
function monterTr(langue) {
  const i = src.indexOf('function tr(fr) {');
  const fin = src.indexOf('}', src.indexOf('return', i)) + 1;
  return new Function('TEXTES', 'LANGUE',
    src.slice(i, fin) + '\nreturn tr;')(TEXTES, langue);
}

titre('Le dictionnaire s\'évalue');
verifier('1. le bloc TEXTES est du JavaScript valide', typeof TEXTES, 'object');
verifier('2. l\'italien est déclaré', typeof TEXTES.it, 'object');
const clesIt = Object.keys(TEXTES.it);
verifier('3. il porte des entrées', clesIt.length > 0, true);

titre('⚠️ Aucune clé ORPHELINE — chacune doit exister dans le code');
// La clé est le texte français : si le script ne le contient plus, la
// traduction ne sera jamais servie, et personne ne s'en apercevra.
//
// ⚠️⚠️ ON CHERCHE HORS DU DICTIONNAIRE. Première version : `src.indexOf(k)`
// sur le source ENTIER — donc y compris le bloc TEXTES, où la clé figure par
// construction. Le contrôle ne pouvait PAS échouer : muter un libellé du
// référentiel le laissait vert. Un contrôle décoratif, et je l'avais écrit
// pour attraper exactement ce cas-là.
const iT = src.indexOf('const TEXTES = {');
let profT = 0, jT = src.indexOf('{', iT);
for (; jT < src.length; jT++) {
  if (src[jT] === '{') profT++;
  else if (src[jT] === '}') { profT--; if (!profT) break; }
}
const horsDico = src.slice(0, iT) + src.slice(jT + 1);
const orphelines = clesIt.filter(k => horsDico.indexOf(k) < 0);
verifier('4. ⭐ toute clé italienne se retrouve AILLEURS que dans le dictionnaire',
  orphelines, []);

titre('⚠️ Aucune traduction VIDE ni identique au français');
const vides = clesIt.filter(k => !String(TEXTES.it[k] || '').trim());
verifier('5. aucune valeur vide', vides, []);
const identiques = clesIt.filter(k => TEXTES.it[k] === k);
verifier('6. aucune valeur restée en français', identiques, []);

titre('`tr` rend bien ce qu\'on attend');
const trIt = monterTr('it'), trFr = monterTr('fr');
const uneCle = clesIt[0];
verifier('7. en italien, la traduction', trIt(uneCle), TEXTES.it[uneCle]);
verifier('8. en français, le texte d\'origine', trFr(uneCle), uneCle);
verifier('9. ⭐ un texte non traduit retombe sur le français, pas sur une clé nue',
  trIt('Phrase que personne n\'a traduite'), 'Phrase que personne n\'a traduite');
verifier('10. une langue inconnue ne casse pas', monterTr('xx')(uneCle), uneCle);

titre('⭐ Les libellés de contrôles ITALIENS sont tous traduits');
// Le referentiel IT est le premier que verra un editeur italien : ses libelles
// ne doivent pas rester en francais.
// ⚠️ On cible le TABLEAU `controles`, pas tous les `libelle:` du bloc IT :
//    `sourceContours` en porte un aussi, qui n'est pas un libellé de contrôle.
//    Ratisser large faisait échouer le test sur du code parfaitement juste.
const blocIT = src.slice(src.indexOf('    IT: {'));
const blocCtrlIT = blocIT.slice(blocIT.indexOf('controles: ['),
                                blocIT.indexOf('verifierForme:'));
const libellesIT = [...blocCtrlIT.matchAll(/libelle:\s*\n?\s*'((?:[^'\\]|\\.)*)'/g)]
  .map(m => m[1].replace(/\\'/g, "'"));
verifier('11. le référentiel italien déclare des libellés', libellesIT.length > 0, true);
const nonTraduits = libellesIT.filter(l => !TEXTES.it[l]);
verifier('12. ⭐⭐ aucun libellé italien laissé en français', nonTraduits, []);

titre('⚠️ Le mécanisme est BRANCHÉ — pas seulement écrit');
// « Compiler n'est pas démarrer » : une mécanique de langue que personne
// n'appelle laisse LANGUE à 'fr', et l'italien ne s'affiche jamais. Le
// dictionnaire serait parfait, les tests verts, et l'écran en français.
verifier('13. ⭐ `detecterLangue()` est appelée au démarrage',
  /\n\s*detecterLangue\(\);/.test(src), true);
// Et elle doit l'être AVANT que l'interface fige ses libellés.
const posLangue = src.search(/\n\s*detecterLangue\(\);/);
const posOverlay = src.indexOf('    buildOverlay();');
verifier('14. ⭐⭐ … et AVANT buildOverlay, sinon elle ne change rien à l\'écran',
  posLangue > 0 && posOverlay > 0 && posLangue < posOverlay, true);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(60));
console.log('%d verifications OK, %d ECHEC(S)  (%d cles italiennes)',
            ok, ko, clesIt.length);
process.exit(ko ? 1 : 0);
