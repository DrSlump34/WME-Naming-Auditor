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
   'RE_BRET_DOUBLE_NUMERO', 'RE_VOIE_LONGUE', 'PREFIXE_VOIE'].map(relire).join('\n'),
  extraire('initialeIsolee'),
  'const dico = { regles: [] };',
  'function ecartDeRedaction() { return null; }',
  'const options = { controles: { abreviations: true, contractions: true,',
  '  majuscule: true, fonctionDirection: true, nomComposite: true,',
  '  formatBretelle: true, voieCommunale: true, redactionDico: false } };',
  extraire('verifierForme'),
  'return { verifierForme, RE_ROCADE };'
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
  /verifierSansVille\(nam, estRail\)\.concat\(forme\)/.test(src), true);

console.log(lignes.join('\n'));
console.log('\n' + (ok + ko) + ' verifications OK, ' + ko + ' ECHEC(S)\n');
process.exit(ko ? 1 : 0);
