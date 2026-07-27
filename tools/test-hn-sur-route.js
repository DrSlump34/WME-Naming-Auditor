/**
 * Tests de la MESURE « numeros poses sur une voie nommee Dxxx » (v2.26) et de
 * l'explication du refus d'enregistrement HTTP 406.
 *
 * ⚠️⚠️ CE QUE CES TESTS PROTEGENT, ET POURQUOI C'EST SERIEUX :
 *
 * 1. La mesure ne doit JAMAIS devenir une correction. Elle compte un cas soumis
 *    a discussion (proposition de Glenan56, 27/07), qu'AUCUNE regle francaise
 *    n'interdit a ce jour. Un bouton ⚡ dessus, et le script imposerait une norme
 *    que personne n'a validee — l'inverse exact de la doctrine du projet
 *    (« le script applique la norme, il ne la cree pas »). Glenan56 demande
 *    LUI-MEME que les LC et le wiki tranchent d'abord.
 *
 * 2. Le refus 406 ne doit PAS se lire comme un doublon d'adresse. C'est le
 *    contresens exact qu'a fait un editeur experimente : mesure en live le
 *    21/07 (« 721 Chemin de la Begude »), `addHouseNumber` du MEME numero passe,
 *    seuls les POI sont refuses, et le refus survit a la suppression ENREGISTREE
 *    du numero homonyme. Ce n'est pas une regle d'unicite, c'est un residu
 *    serveur invisible dans l'editeur.
 *
 * ⚠️ Fonctions EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-hn-sur-route.js
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

function extraire(nom) {
  const i = src.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let par = 0, j = src.indexOf('(', i);
  for (; j < src.length; j++) {
    if (src[j] === '(') par++;
    else if (src[j] === ')') { par--; if (!par) { j++; break; } }
  }
  let prof = 0; j = src.indexOf('{', j);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, j + 1);
}

/**
 * Monte une fonction extraite SANS avoir a lui recopier tout son environnement.
 *
 * ⚠️ `planDeCorrection` reference des dizaines de globales du script (REF,
 * options, communeActive…) que le chemin teste ne touche jamais. Les enumerer
 * une par une serait une recopie deguisee — et elle se perimerait au premier
 * ajout dans le script. Un `with` sur un Proxy qui repond « je connais tout »
 * laisse donc passer les identifiants inconnus a `undefined` : si le chemin
 * teste en touchait un pour de vrai, le test leverait, ce qui est le
 * comportement voulu.
 */
function monter(nom, connus) {
  const bac = new Proxy(Object.assign({}, connus || {}), {
    has: () => true,
    get: (t, k) => (k === Symbol.unscopables ? undefined : t[k])
  });
  return new Function('__bac', 'with(__bac){' + extraire(nom) + ';return ' + nom + ';}')(bac);
}

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else { ko++; lignes.push('  ECHEC ' + titre + '\n          attendu ' +
    JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
function titre(t) { lignes.push('\n' + t); }

// ===========================================================================
titre('⭐ UNE MESURE NE SE CORRIGE PAS');
// ===========================================================================
const plan = monter('planDeCorrection');

// Un report de mesure, tel que le produit le bloc « 1 bis ».
const MESURE = { adresse: true, sousType: 'hn', cas: 'HN-RTE', mesure: true,
                 hnId: 'h1', segId: 42, nbPoints: 1,
                 hns: [{ id: 'h1', number: 12 }] };

verifier('1. ⭐ aucun plan de correction sur un report de mesure',
  plan(MESURE), null);
verifier('2. ⚠️ meme en lui donnant tout ce qui declenche la conversion ailleurs',
  plan(Object.assign({}, MESURE, {
    rueCible: { nom: 'Route de Laudun', ville: 'Laudun' }, editable: true })), null);

// Le meme report SANS le drapeau redevient un « numero hors agglo » ordinaire :
// c'est la preuve que c'est bien `mesure` qui ferme, et pas un effet de bord.
const ordinaire = Object.assign({}, MESURE, {
  cas: 'HN-H', rueCible: { nom: 'Route de Laudun', ville: 'Laudun' } });
delete ordinaire.mesure;
const planOrdinaire = plan(ordinaire);
verifier('3. ⚠️ sans le drapeau, un HN hors agglo garde bien SA conversion',
  !!(planOrdinaire && planOrdinaire[0] && planOrdinaire[0].type === 'hn2poi'), true);
verifier('4. un report deja traite ne propose rien non plus',
  plan(Object.assign({}, ordinaire, { traite: true })), null);

// ===========================================================================
titre('⭐ LE REFUS 406 EST NOMME, ET PAS CONFONDU AVEC UN DOUBLON');
// ===========================================================================
const RE = /num[ée]ro de rue invalide|invalid house ?number|house ?number is invalid/i;
const expliquer = monter('expliquerRefus', { RE_REFUS_HN: RE });

const FR = 'Le lieu en surbrillance a un numéro de rue invalide';
const EN = 'The highlighted place has an invalid house number';
const explFR = expliquer(FR);

verifier('5. ⭐ le message francais de WME est reconnu', explFR.length > 0, true);
verifier('6. ⭐ le message anglais aussi (WME est traduit)', expliquer(EN).length > 0, true);
verifier('7. ⚠️ un refus SANS rapport n\'est pas explique a tort',
  expliquer('Le segment sélectionné est verrouillé à un niveau supérieur'), '');
verifier('8. un texte vide ne casse rien', expliquer(''), '');
verifier('9. … ni un texte absent', expliquer(undefined), '');

// ⚠️ Le fond du message : c'est le CONTRESENS qu'il doit lever.
verifier('10. ⭐ l\'explication DIT que ce n\'est pas un doublon',
  /pas un doublon/i.test(explFR), true);
verifier('11. ⭐ elle dit que le residu est cote SERVEUR et invisible',
  /r[ée]siduelle?|serveur/i.test(explFR) && /invisible/i.test(explFR), true);
verifier('12. ⭐ elle dit que le NUMERO de rue, lui, reste acceptable',
  /num[ée]ro de rue[^<]{0,40}reste acceptable|seul le lieu/i.test(explFR), true);
verifier('13. ⭐ elle donne la sortie : signaler au staff',
  /staff/i.test(explFR), true);
verifier('14. ⚠️ et elle ne fait PAS croire qu\'il y a quelque chose a corriger',
  /rien à corriger/i.test(explFR), true);

// ===========================================================================
titre('Verrous sur le SOURCE');
// ===========================================================================
{
  // ⚠️ Le controle doit rester DECOCHE par defaut : coche, il ferait passer une
  // mesure pour un audit, sur des centaines de numeros en ville.
  const bloc = src.slice(src.indexOf("cle: 'hnSurRoute'"), src.indexOf("cle: 'poiAgglo'"));
  verifier('15. ⭐ le controle est decoche par defaut', /defaut:\s*false/.test(bloc), true);
  verifier('16. ⭐ son libelle DIT que ce n\'est pas une regle',
    /[Mm]esure/.test(bloc) && /pas une r[èe]gle/i.test(bloc), true);

  // ⚠️ La mesure porte sur les numeros EN agglomeration : elle ne peut pas
  // dependre du controle « hors agglomeration », qui les ecarte justement.
  verifier('17. ⭐ la mesure peut tourner SEULE (independante de hnHorsAgglo)',
    /faireHnRoute\s*=\s*\(!phases \|\| phases\.hn\) && c\.hnSurRoute/.test(src) &&
    /if \(!faireHn && !fairePoi && !faireHnRoute\) return;/.test(src), true);
  verifier('18. … et la lecture des numeros se declenche pour elle',
    /if \(faireHn \|\| fairePoi \|\| faireHnRoute\)/.test(src), true);

  // ⚠️ Son propre jeu de « deja vus » : partager `stats.hnVus` avec le controle
  // hors agglo rendrait un numero invisible a l'un selon l'ordre des cellules.
  verifier('19. ⚠️ la mesure a son PROPRE dedoublonnage', /stats\.hnRouteVus/.test(src), true);

  // ⚠️ Defaut de RENDU — la famille de bug la plus couteuse du projet (le ⚡ des
  // POI, v2.19) : le calcul juste, l'affichage muet. Ici c'est l'inverse, un
  // message faux qui s'afficherait sur une mesure.
  verifier('20. ⭐ « la conversion ne peut pas etre proposee » ne s\'affiche PAS sur une mesure',
    /f\.adresse && f\.sousType === 'hn' && !f\.rueCible && !f\.mesure/.test(src), true);

  // Un compteur qui n'apparait nulle part ne mesure rien.
  verifier('21. ⭐ le resultat de la mesure est DIT dans le bilan',
    /options\.controles\.hnSurRoute/.test(src) && /hnSurRouteAvecAlt/.test(src), true);
  // ⚠️ ZERO EST UN RESULTAT. Noyé dans une phrase, il se lit « le controle n'a
  // pas tourné » — vecu par l'auteur le 27/07 (« je coche, je relance, rien ne
  // change »). Le bilan doit avoir une branche EXPLICITE pour le cas nul.
  verifier('21 bis. ⭐ le bilan dit explicitement quand la mesure ne trouve RIEN',
    /aucun<\/b> numéro en agglomération sur une voie nommée/.test(src) &&
    /le contrôle a bien tourné/.test(src), true);

  // ⚠️⚠️ LES DEUX DEFAUTS DE RENDU TROUVES EN BRANCHANT LA SUITE — la famille de
  // bug la plus couteuse du projet (le ⚡ des POI, v2.19) : le calcul etait juste,
  // l'affichage trahissait. Ici, la mesure heritait de `adresse:true` et se
  // retrouvait (a) rangee avec les vrais ecarts, (b) peinte de leur couleur.
  const iF = src.indexOf('const familleDe =');
  const familleDe = new Function('return ' + src.slice(iF + 17, src.indexOf(";", iF)))();
  verifier('24. ⭐ une mesure a sa PROPRE famille, pas celle des écarts',
    familleDe({ mesure: true, adresse: true, sousType: 'hn' }), 'hnRoute');
  verifier('25. ⚠️ un vrai numéro hors agglo reste dans la sienne',
    familleDe({ adresse: true, sousType: 'hn' }), 'adresse');
  verifier('26. … et un RPP dans la sienne', familleDe({ adresse: true, sousType: 'poi' }), 'rpp');
  verifier('27. ⭐ la famille de la mesure existe dans la palette',
    /hnRoute:\s*\{[^}]*libelle/.test(src), true);
  verifier('28. ⭐ le point d\'adresse prend sa couleur par la FAMILLE, jamais en dur',
    /const teinte = options\.couleurs\[familleDe\(f\)\]/.test(src) &&
    !/couleur: options\.couleurs\.adresse \|\|/.test(src), true);

  // ⚠️ L'aide doit porter la reserve, pas seulement le code.
  const aide = src.slice(src.indexOf("id: 'numerotation'"), src.indexOf("id: 'partage'"));
  verifier('22. ⭐ l\'aide dit que ce n\'est pas un ecart et qu\'il n\'y a pas de bouton',
    /ne sont pas des [ée]carts/i.test(aide) && /aucun bouton/i.test(aide), true);
  verifier('23. ⭐ l\'aide renvoie aux Local Champs et au wiki avant toute regle',
    /Local Champs/.test(aide) && /wiki/i.test(aide), true);
}

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
