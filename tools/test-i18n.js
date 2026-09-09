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
// ⚠️ ON CHERCHE COMME `traduireDOM` CHERCHE, sinon le contrôle refuserait des
// clés parfaitement servies. Une phrase écrite dans un template HTML porte
// l'indentation du source (« … les panneaux\n                d'entrée … ») ;
// la clé, elle, s'écrit sur une ligne, et `traduireDOM` compare en normalisant
// les espaces. Un contrôle plus strict que la fonction qu'il surveille ne
// protège de rien : il force à écrire des clés dépendantes de la mise en forme
// du fichier, c'est-à-dire exactement ce qu'on voulait éviter.
// ⚠️ ET L'APOSTROPHE PEUT ÊTRE ÉCHAPPÉE DANS LE SOURCE. « limite d'agglo »
// s'y écrit `champ: 'limite d\'agglo'` : comparer la valeur DÉCODÉE à un
// source ENCODÉ ne trouve rien. Le contrôle refusait une clé parfaitement
// servie — et c'est lui qui l'a signalé, pas une relecture.
const detendu = k => new RegExp(k.split(/\s+/)
  .map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "\\\\?'"))
  .join('\\s+'));
// ⚠️ ET LES LIBELLÉS COMPOSÉS. Le code écrit `champ: 'abreviation' + ou`, où
// `ou` vaut `''` ou `' (alt)'` — et `'ville interdite (' + ou + ')'`, où `ou`
// vaut `principal` ou `alt`. Le texte qui ARRIVE À L'ÉCRAN est donc
// « abreviation (alt) », qui ne figure nulle part littéralement. Traduire à la
// sortie oblige à mettre cette forme-là dans le dictionnaire : on autorise
// donc une clé dont le reste, une fois ôté son dernier groupe entre
// parenthèses, se retrouve dans le code.
// 🔴 ON NE TRADUIT PAS `champ` À LA SOURCE, et ce n'est pas un détail de
// style : `e.champ` est comparé à des valeurs FRANÇAISES en six endroits du
// moteur de correction (« principal », « alt manquant », « rédaction
// (dictionnaire FR) »…). Un `tr()` pose là aurait laissé l'italien s'afficher
// correctement pendant que les boutons de correction cessaient de mordre — en
// silence, et seulement pour les éditeurs italiens.
const sansSuffixe = k => k.replace(/\s*\([^()]*\)\s*$/, '').trim();
// ⚠️ ET LES BLOCS D'AIDE, QUI SONT INTERPOLES. La clé est le HTML RENDU d'un
// élément — « … de ton département : … <b>Télécharger (geo.api.gouv.fr)</b> » —
// et ce HTML-là n'existe nulle part d'un seul tenant : le script l'assemble
// avec `${motUniteArticle()}`, `${REF.sourceContours.libelle}`,
// `${siCorrecteur(…)}`. Exiger la chaîne entière refuserait toutes ces clés.
// ⇒ On vérifie chaque MORCEAU DE TEXTE un peu long : un bloc inventé de toutes
//   pièces échoue toujours, un bloc assemblé passe. C'est le même arbitrage que
//   pour les libellés composés — le contrôle suit la façon dont le texte est
//   réellement fabriqué, sinon il force à écrire des clés fausses.
const morceauxConnus = k => {
  // Les balises deviennent des COUPURES : ce sont elles qui separent les
  // morceaux que le script ecrit d'un seul tenant. Le separateur est un
  // caractere qui ne peut pas figurer dans un libelle.
  const SEP = String.fromCharCode(1);
  const bouts = k.replace(/<[^>]+>/g, SEP).split(SEP)
    .map(x => x.trim()).filter(x => x.length >= 20);
  // ⚠️ AU MOINS UN morceau, pas tous — et c'est un compromis ASSUME. Les
  //    interpolations coupent aussi le texte : « de ${motUniteArticle()} :
  //    bouton » ne laisse aucun fragment continu assez long autour d'elles.
  //    Exiger que TOUS les morceaux soient retrouves refusait deux blocs
  //    parfaitement servis. Un bloc invente de toutes pieces, lui, n'en a
  //    AUCUN de reconnu : le controle mord toujours sur ce qui compte.
  return bouts.length > 0 && bouts.some(x => detendu(x).test(horsDico));
};
const connue = k => horsDico.indexOf(k) >= 0 || detendu(k).test(horsDico) ||
  (sansSuffixe(k) !== k && sansSuffixe(k) &&
   (horsDico.indexOf(sansSuffixe(k)) >= 0 || detendu(sansSuffixe(k)).test(horsDico))) ||
  (/<[a-z]/i.test(k) && morceauxConnus(k));
const orphelines = clesIt.filter(k => !connue(k));
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

titre('⭐⭐ … ET CEUX DU RÉFÉRENTIEL FRANÇAIS AUSSI (09/09)');
// 🔴 LE TROU QUE CE CAS BOUCHE : le 11 et le 12 ne regardaient que l'Italie,
// et 13 libellés FRANÇAIS restaient donc en français dans un panneau italien —
// sans qu'aucun test ne bronche. « La LANGUE n'est pas le PAYS » : un Italien
// qui aide en France applique les règles FRANÇAISES, et il les lit dans SA
// langue. Le référentiel qu'il regarde ne dit rien de la langue qu'il parle.
//
// ⚠️ ON NE LES ÉNUMÈRE PAS, ON BALAIE TOUS LES RÉFÉRENTIELS : un contrôle qui
// cite les pays qu'il connaît ne protégera jamais le troisième. Le jour où un
// `REFERENTIELS.ES` arrive, ce cas tombe tout seul s'il n'est pas traduit.
const iRef = src.indexOf('const REFERENTIELS = {');
const finRef = src.indexOf('\n  };', iRef);
const blocRef = src.slice(iRef, finRef);
const pays = [...blocRef.matchAll(/^    ([A-Z]{2}): \{$/gm)].map(m => ({ code: m[1], pos: m.index }));
verifier('15. le balayage trouve au moins deux référentiels', pays.length >= 2, true);
const manquants = [];
pays.forEach((p, n) => {
  const bloc = blocRef.slice(p.pos, n + 1 < pays.length ? pays[n + 1].pos : blocRef.length);
  const iCtrl = bloc.indexOf('controles: [');
  if (iCtrl < 0) return;                       // un référentiel sans contrôles
  // Le tableau s'arrête à la première clé de même niveau qui suit.
  const fin = bloc.indexOf('\n      ],', iCtrl);
  const tableau = bloc.slice(iCtrl, fin < 0 ? bloc.length : fin);
  [...tableau.matchAll(/libelle:\s*\n?\s*'((?:[^'\\]|\\.)*)'/g)]
    .map(m => m[1].replace(/\\'/g, "'"))
    .forEach(l => { if (!TEXTES.it[l]) manquants.push(p.code + ' — ' + l); });
});
verifier('16. ⭐⭐ aucun libellé de contrôle sans traduction italienne, TOUS pays confondus',
  manquants, []);

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
