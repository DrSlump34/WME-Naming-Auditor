/**
 * LE NOM DU COMUNE — celui que WME PORTE, pas celui que la source SERT.
 *
 * ⭐⭐ CE FICHIER EST UN ETALON, PAS UNE BATTERIE DE CAS INVENTES. Chaque nom
 * de gauche est un nom REELLEMENT SERVI par openpolis/geojson-italy (releve le
 * 09/09 sur les 110 fichiers de province, 7 896 comuni) ; chaque nom de droite
 * est la « Denominazione in italiano » de la liste ISTAT du 08.09.2026 fournie
 * par Silvio (CC IT), 7 894 comuni. Aucun n'a ete compose a la main.
 *
 * CE QU'IL PROTEGE, et pourquoi c'est vital :
 *
 * 🔴 1. LES 116 COMUNI DE BOLZANO. openpolis sert « Bolzano/Bozen », WME porte
 *       « Bolzano » (releve dans l'editeur par l'auteur le 09/09). Le nom du
 *       contour devient la ville CIBLE et le temoin de `poiVilleCommune` : sans
 *       coupe, une province entiere partait en faux positifs et le bouton de
 *       correction proposait une ville inexistante.
 *
 * 🔴🔴 2. LES 60 COMUNI A TIRET LEGITIME. C'est le vrai piege : « couper au
 *       tiret » repare 8 comuni et en casse 60 (« Gattico-Veruno »,
 *       « Pont-Saint-Martin »). Les huit bilingues au tiret sont donc NOMMEES
 *       une a une, et ce test EXIGE que les 60 autres restent intactes. Si
 *       quelqu'un remplace un jour la table par une regle de forme, c'est ici
 *       que ca doit tomber.
 *
 * 🔴 3. LES CINQ NOMS MIXTES — « Castelbello-Ciardes/Kastelbell-Tschars ». Un
 *       nom italien qui contient LUI-MEME un tiret, ET un second nom apres le
 *       slash. Ils prouvent que la coupe se fait au SLASH et jamais au tiret.
 *
 * ⚠️ La fonction est EXTRAITE du userscript, jamais recopiee : un test qui
 * reecrirait la regle ne prouverait rien.
 *
 * Usage : node tools/test-nom-comune.js
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

function extraireBloc(debut, ouvrant, fermant) {
  const i = src.indexOf(debut);
  if (i < 0) throw new Error('introuvable dans le userscript : ' + debut);
  let n = 0, j = src.indexOf(ouvrant, i);
  const d = j;
  for (; j < src.length; j++) {
    if (src[j] === ouvrant) n++;
    else if (src[j] === fermant) { n--; if (!n) { j++; break; } }
  }
  return src.slice(d, j);
}

// La table et la fonction, prises telles qu'elles vivent dans le script.
const table = extraireBloc('const COMUNI_DOUBLE_NOM = {', '{', '}');
const corps = extraireBloc('function nomComuneIT(nom) {', '{', '}');
const nomComuneIT = new Function('COMUNI_DOUBLE_NOM',
  'return function nomComuneIT(nom) ' + corps + ';')(eval('(' + table + ')'));

let ok = 0, ko = 0;
function v(entree, attendu, quoi) {
  const rendu = nomComuneIT(entree);
  if (rendu === attendu) { ok++; return; }
  ko++;
  console.log('  ECHEC [' + quoi + '] ' + JSON.stringify(entree) +
              '\n         rendu   : ' + JSON.stringify(rendu) +
              '\n         attendu : ' + JSON.stringify(attendu));
}

// ── 1. Province de Bolzano : la barre oblique ────────────────────────────────
// 15 des 116, choisis pour leurs formes : nom long, point abrege, nom identique
// dans les deux langues, esszett allemand.
const BOLZANO = {
  'Aldino/Aldein': 'Aldino',
  'Appiano sulla strada del vino/Eppan an der Weinstraße': 'Appiano sulla strada del vino',
  'Brunico/Bruneck': 'Brunico',
  'Corvara in Badia/Corvara': 'Corvara in Badia',
  'Laives/Leifers': 'Laives',
  'Nalles/Nals': 'Nalles',
  'Racines/Ratschings': 'Racines',
  'Sarentino/Sarntal': 'Sarentino',
  'Tirolo/Tirol': 'Tirolo',
  'Vipiteno/Sterzing': 'Vipiteno',
  'Bolzano/Bozen': 'Bolzano',
  'Gais/Gais': 'Gais',
  'Ortisei/St. Ulrich': 'Ortisei',
  'Silandro/Schlanders': 'Silandro',
  'Varna/Vahrn': 'Varna'
};
for (const [servi, attendu] of Object.entries(BOLZANO)) v(servi, attendu, 'Bolzano');

// ── 2. Les huit comuni bilingues au TIRET ────────────────────────────────────
// Trentin, Gorizia, Trieste. Aucune forme ne les distingue : elles sont nommees.
const TIRET_BILINGUE = {
  'Doberdò del Lago-Doberdob': 'Doberdò del Lago',
  'Duino Aurisina-Devin Nabrežina': 'Duino Aurisina',
  'Monrupino-Repentabor': 'Monrupino',
  'San Dorligo della Valle-Dolina': 'San Dorligo della Valle',
  'San Floriano del Collio-Števerjan': 'San Floriano del Collio',
  'San Giovanni di Fassa-Sèn Jan': 'San Giovanni di Fassa',
  "Savogna d'Isonzo-Sovodnje ob Soči": "Savogna d'Isonzo",
  'Sgonico-Zgonik': 'Sgonico'
};
for (const [servi, attendu] of Object.entries(TIRET_BILINGUE)) v(servi, attendu, 'tiret bilingue');

// ── 3. 🔴 LES TIRETS LEGITIMES : ILS NE BOUGENT PAS ──────────────────────────
// 30 des 60 comuni servis avec un tiret qui n'est PAS un separateur de langue.
// Une regle de forme « couper au tiret » les casserait toutes.
const TIRET_LEGITIME = [
  'Gattico-Veruno', 'Moransengo-Tonengo', 'Brignano-Frascata', 'Antey-Saint-André',
  'Challand-Saint-Anselme', 'Gressoney-La-Trinité', 'Pont-Saint-Martin',
  'Pré-Saint-Didier', 'Rhêmes-Notre-Dame', 'Saint-Rhémy-en-Bosses', 'Saint-Vincent',
  'Brissago-Valtravaglia', 'Cocquio-Trevisago', 'Laveno-Mombello', 'Travedona-Monate',
  'Toscolano-Maderno', 'Casale Cremasco-Vidolasco', 'Gadesco-Pieve Delmona',
  'Castello-Molina di Fiemme', 'Nago-Torbole', 'Ruffrè-Mendola', 'Pieve di Bono-Prezzo',
  'Amblar-Don', 'Cavallino-Treporti', 'Chiopris-Viscone', 'Montecatini-Terme',
  'Presicce-Acquarica', 'Corigliano-Rossano', 'Giardini-Naxos', 'Tripi - Abakainon'
];
for (const n of TIRET_LEGITIME) v(n, n, 'tiret legitime');

// ── 4. 🔴 LES NOMS MIXTES : tiret DANS le nom italien, PUIS un slash ─────────
const MIXTES = {
  'Castelbello-Ciardes/Kastelbell-Tschars': 'Castelbello-Ciardes',
  'Monguelfo-Tesido/Welsberg-Taisten': 'Monguelfo-Tesido',
  'Naz-Sciaves/Natz-Schabs': 'Naz-Sciaves',
  'Rasun-Anterselva/Rasen-Antholz': 'Rasun-Anterselva',
  'Senale-San Felice/Unsere Liebe Frau im Walde-St. Felix': 'Senale-San Felice'
};
for (const [servi, attendu] of Object.entries(MIXTES)) v(servi, attendu, 'mixte');

// ── 5. Les comuni ordinaires : rien ne doit changer ──────────────────────────
const ORDINAIRES = ['Bergamo', 'Roma', 'Milano', "Reggio nell'Emilia",
                    'San Giovanni in Persiceto', "L'Aquila", 'Forlì'];
for (const n of ORDINAIRES) v(n, n, 'ordinaire');

// ── 6. Les cas vides — la fonction ne doit rien inventer ─────────────────────
v('', '', 'vide');
v(null, null, 'null');
v(undefined, undefined, 'undefined');
// Un slash en tete n'est pas un separateur de langue : `indexOf > 0` le protege.
v('/Bozen', '/Bozen', 'slash en tete');

// ── 7. La France ne declare PAS `nomCommune` : le nom passe tel quel ─────────
// ⚠️ Verifie sur le REFERENTIEL, pas sur une intention : si un jour quelqu'un
//    branche la normalisation italienne sur la France, « Saint-Laurent-des-Arbres »
//    deviendrait un nom coupe.
const iFR = src.indexOf('const REFERENTIELS = {');
const iIT = src.indexOf('    IT: {', iFR);
if (iFR < 0 || iIT < 0) throw new Error('REFERENTIELS introuvable');
if (/\bnomCommune\s*:/.test(src.slice(iFR, iIT))) {
  ko++; console.log('  ECHEC [FR] le referentiel FRANCAIS declare `nomCommune` : '
    + 'les communes a tiret ou a slash y seraient coupees');
} else ok++;
if (/\bnomCommune\s*:\s*nomComuneIT\b/.test(src.slice(iIT))) ok++;
else { ko++; console.log('  ECHEC [IT] le referentiel ITALIEN ne branche pas `nomComuneIT`'); }

// ── 8. Le nom est normalise AU CHARGEMENT **et** A LA RESTAURATION ───────────
// ⚠️ Un correctif applique au seul telechargement laisserait le defaut chez
//    tous ceux qui ont deja charge leur province — et personne ne recharge une
//    province qu'il a deja.
if (/const nom = \(brut && REF\.nomCommune\) \? REF\.nomCommune\(brut\) : brut;/.test(src)) ok++;
else { ko++; console.log('  ECHEC [chargement] `chargerFeatureCollection` ne normalise plus le nom'); }
if (/referentielDeCommune\(com\);\s*\n\s*if \(ref && ref\.nomCommune && com\.nom\)/.test(src)) ok++;
else { ko++; console.log('  ECHEC [restauration] `restaurerContours` ne normalise plus les contours en base'); }
// 🔴 Et avec le referentiel de CE contour, jamais le courant (defaut du 08/09).
if (!/if \(REF\.nomCommune && com\.nom\)/.test(src)) ok++;
else { ko++; console.log('  ECHEC [restauration] la normalisation suit le referentiel COURANT'); }

console.log((ko ? '\n' : '') + ok + ' verifications OK, ' + ko + ' ECHEC(S)');
process.exit(ko ? 1 : 0);
