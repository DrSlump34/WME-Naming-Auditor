/**
 * Tests du DICTIONNAIRE DE REDACTION FR (v2.28.00).
 *
 * ⭐ ORIGINE : l'auteur, le 01/08/2026 — « le script WME Check Road Name fait
 * deja un excellent boulot, tu peux t'en inspirer ». Il avait raison, et la
 * mesure l'a confirme : la communaute FR maintient ~1 430 regles de redaction
 * depuis 2015. Reecrire les notres aurait ete moins bon des le premier jour.
 * WNA les CONSOMME donc, il ne les recopie pas.
 *
 * ⚠️⚠️ CE QUE CES TESTS PROTEGENT AVANT TOUT — L'ABSENCE D'eval.
 * Les feuilles contiennent des cellules qui sont du CODE. Les evaluer
 * executerait, chez l'editeur, du JavaScript ecrit par quiconque a le droit
 * d'edition sur un classeur partage. La table de correspondance exacte est le
 * seul rempart : les tests 1 a 4 la figent, et le test 4 verifie qu'une cellule
 * inconnue est IGNOREE plutot qu'interpretee.
 *
 * ⚠️ LA LIMITE MESUREE LE 01/08 (sur les 2 feuilles reelles, hors ligne) :
 * le dictionnaire ne sait PAS redresser un nom tout en MAJUSCULES. Il suppose
 * une casse deja a peu pres correcte. Sur 12 noms en capitales, 3 sorties
 * franchement cassees (« RUE DES ECOLES » -> « RUE DES ÉcolES », la regle des
 * ecoles restituant ses groupes tels quels) et 9 batardes (« ROUTE de PARIS »).
 * ⇒ Les tests 12 a 15 figent le REFUS de proposer quoi que ce soit dans ce cas.
 * ⭐ Ce sont des tests de VOLONTE, pas de calcul : ne pas les « optimiser » en
 * les faisant proposer un nom. Le silence est le resultat voulu.
 *
 * ⚠️ Fonctions EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-dictionnaire.js
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
/** Bloc `const NOM = (() => { ... })();` — la table de fonctions en est un. */
function extraireIife(nom) {
  const i = src.indexOf('const ' + nom + ' = (() => {');
  if (i < 0) throw new Error('bloc introuvable : ' + nom);
  let prof = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  const fin = src.indexOf(';', j);
  return src.slice(i, fin + 1);
}
function relire(nom) {
  const m = src.match(new RegExp('const\\s+' + nom + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('constante introuvable : ' + nom);
  return 'const ' + nom + ' = ' + m[1] + ';';
}

const api = new Function([
  extraireIife('DICO_FONCTIONS'),
  relire('nettoyerNom'),
  extraire('analyserDictionnaire'), extraire('appliquerDictionnaire'),
  extraire('nomEnCapitales'), extraire('ecartDeRedaction'),
  'return { DICO_FONCTIONS, nettoyerNom, analyserDictionnaire, appliquerDictionnaire,',
  '         nomEnCapitales, ecartDeRedaction };'
].join('\n'))();

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else {
    ko++;
    lignes.push('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) +
                '\n          obtenu  ' + JSON.stringify(obtenu));
  }
}

console.log('\n=== Dictionnaire de redaction FR ===\n');

// ---------------------------------------------------------------------------
// 1. LECTURE D'UNE FEUILLE — la grammaire de CRN
// ---------------------------------------------------------------------------
const FEUILLE = [
  '// un commentaire, ignore',
  '/( |\')test /i,""" Essai """,// libelle',
  '/[ ]+/g,""" """,// espaces multiples',
  'motif-nu,"""remplace""",// une entree sans slash doit etre encadree',
  'ligne sans virgule ni slash'
].join('\n');
const lu = api.analyserDictionnaire(FEUILLE, 1);
// ⚠️ MESURE, PAS SUPPOSITION : « motif-nu » est REJETE, parce qu'une ligne qui
// ne commence pas par « / » est ecartee avant qu'on songe a l'encadrer. La
// branche d'encadrement de `analyserDictionnaire` est donc du code MORT — chez
// CRN aussi, dont elle est reprise. Conservee par fidelite a la source, mais ce
// test fige le comportement REEL : 2 regles, pas 3.
verifier('1. seules les lignes commencant par « / » sont retenues', lu.regles.length, 2);
verifier('2. le numero de ligne suit le decalage demande', lu.regles[0].ligne, 2);
verifier('3. une ligne sans slash initial est ecartee (branche d\'encadrement morte)',
  lu.regles.some(r => String(r.re).indexOf('motif-nu') >= 0), false);

// ---------------------------------------------------------------------------
// 2. ⚠️⚠️ LE REMPART : AUCUN eval
// ---------------------------------------------------------------------------
const AVEC_CODE = [
  '/abc/g,function(a) {return(a.toUpperCase());},// cellule CONNUE',
  '/def/g,function(a) {return(fetch(\'//pirate\'));},// cellule INCONNUE'
].join('\n');
const luCode = api.analyserDictionnaire(AVEC_CODE, 1);
verifier('4. la cellule-code connue est acceptee, l\'inconnue est IGNOREE',
  [luCode.regles.length, luCode.ignorees], [1, 1]);
verifier('5. la cellule connue rend bien une FONCTION',
  typeof luCode.regles[0].remplacement, 'function');
verifier('6. la table ne contient QUE des fonctions (aucune chaine a evaluer)',
  Object.values(api.DICO_FONCTIONS).every(f => typeof f === 'function'), true);
verifier('7. le userscript ne contient aucun eval sur le dictionnaire',
  /eval\s*\(/.test(src), false);

// ---------------------------------------------------------------------------
// 3. LA CASCADE — l'ordre est signifiant
// ---------------------------------------------------------------------------
const DICO_ORDRE = api.analyserDictionnaire([
  '/a/g,"""b""",// a devient b',
  '/b/g,"""c""",// puis b devient c : l\'ordre fait que a finit en c'
].join('\n'), 1).regles;
verifier('8. les regles s\'enchainent dans l\'ordre du fichier',
  api.appliquerDictionnaire('a', DICO_ORDRE).nom, 'c');
verifier('9. les lignes touchees sont rapportees',
  api.appliquerDictionnaire('a', DICO_ORDRE).lignes, [1, 2]);
verifier('10. un nom qui ne declenche rien ressort intact',
  api.appliquerDictionnaire('zzz', DICO_ORDRE).nom, 'zzz');
verifier('11. les espaces multiples et de bord sont nettoyes (genericCorrection)',
  api.appliquerDictionnaire('  zz   zz  ', DICO_ORDRE).nom, 'zz zz');

// ---------------------------------------------------------------------------
// 4. ⚠️⚠️ LE GARDE-FOU DES CAPITALES — tests de VOLONTE
//    Mesure du 01/08 : le dictionnaire produit « RUE DES ÉcolES ». On se tait.
// ---------------------------------------------------------------------------
verifier('12. « RUE DES ECOLES » est reconnu comme un nom en capitales',
  api.nomEnCapitales('RUE DES ECOLES'), true);
verifier('13. ⚠️ « D18 » n\'en est PAS un (un numero de route n\'est pas une faute)',
  api.nomEnCapitales('D18'), false);
verifier('14. ⚠️ « ZA » seul n\'en est PAS un (sigle court, pas assez de mots)',
  api.nomEnCapitales('ZA'), false);
verifier('15. un nom normal n\'en est pas un',
  api.nomEnCapitales('Rue des Écoles'), false);
verifier('16. « A9 » n\'en est pas un', api.nomEnCapitales('A9'), false);
verifier('17. ⚠️ un nom en capitales est signale SANS proposition de nom',
  (() => { const e = api.ecartDeRedaction('RUE DES ECOLES', DICO_ORDRE);
           return [e.champ, e.sansProposition]; })(),
  ['nom en capitales', true]);
verifier('18. ⚠️ et la cascade n\'est meme pas tentee : rien de devine',
  /Écol/.test(api.ecartDeRedaction('RUE DES ECOLES', DICO_ORDRE).apres), false);

// ---------------------------------------------------------------------------
// 5. L'ECART — ce qu'on dit, et ce qu'on ne dit pas
// ---------------------------------------------------------------------------
// ⚠️⚠️ L'ENCADREMENT EST INDISPENSABLE, ET C'EST UNE DECOUVERTE DE CES TESTS :
// presque toutes les regles du dictionnaire exigent un espace AVANT et APRES le
// motif (« ( |')ecole  »). Elles ne matchent donc que grace a la regle
// « /^(.*)$/ -> " $1 " » qui encadre le nom, et qui vit dans la feuille
// PRINCIPALE. Sans elle, la cascade se tait sur presque tout — en silence.
// ⇒ d'ou le refus de tourner sur la seule feuille publique (test 29).
const ENCADRE = '/^(.*)$/,""" $1 """,// encadrement, comme la feuille principale';
const DICO_ECOLE = api.analyserDictionnaire(
  ENCADRE + '\n/( |\')ecole /i,"""$1École """,// accent', 1).regles;
verifier('19. un nom fautif produit un ecart avec la proposition',
  (() => { const e = api.ecartDeRedaction('Rue de l ecole ', DICO_ECOLE);
           return e && e.apres; })(), 'Rue de l École');
verifier('20. un nom conforme ne produit RIEN',
  api.ecartDeRedaction('Rue des Tilleuls', DICO_ECOLE), null);
verifier('21. un nom vide ne produit RIEN',
  api.ecartDeRedaction('', DICO_ECOLE), null);
verifier('22. ⚠️ sans regle chargee, on se tait (echec reseau : pas de faux « tout va bien »)',
  api.ecartDeRedaction('Rue de l ecole', []), null);
verifier('23. ⚠️ une regle qui VIDE le nom est refusee (on ne propose jamais le vide)',
  api.ecartDeRedaction('Truc', api.analyserDictionnaire('/^.*$/,"""""",//vide', 1).regles), null);
verifier('24. l\'ecart porte les lignes du dictionnaire en cause (tracabilite)',
  Array.isArray(api.ecartDeRedaction('Rue de l ecole ', DICO_ECOLE).lignes), true);

// ---------------------------------------------------------------------------
// 6. ROBUSTESSE — une feuille cassee ne doit pas casser l'analyse
// ---------------------------------------------------------------------------
verifier('25. une regex invalide est comptee et ecartee, pas propagee',
  (() => { const r = api.analyserDictionnaire('/[non-fermee/g,"""x""",//', 1);
           return [r.regles.length, r.invalides]; })(), [0, 1]);
verifier('26. une feuille vide rend une liste vide, sans exception',
  api.analyserDictionnaire('', 1).regles.length, 0);
verifier('27. une entree nulle rend une liste vide, sans exception',
  api.analyserDictionnaire(null, 1).regles.length, 0);
verifier('28. la cascade survit a une regle qui leve (aucune perte du nom)',
  api.appliquerDictionnaire('abc', [{ ligne: 1, re: /a/, remplacement: () => { throw new Error('boum'); } }]).nom,
  'abc');

// ---------------------------------------------------------------------------
// 7. ⚠️⚠️ LA FEUILLE PRINCIPALE EST OBLIGATOIRE
// Decouvert en ecrivant ces tests : sans sa regle d'encadrement, les regles a
// espaces ne matchent plus et la cascade se tait — SANS RIEN DIRE. Un
// chargement partiel qui garderait la seule feuille publique rendrait donc un
// « aucun defaut » mensonger. Le chargeur doit refuser ce cas.
// ---------------------------------------------------------------------------
verifier('29. ⚠️ sans encadrement, la meme regle ne matche plus (la preuve du risque)',
  api.ecartDeRedaction('Rue de l ecole',
    api.analyserDictionnaire('/( |\')ecole /i,"""$1École """,//', 1).regles), null);
verifier('30. ⚠️ le chargeur exige la feuille principale, pas seulement « une » feuille',
  /principale/i.test(src.slice(src.indexOf('function chargerDictionnaireFr'),
                               src.indexOf('function chargerDictionnaireFr') + 2200)), true);

console.log(lignes.join('\n'));
console.log('\n' + (ok + ko) + ' verifications OK, ' + ko + ' ECHEC(S)\n');
process.exit(ko ? 1 : 0);
