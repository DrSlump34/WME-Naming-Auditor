/**
 * Tests de la REDACTION APPLICABLE — v2.30.00.
 *
 * ⭐ ORIGINE : le premier test live du dictionnaire, par l'auteur, le 03/08/2026.
 * Il nomme volontairement une voie « Av. du Chateau ». WNA repond « ecrire le
 * type de voie en toutes lettres » — une EXPLICATION, sans nom propose. Sa
 * remarque : « Pourquoi ne pas proposer de correction ? Et normalement, y'a 2
 * corrections a proposer : Av. > Avenue et Chateau > Château. »
 *
 * Deux decisions en sont sorties, et ces tests les figent :
 *
 * 1. « OPTION B » — quand le dictionnaire propose un nom qui CORRIGE DEJA la
 *    faute, le controle de forme correspondant SE TAIT. Un segment, un report
 *    (regle de 2.27.04). Deux lignes pour le meme nom, dont une sans nom
 *    propose, c'est du bruit — et le risque reel est d'appliquer la moins bonne.
 *
 * 2. LE ⚡ APPLIQUE LA REDACTION. « Ce qui serait top, c'est que la modification
 *    puisse etre automatique en cliquant sur l'eclair. »
 *
 * ⚠️⚠️ LE PIEGE QUE CES TESTS GARDENT — se taire est DANGEREUX des que la
 * proposition ne corrige pas tout. Le dictionnaire peut redresser l'accent sans
 * developper l'abreviation. Le controle ne se tait donc QUE si la faute a
 * disparu de la PROPOSITION, ce qui se MESURE en rejouant le controle dessus.
 * Les tests 5 a 8 tiennent exactement cette ligne : ne pas les « simplifier »
 * en faisant confiance au dictionnaire par principe.
 *
 * ⚠️ Fonctions EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-redaction-eclair.js
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
function extraireIife(nom) {
  const i = src.indexOf('const ' + nom + ' = (() => {');
  if (i < 0) throw new Error('bloc introuvable : ' + nom);
  let prof = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, src.indexOf(';', j) + 1);
}
function relire(nom) {
  const m = src.match(new RegExp('const\\s+' + nom + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('constante introuvable : ' + nom);
  return 'const ' + nom + ' = ' + m[1] + ';';
}

const api = new Function([
  ['RE_ABREV', 'RE_ABREV_SANS_POINT', 'RE_SAINT', 'RE_FONCTION', 'RE_DIRECTION',
   'RE_NOM_COMPOSITE', 'RE_SUFFIXE_ROCADE', 'nettoyerNom'].map(relire).join('\n'),
  extraire('formatRocade'),
  extraireIife('DICO_FONCTIONS'),
  extraire('initialeIsolee'), extraire('analyserDictionnaire'),
  extraire('appliquerDictionnaire'), extraire('nomEnCapitales'),
  extraire('ecartDeRedaction'),
  'let dico = { regles: [] };',
  'const options = { controles: {} };',
  extraire('verifierForme'), extraire('planDeCorrection'), extraire('resteAlaMain'),
  'return { verifierForme, planDeCorrection, resteAlaMain, analyserDictionnaire,',
  '         setDico: d => { dico = d; }, setControles: c => { options.controles = c; } };'
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

const TOUS = { abreviations: true, contractions: true, majuscule: true,
               fonctionDirection: true, nomComposite: true, redactionDico: true };
api.setControles(TOUS);

/** Construit un dictionnaire de test a partir de lignes CSV a la CRN. */
function dicoDe(...csv) {
  return { regles: api.analyserDictionnaire(csv.join('\n'), 1).regles };
}
const nam = (n, ville) => ({ primary: { name: n, cityName: ville || '' }, alts: [] });
const champs = n => api.verifierForme(n).map(e => e.champ);

// ---------------------------------------------------------------------------
// 1. LE CAS DE L'AUTEUR — « Av. du Chateau », dictionnaire complet
// Le dictionnaire developpe l'abreviation ET pose l'accent : le controle
// « abreviation » n'a plus rien a ajouter, il se tait.
// ---------------------------------------------------------------------------
const DICO_COMPLET = dicoDe('/Av\\. /g,"""Avenue """,//', '/Chateau/g,"""Château""",//');
api.setDico(DICO_COMPLET);

verifier('1. ⭐ « Av. du Chateau » ne remonte QU\'UN report (option B)',
  champs(nam('Av. du Chateau')), ['rédaction (dictionnaire FR)']);
verifier('2. ⭐ … et ce report porte les DEUX corrections a la fois',
  api.verifierForme(nam('Av. du Chateau'))[0].apres, 'Avenue du Château');
verifier('3. le temoin : un nom deja juste ne remonte rien',
  champs(nam('Avenue du Château')), []);
verifier('4. l\'accent seul est toujours signale (aucune abreviation en jeu)',
  champs(nam('Rue du Chateau')), ['rédaction (dictionnaire FR)']);

// ---------------------------------------------------------------------------
// 2. ⚠️⚠️ LE GARDE-FOU — LE DICTIONNAIRE NE CORRIGE PAS TOUT
// Ici il pose l'accent mais NE developpe PAS « Av. ». Se taire ferait perdre
// l'information : l'editeur appliquerait « Av. du Château », encore fautif, en
// croyant avoir tout corrige. ⇒ LES DEUX reports doivent rester.
// ⭐ Tests de VOLONTE : ne pas les « optimiser » en faisant confiance au
// dictionnaire par principe. C'est la mesure sur la PROPOSITION qui decide.
// ---------------------------------------------------------------------------
api.setDico(dicoDe('/Chateau/g,"""Château""",//'));
verifier('5. ⚠️⚠️ accent corrige mais abreviation NON : les 2 reports restent',
  champs(nam('Av. du Chateau')),
  ['abreviation', 'rédaction (dictionnaire FR)']);
verifier('6. ⚠️ … et le nom propose est bien celui, encore imparfait, du dico',
  api.verifierForme(nam('Av. du Chateau'))[1].apres, 'Av. du Château');

// Meme logique sur la contraction : « St- » non traite par ce dictionnaire.
api.setDico(dicoDe('/Chateau/g,"""Château""",//'));
verifier('7. ⚠️ contraction non corrigee par le dico : son report reste',
  champs(nam('Route de St-Chateau')),
  ['contraction', 'rédaction (dictionnaire FR)']);

// Et quand le dictionnaire corrige VRAIMENT la contraction, le controle se tait.
api.setDico(dicoDe('/St-/g,"""Saint-""",//'));
verifier('8. ⭐ contraction corrigee par le dico : un seul report',
  champs(nam('Route de St-Fargeau')), ['rédaction (dictionnaire FR)']);

// ---------------------------------------------------------------------------
// 3. ⚠️ LE DICTIONNAIRE ETEINT NE FAIT TAIRE PERSONNE
// C'est le cas de l'editeur qui a WME Check Road Name (case decochee d'office)
// ou dont le chargement a echoue. Le comportement d'avant doit revenir intact.
// ---------------------------------------------------------------------------
api.setDico({ regles: [] });
verifier('9. ⚠️ sans dictionnaire, « abreviation » parle comme avant',
  champs(nam('Av. du Chateau')), ['abreviation']);
api.setDico(DICO_COMPLET);
api.setControles(Object.assign({}, TOUS, { redactionDico: false }));
verifier('10. ⚠️ dictionnaire DECOCHE : « abreviation » parle aussi',
  champs(nam('Av. du Chateau')), ['abreviation']);
api.setControles(TOUS);

// ---------------------------------------------------------------------------
// 4. ⚠️⚠️ LES CAPITALES NE FONT JAMAIS TAIRE NI N'ECRIVENT RIEN
// Le dictionnaire ne sait pas redresser un nom tout en majuscules (mesure du
// 01/08 : « RUE DES ECOLES » -> « RUE DES ÉcolES »). L'ecart porte alors un
// AUTRE champ et le drapeau `sansProposition`.
// ---------------------------------------------------------------------------
verifier('11. ⚠️⚠️ un nom en CAPITALES ne fait taire aucun controle de forme',
  champs(nam('RTE. DES ECOLES')), ['abreviation', 'nom en capitales']);
verifier('12. ⚠️⚠️ … et l\'ecart capitales ne propose AUCUN nom',
  (api.verifierForme(nam('RTE. DES ECOLES'))
      .find(e => e.champ === 'nom en capitales') || {}).sansProposition, true);

// ⚠️⚠️⚠️ LE DEFAUT TROUVE EN ECRIVANT CE TEST — ET IL AURAIT ECRIT SUR LA CARTE.
// Mon test etait faux, pas le code : `nomEnCapitales` ne comptait que les mots
// d'au moins 3 LETTRES et en exigeait deux. « AV. DU CHATEAU » n'en laissait
// qu'un (« CHATEAU ») ⇒ garde-fou muet, nom envoye au dictionnaire.
//
// ⚡ MESURE SUR LES 1 428 REGLES REELLES, avant correctif :
//     AV. DU CHATEAU  -> « Avenue DU ChâtEAU »
//     BD DE LA GARE   -> « Boulevard de la GARE »
//     PL. DE L EGLISE -> « Place de L Église »
// Tant que la redaction n'etait qu'AFFICHEE, l'editeur voyait ces monstres et
// ne les appliquait pas. Le ⚡ de cette version les aurait POSES SUR LA CARTE.
//
// ⭐⭐ LA LECON : un garde-fou calibre pour un AFFICHAGE ne l'est plus des qu'on
// ECRIT. Ce n'est pas le garde-fou qui avait change, c'est l'usage de sa sortie.
// ⇒ Seuil passe a 2 lettres. Ces tests figent le NOUVEAU comportement ; s'ils
//   tombent, c'est que quelqu'un a « optimise » le seuil sans relire ceci.
verifier('12b. ⚠️⚠️⚠️ un nom COURT tout en capitales est refuse (⚡ ne l\'ecrira pas)',
  champs(nam('AV. DU CHATEAU')), ['abreviation', 'nom en capitales']);
verifier('12c. ⚠️⚠️ … idem sans point sur l\'abreviation',
  champs(nam('BD DE LA GARE')), ['abreviation', 'nom en capitales']);
verifier('12d. ⚠️⚠️ … et aucun de ces refus n\'est applicable par le ⚡',
  api.planDeCorrection({ cible: { primary: { name: 'X', cityName: '' }, alts: [] },
    libelle: 'AV. DU CHATEAU / Nîmes', villeActuelle: 'Nîmes',
    ecarts: api.verifierForme(nam('AV. DU CHATEAU')) }), null);

// ⚠️ Le seuil a 2 lettres ne doit PAS mordre sur les noms legitimes : un sigle
// a points, un numero de route, un mot isole en capitales dans un nom correct.
verifier('12e. le seuil n\'attrape pas « Rue du T.I.V. » (sigle officiel)',
  champs(nam('Rue du T.I.V.')), []);
verifier('12f. … ni « Avenue EDF » (un seul mot en capitales)',
  champs(nam('Avenue EDF')), []);
verifier('12g. … ni « ZA les Plaines »',
  champs(nam('ZA les Plaines')), []);

// ---------------------------------------------------------------------------
// 5. ⚡ L'APPLICATION PAR LE BOUTON — ce que `planDeCorrection` fabrique
// ---------------------------------------------------------------------------
const report = (ecarts, extra) => Object.assign({
  cible: { primary: { name: 'X', cityName: '' }, alts: [] },
  libelle: 'Av. du Chateau / Nîmes', villeActuelle: 'Nîmes', ecarts
}, extra || {});
const RED = { champ: 'rédaction (dictionnaire FR)', avant: 'Av. du Chateau',
              apres: 'Avenue du Château' };

verifier('13. ⚡ la redaction devient une operation sur le nom principal',
  api.planDeCorrection(report([RED])),
  [{ type: 'principal', nom: 'Avenue du Château', ville: 'Nîmes' }]);

verifier('14. ⚠️⚠️ la VILLE est reprise telle quelle — l\'omettre l\'EFFACERAIT',
  api.planDeCorrection(report([RED], { villeActuelle: 'Uzès' }))[0].ville, 'Uzès');

verifier('15. ⚠️⚠️ un ecart sur un ALTERNATIF n\'est PAS applicable',
  api.planDeCorrection(report([
    { champ: 'rédaction (dictionnaire FR) (alt)', avant: 'Av. du Chateau',
      apres: 'Avenue du Château' }])), null);

verifier('16. ⚠️⚠️ `sansProposition` n\'ecrit JAMAIS rien',
  api.planDeCorrection(report([
    { champ: 'rédaction (dictionnaire FR)', avant: 'AV. DU CHATEAU',
      apres: 'à réécrire en minuscules accentuées (nom non proposé)',
      sansProposition: true }])), null);

verifier('17. ⚠️ « nom en capitales » n\'est meme pas reconnu comme redaction',
  api.planDeCorrection(report([
    { champ: 'nom en capitales', avant: 'AV. DU CHATEAU',
      apres: 'à réécrire en minuscules accentuées (nom non proposé)',
      sansProposition: true }])), null);

// ⚠️⚠️ LE CAS QUI COMMANDE LE REFUS N°2 : le logigramme veut « D62 » sur le
// principal (hors agglomeration), le dictionnaire veut « Avenue du Château ».
// Y coller le nom redresse ECRASERAIT la decision de zonage par une correction
// de forme. Le logigramme prime, la redaction reste a la main.
verifier('18. ⚠️⚠️ le logigramme prime : pas de redaction quand il a deja decide',
  api.planDeCorrection(report([{ champ: 'principal', avant: 'x', apres: 'y' }, RED],
    { cible: { primary: { name: 'D62', cityName: '' }, alts: [] } })),
  [{ type: 'principal', nom: 'D62', ville: '', candidats: null }]);

verifier('19. ⭐ … et ce qui reste a la main est alors compte honnetement',
  api.resteAlaMain(report([{ champ: 'principal', avant: 'x', apres: 'y' }, RED],
    { cible: { primary: { name: 'D62', cityName: '' }, alts: [] } })), 1);

verifier('20. le report deja traite ne fabrique plus rien',
  api.planDeCorrection(report([RED], { traite: true })), null);

verifier('21. la redaction se cumule avec un alternatif manquant',
  api.planDeCorrection(report([RED,
    { champ: 'alt manquant', avant: '', apres: 'D62 / ‹sans ville›' }])),
  [{ type: 'principal', nom: 'Avenue du Château', ville: 'Nîmes' },
   { type: 'alt', nom: 'D62', ville: '' }]);

// ---------------------------------------------------------------------------
// 6. ⚠️ VERROU DE STRUCTURE — `villeActuelle` doit exister sur les reports
// Sans lui, `planDeCorrection` ecrirait une ville vide et EFFACERAIT la ville du
// segment. Le test regarde le userscript lui-meme, pas la fonction extraite.
// ---------------------------------------------------------------------------
verifier('22. ⚠️⚠️ `villeActuelle` est bien pose sur chaque report de segment',
  /const base = \{[\s\S]{0,220}villeActuelle:/.test(src), true);
verifier('23. ⚠️ l\'ecriture passe par `updateAddress` (le segment), pas par un renommage de Street',
  /op\.type === 'principal'[\s\S]{0,400}updateAddress/.test(src), true);

console.log(lignes.join('\n'));
console.log('\n' + (ok + ko) + ' verifications OK, ' + ko + ' ECHEC(S)\n');
process.exit(ko ? 1 : 0);
