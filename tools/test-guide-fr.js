/**
 * Tests du GUIDE FR DE NOMMAGE, rejoue exemple par exemple — v2.32.00.
 *
 * ⭐ ORIGINE : l'auteur, le 03/08/2026 — « Rejette un oeil ici », suivi du lien
 * vers le guide France sur Waze Discuss :
 * https://www.waze.com/discuss/t/nommage-des-segments-des-rues-des-routes/375658
 *
 * ⭐⭐ CE QUE CE FICHIER EST, ET POURQUOI IL COMPTE : il prend les exemples que
 * le guide donne LUI-MEME comme bons (✅) ou mauvais (❌), et les passe dans le
 * VRAI pipeline du script. Un ✅ signale est un FAUX POSITIF — le script ferait
 * casser un nom conforme. Un ❌ muet est un ANGLE MORT.
 * C'est la seule facon de savoir si WNA dit la meme chose que la norme qu'il
 * pretend appliquer. Une relecture ne l'aurait pas dit : la premiere execution a
 * trouve 3 faux positifs et 9 angles morts sur 48 exemples.
 *
 * ⚠️⚠️ CE QUI RESTE VOLONTAIREMENT HORS CONTROLE (arbitrage de l'auteur :
 * « Arrete la ») — ne pas « completer » ces cas un jour de zele :
 *   - le nom d'echangeur (« Sortie 23 Remoulins: Avignon ») ;
 *   - la seconde direction (« Sortie 18: Valensole / Gréoux »).
 * Les deux exigent de VOIR LE PANNEAU. Le guide lui-meme : « ne tentez pas
 * d'improviser ». Ils figurent ci-dessous en `TOLERE`, avec leur raison.
 *
 * ⚠️ Fonctions et regex EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-guide-fr.js
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
function relire(nom) {
  const m = src.match(new RegExp('const\\s+' + nom + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('constante introuvable : ' + nom);
  return 'const ' + nom + ' = ' + m[1] + ';';
}

const api = new Function([
  ['RE_ABREV', 'RE_ABREV_SANS_POINT', 'RE_SAINT', 'RE_FONCTION', 'RE_DIRECTION',
   'RE_NOM_COMPOSITE', 'RE_ROCADE', 'RE_BRET_DIRECTION_ROUTE',
   'RE_BRET_DOUBLE_NUMERO', 'RE_VOIE_LONGUE', 'PREFIXE_VOIE',
   'RE_SUFFIXE_ROCADE', 'SIGNTYPE_ROCADE_FR'].map(relire).join('\n'),
  extraire('initialeIsolee'), extraire('formatRocade'), extraire('rocadeDe'),
  'const dico = { regles: [] };',
  'function ecartDeRedaction() { return null; }',
  'const options = { controles: { abreviations: true, contractions: true,',
  '  majuscule: true, fonctionDirection: true, nomComposite: true,',
  '  formatBretelle: true, voieCommunale: true, redactionDico: false } };',
  extraire('verifierForme'),
  "function fmt(e){ return (e.name||'‹sans nom›') + ' / ' + (e.cityName||'‹sans ville›'); }",
  extraire('verifierSansVille'),
  'return { verifierForme, RE_ROCADE, rocadeDe, formatRocade, verifierSansVille };'
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

/**
 * Rejoue le pipeline reel d'`analyser` pour la partie NOM.
 * roadType : 4 = bretelle, 6 = voie rapide, 1 = rue.
 */
function auditer(nom, roadType) {
  const bretelle = roadType === 4;
  return api.verifierForme({ primary: { name: nom, cityName: '' }, alts: [] },
                           { bretelle }).map(e => e.champ);
}
const muet = (nom, rt) => auditer(nom, rt).length === 0;

// ---------------------------------------------------------------------------
// 1. ✅ LES NOMS QUE LE GUIDE DONNE COMME CONFORMES — aucun ne doit etre signale
// ⭐ Ce sont les tests les plus importants du fichier : un faux positif ici
// pousse un editeur a CASSER un nom juste.
// ---------------------------------------------------------------------------
const CONFORMES = [
  ['A4: Reims', 4, 'bretelle entrée autoroute'],
  ['A6a: Paris', 4, 'numéro à lettre'],
  ['E72: Tarbes', 4, 'européen, national absent'],
  ['Sortie 18: Valensole', 4, 'sortie numérotée'],
  ['Sortie 47', 4, 'sortie sans direction'],
  ['D70: Vesoul', 4, 'sortie non numérotée avec n° de route'],
  ['> Orsay', 4, 'sortie sans n° de route'],
  ['D118: Chartres / Villejust', 4, 'ambiguïté : 2 directions admises'],
  ['Porte de Pantin', 4, 'périphérique parisien'],
  ['Périphérique Ouest', 4, 'entrée de rocade'],
  ['Périphérique Nord', 4, 'entrée de rocade'],
  ['Périphérique Intérieur', 6, 'exception parisienne'],
  ['C6', 1, 'voie communale, forme abrégée'],
  ['VC6', 1, 'voie communale'],
  ['CR12', 1, 'chemin rural'],
  ['Rue du T.I.V.', 1, 'sigle officiel à points'],
  ['Rue de la Deuxième D.B.', 1, 'sigle officiel'],
  ['Rue du 11 Novembre', 1, 'nombre en chiffres'],
  ['Rue du Onze Novembre', 1, 'nombre en lettres'],
  ['Rue Jean-Pierre Timbaud', 1, 'nom composé'],
  ['Rue de la République', 1, 'témoin : parfaitement conforme']
];
CONFORMES.forEach(([nom, rt, note], i) => {
  verifier('1.' + (i + 1) + ' ✅ « ' + nom +' » est conforme (' + note + ')',
    auditer(nom, rt), []);
});

// ---------------------------------------------------------------------------
// 2. ❌ LES NOMS QUE LE GUIDE DONNE COMME FAUTIFS — le script doit les voir
// ---------------------------------------------------------------------------
const FAUTIFS = [
  ['Sortie 18 : Valensole', 4, 'bretelle : espacement du « : »',
   'espace avant les deux-points'],
  ['A71: A10', 4, 'bretelle : direction = numéro de route',
   'la direction est une autoroute, pas une ville'],
  ['A40 - E21: Paris / Mâcon', 4, 'bretelle : deux numéros de route',
   'double numéro'],
  ['Voie Communale n°6', 1, 'voie communale en toutes lettres',
   'tronqué en guidage'],
  ['Chemin Rural n°12', 1, 'voie communale en toutes lettres', 'idem'],
  ['Rue R. Poincaré', 1, 'contraction', 'initiale isolée'],
  ['Route de St-Fargeau', 1, 'contraction', 'contraction de Saint'],
  ['Av. de la Gare', 1, 'abreviation', 'abréviation de type de voie'],
  ['Rue Nationale : Marseille', 1, 'direction dans le nom', 'direction hors bretelle'],
  ['Voie de bus', 1, 'fonction dans le nom', 'fonction du segment'],
  ['Parking Auchan', 1, 'fonction dans le nom', 'nature du lieu'],
  ['sortie 18: Valensole', 4, 'majuscule', "⭐ l'oubli corrigé le 03/08"],
  ['Av. de la Gare', 4, 'abreviation', "⭐ une bretelle obéit aussi à l'écriture"]
];
FAUTIFS.forEach(([nom, rt, champ, note], i) => {
  verifier('2.' + (i + 1) + ' ❌ « ' + nom + ' » est vu — ' + note,
    auditer(nom, rt).indexOf(champ) >= 0, true);
});

// ---------------------------------------------------------------------------
// 3. ⚠️⚠️ CE QU'ON NE CONTROLE PAS, ET C'EST UNE DECISION
// Ces noms sont FAUTIFS selon le guide, et le script se TAIT volontairement :
// trancher exigerait de voir le panneau. ⭐ Tests de VOLONTE — s'ils tombent,
// c'est que quelqu'un a ajoute un controle qui DEVINE. Le relire d'abord.
// ---------------------------------------------------------------------------
const TOLERE = [
  ['Sortie 23 Remoulins: Avignon', 4,
   "« Remoulins » est-il l'échangeur ou la direction ? Seul le panneau le dit"],
  ['Sortie 23: Remoulins', 4, "échangeur mis à la place de la direction — indécidable"],
  ['Sortie 47 Porte de Vertou', 4, "nom d'échangeur accolé — indécidable"],
  ['Sortie 47: Porte de Vertou', 4, "idem"],
  ['Sortie 18: Valensole / Gréoux-les-Bains', 4,
   "2e direction : admise SI le panneau est ambigu, ce que WNA ne voit pas"]
];
TOLERE.forEach(([nom, rt, pourquoi], i) => {
  verifier('3.' + (i + 1) + ' ⚠️ « ' + nom + ' » : on se tait — ' + pourquoi,
    muet(nom, rt), true);
});

// ---------------------------------------------------------------------------
// 4. ⚠️ LE « > » DES BRETELLES — exemption ETROITE
// ⭐ On retire le seul PREFIXE legitime, on ne dispense pas le nom entier :
// sinon « > Orsay : Paris » passerait en bloc alors que son « : » espace reste
// fautif. Et hors bretelle, « > » redevient interdit.
// ---------------------------------------------------------------------------
verifier('4.1 ⭐ « > Orsay : Paris » : le préfixe est toléré, pas le reste',
  auditer('> Orsay : Paris', 4).indexOf('bretelle : espacement du « : »') >= 0, true);
verifier('4.2 ⚠️ hors bretelle, « > Orsay » reste une direction interdite',
  auditer('> Orsay', 1).indexOf('direction dans le nom') >= 0, true);
verifier('4.3 ⚠️ « A4 > Reims » est fautif même sur une bretelle',
  auditer('A4 > Reims', 4).indexOf('bretelle : espacement du « : »') >= 0, true);

// ---------------------------------------------------------------------------
// 5. La voie communale : on PROPOSE quand le prefixe est connu, jamais sinon
// ⭐ « ON RECOPIE, ON N'INVENTE PAS » — meme regle que le cartouche (2.27.01).
// ---------------------------------------------------------------------------
{
  const ecart = nom => api.verifierForme({ primary: { name: nom, cityName: '' }, alts: [] }, {})
    .find(e => /voie communale/.test(e.champ));
  verifier('5.1 « Voie Communale n°6 » propose « VC6 »', ecart('Voie Communale n°6').apres, 'VC6');
  verifier('5.2 « Chemin Rural n°12 » propose « CR12 »', ecart('Chemin Rural n°12').apres, 'CR12');
  verifier('5.3 la casse et l\'espacement du libellé ne gênent pas',
    ecart('voie  communale 6').apres, 'VC6');
  verifier('5.4 ⚠️ un nom de voie ordinaire n\'est pas touché',
    ecart('Rue de la Gare'), undefined);
  verifier('5.5 ⚠️ « Voie Communale des Prés » n\'est PAS un numéro : on se tait',
    ecart('Voie Communale des Prés'), undefined);
}

// ---------------------------------------------------------------------------
// 6. ⚠️ LES DEUX CONTROLES NEUFS SE DECOCHENT, comme tous les autres
// ---------------------------------------------------------------------------
verifier('6.1 le format des bretelles est un contrôle à part entière',
  /cle: 'formatBretelle'/.test(src), true);
verifier('6.2 les voies communales aussi',
  /cle: 'voieCommunale'/.test(src), true);
// ⚠️ Le type d'une bretelle vient du SEGMENT, jamais de son nom (l'auteur).
verifier('6.3 ⚠️⚠️ une bretelle se reconnaît au TYPE du segment, pas au nom',
  /const estBretelle = seg\.roadType === REF\.typeBretelle;/.test(src), true);
verifier('6.4 ⚠️⚠️ les bretelles reçoivent bien les contrôles de forme (l\'oubli corrigé)',
  /verifierSansVille\(nam, regleNom\)\.concat\(forme\)/.test(src), true);

// ---------------------------------------------------------------------------
// 7. ⚡⚡ LES ROCADES — LE CARTOUCHE TRANCHE, PAS LE NOM
//
// ⭐ L'auteur, 03/08 : « y'a le roadshield Rocade associé au nom principal,
// c'est surtout ça l'élément qui tranche ». Le commentaire du code affirmait
// l'inverse (« rien dans le modèle Waze ne dit ceci est une rocade ») — c'etait
// FAUX, et ca nous a coute deux faux positifs sur des noms conformes.
//
// ⚡ VALEUR MESUREE EN LIVE (`W.model.signTypes`, pays 73 = France) :
//   1067 Métropole · 1072 Autoroute/Nationale · 1092 Départementale
//   3033 Voie communale / Chemin rural · 3035 ROCADE · 3036 Route européenne
//   3037 Route territoriale
// ⚠️⚠️ Le cartouche Rocade est declare `minTextLength: 0, maxTextLength: 0` :
// il ne porte AUCUN texte. On ne peut donc PAS le reconnaitre a son `signText`,
// seul le `signType` le dit. Ne jamais « simplifier » en testant le texte.
// ---------------------------------------------------------------------------
{
  const nam = (nom, signType) => ({
    primary: { name: nom, cityName: '', signText: '', signType: signType != null ? signType : null },
    alts: []
  });
  verifier('7.1 ⚡ le cartouche Rocade (3035) tranche, et c\'est une CERTITUDE',
    api.rocadeDe(nam('A86 - Intérieure', 3035)), { rocade: true, certain: true, motif: 'cartouche Rocade' });
  verifier('7.2 ⚠️ sans cartouche, le nom ne donne qu\'un DOUTE',
    api.rocadeDe(nam('N136 - Rocade Ouest')).certain, false);
  verifier('7.3 ⚠️ … et le format « numéro - orientation » aussi',
    api.rocadeDe(nam('A86 - Intérieure')).certain, false);
  verifier('7.4 ⚠️ mais il est bien reconnu comme rocade (plus de raisonnement agglo)',
    api.rocadeDe(nam('A86 - Intérieure')).rocade, true);
  verifier('7.5 une voie ordinaire n\'est pas une rocade',
    api.rocadeDe(nam('Rue de la République')).rocade, false);
  verifier('7.6 ⚠️⚠️ un cartouche Départementale (1092) n\'en fait PAS une rocade',
    api.rocadeDe(nam('D62', 1092)).rocade, false);

  // ⭐⭐ LES DEUX FAUX POSITIFS QUI ONT MOTIVE TOUT CECI. Le format exigé par le
  // guide tombe pile sur le motif que « numéro collé au nom » interdit.
  verifier('7.7 🔴→✅ « A86 - Intérieure » n\'est PLUS signalé', auditer('A86 - Intérieure', 6), []);
  verifier('7.8 🔴→✅ « N136 - Rocade Ouest » n\'est PLUS signalé', auditer('N136 - Rocade Ouest', 6), []);
  verifier('7.9 « A86 - Extérieure » également', auditer('A86 - Extérieure', 6), []);
  verifier('7.10 « N7 - Sud-Est » également', auditer('N7 - Sud-Est', 6), []);

  // ⚠️⚠️ LA LISTE DES SUFFIXES EST FERMEE, ET C'EST TOUT L'INTERET : l'ouvrir
  // rendrait légitime un composite quelconque. Ces deux-là restent interdits.
  verifier('7.11 ⚠️⚠️ « A9 - Autoroute la Languedocienne » reste INTERDIT',
    auditer('A9 - Autoroute la Languedocienne', 6).indexOf('numéro collé au nom') >= 0, true);
  verifier('7.12 ⚠️⚠️ « N580 - Route d\'Avignon » reste INTERDIT (le cas réel de 2.14)',
    auditer('N580 - Route d\'Avignon', 1).indexOf('numéro collé au nom') >= 0, true);
}

// ---------------------------------------------------------------------------
// 8. ⚠️⚠️ LES TROIS TYPES « SANS ADRESSE » N'OBEISSENT PAS A LA MEME REGLE
//
// Les confondre a produit deux ecarts avec le guide. Ce que le guide dit, mot
// pour mot :
//  - VOIE FERREE : « Le nom de ville **et rue** ne sera donc jamais renseignée,
//    ni en nom principal, ni en nom alternatif. »
//  - PISTE AEROPORT : « Le nom de ville sera donc jamais renseignée […] Le nom
//    OACI de l'aéroport peut être indiqué en nom de rue. »
//  - FERRY : le guide n'en parle NULLE PART.
// ⭐ D'ou trois regimes, et le troisieme est un choix de RETENUE : on garde le
// comportement etabli pour le ferry plutot que de durcir sans texte. On ne
// fabrique pas de norme quand la norme se tait.
// ---------------------------------------------------------------------------
{
  const nam = (nom, ville, alts) => ({
    primary: { name: nom || '', cityName: ville || '' },
    alts: (alts || []).map(a => ({ name: a, cityName: '' }))
  });
  const ch = (n, regle) => api.verifierSansVille(n, regle).map(e => e.champ);

  // VOIE FERREE — le nom est interdit jusqu'en alternatif.
  verifier('8.1 ⚠️⚠️ voie ferrée : le nom PRINCIPAL est interdit',
    ch(nam('Ligne Paris-Lyon'), 'tous'), ['nom principal interdit']);
  verifier('8.2 ⚠️⚠️ voie ferrée : le nom ALTERNATIF aussi (l\'écart corrigé le 04/08)',
    ch(nam('', '', ['Ligne Paris-Lyon']), 'tous'), ['nom alternatif interdit']);
  // ⚠️ Le mot « alternatif » figure dans les DEUX messages, l'ancien comme le
  //    nouveau : le chercher ferait passer ce test pour la mauvaise raison.
  //    C'est la PROPOSITION de bascule qu'il faut traquer.
  verifier('8.3 ⭐ … et on ne propose PLUS de BASCULER en alternatif',
    api.verifierSansVille(nam('Ligne Paris-Lyon'), 'tous')[0].apres.includes('à basculer'), false);
  verifier('8.3b ⭐ … le ferry, lui, garde cette proposition (le guide se tait)',
    api.verifierSansVille(nam('Bac de Blaye'), 'principal')[0].apres.includes('à basculer'), true);
  verifier('8.4 ⚠️ le retrait d\'un alternatif est annoncé comme MANUEL (le SDK ne sait pas)',
    api.verifierSansVille(nam('', '', ['X']), 'tous')[0].sansProposition, true);
  verifier('8.5 une voie ferrée nue ne remonte rien', ch(nam(''), 'tous'), []);

  // PISTE — seule la ville est interdite, le code OACI est ADMIS.
  verifier('8.6 🔴→✅ piste : le code OACI en nom de rue ne remonte RIEN',
    ch(nam('LFPG'), 'libre'), []);
  verifier('8.7 ⚠️ piste : la ville reste interdite',
    ch(nam('LFPG', 'Roissy'), 'libre'), ['ville interdite (principal)']);

  // FERRY — comportement etabli conserve : principal interdit, alternatif libre.
  verifier('8.8 ferry : le nom principal reste interdit',
    ch(nam('Bac de Blaye'), 'principal'), ['nom principal interdit']);
  verifier('8.9 ⭐ ferry : l\'alternatif n\'est PAS durci (le guide se tait)',
    ch(nam('', '', ['Bac de Blaye']), 'principal'), []);

  // ⚠️ La ville est interdite dans TOUS les regimes, alternatif compris.
  verifier('8.10 ⚠️ la ville est interdite même en alternatif',
    ch(nam('', '', []), 'libre').length === 0 &&
    api.verifierSansVille({ primary: { name: '', cityName: '' },
      alts: [{ name: 'X', cityName: 'Nîmes' }] }, 'libre')
      .map(e => e.champ), ['ville interdite (alt)']);

  // ⚠️ Verrou de branchement : les trois types doivent etre distingues.
  verifier('8.11 ⚠️⚠️ les trois régimes sont bien distingués dans l\'analyse',
    /seg\.roadType === REF\.typeRail \? 'tous'[\s\S]{0,120}typePiste \? 'libre' : 'principal'/.test(src), true);
  verifier('8.12 ⚠️ les types sont nommés, pas écrits en dur',
    /typePiste: 19/.test(src) && /typeRail: 18/.test(src), true);
}

console.log(lignes.join('\n'));
console.log('\n' + (ok + ko) + ' verifications OK, ' + ko + ' ECHEC(S)\n');
process.exit(ko ? 1 : 0);
