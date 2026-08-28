#!/usr/bin/env node
// test-bretelle-forme.js — le nom d'une bretelle suit-il la forme du guide FR ?
//
// POURQUOI CE CONTROLE EXISTE (2026-08-28)
// ----------------------------------------
// Les trois controles de bretelle en place sont NEGATIFS : ils interdisent une direction
// qui est une route (« A71: A10 »), deux numeros colles (« A40 - E21: Paris »), un
// deux-points mal espace (« Sortie 18 : Valensole »). Aucun n'EXIGE la forme.
// Consequence mesuree : « Av. de la Gare » ou « Bretelle de sortie » sur une bretelle ne
// declenchaient RIEN — ces noms ne contiennent aucune des fautes cherchees.
// `RE_BRET_FORME` ferme cet angle mort. Ce test la surveille, extraite du fichier reel.
//
// ⚠️ Ce que le controle NE FAIT PAS, volontairement :
//   - il ne verifie pas la DESTINATION (le guide interdit d'improviser, et WNA ne voit
//     pas le panneau) ;
//   - il ne juge pas l'ESPACEMENT du deux-points : « Sortie 18 : Valensole » a la bonne
//     FORME et sa faute d'espace est deja dite par RE_DIRECTION. Deux ecarts pour une
//     faute, sur la meme ligne, seraient du bruit.
'use strict';
const fs = require('fs');
const path = require('path');

const FICHIER = path.join(__dirname, '..', 'WME-Naming-Auditor.user.js');
const src = fs.readFileSync(FICHIER, 'utf8');

const i = src.indexOf('const RE_BRET_FORME');
if (i < 0) { console.error('ECHEC : RE_BRET_FORME introuvable'); process.exit(2); }
const j = src.indexOf("'i');", i);
if (j < 0) { console.error('ECHEC : fin de RE_BRET_FORME introuvable'); process.exit(2); }
const RE = new Function(src.slice(i, j + 5).replace('const RE_BRET_FORME =', 'return'))();

let ok = 0, ko = 0;
const dit = (b, quoi) => { console.log('  ' + (b ? 'ok  ' : 'KO  ') + ' ' + quoi); b ? ok++ : ko++; };

console.log('\n— Les formes du guide passent —');
[
    ['A6a: Paris',           'numero de bretelle + ville'],
    ['A40: Lyon',            'autoroute'],
    ['N7: Avignon',          'nationale'],
    ['D6113: Narbonne',      'departementale a 4 chiffres'],
    ['E15: Barcelone',       'europeenne'],
    ['M1: Nice',             'metropolitaine'],
    ['Sortie 18: Valensole', 'sortie numerotee'],
    ['Sortie 3b: Gap',       'sortie avec lettre'],
    ['> Orsay',              'sortie sans numero — le chevron du guide'],
].forEach(([n, quoi]) => dit(RE.test(n), '« ' + n + ' »   ' + quoi));

console.log('\n— Ce qui doit etre signale —');
[
    ['Av. de la Gare',    'nom de voie ordinaire sur une bretelle'],
    ['Bretelle de sortie', 'la fonction en guise de nom'],
    ['vers Orsay',        'la direction sans le chevron'],
    ['Paris',             'la destination toute seule'],
    ['A6a',               'le numero sans destination'],
    ['A6a:',              'deux-points sans rien apres'],
    ['Sortie',            'le mot seul'],
    ['>Orsay',            'chevron sans espace — le guide ecrit « > Orsay »'],
    ['Rue du Pont',       'une rue'],
].forEach(([n, quoi]) => dit(!RE.test(n), '« ' + n + ' »   ' + quoi));

console.log('\n— L espacement du deux-points n est PAS son sujet —');
dit(RE.test('Sortie 18 : Valensole'),
    'la forme espacee PASSE ici — sa faute est dite par RE_DIRECTION, pas deux fois');

console.log('\n— TEMOIN DE MORSURE —');
// Sans lui, une regex qui accepterait tout passerait les neuf cas conformes, et le
// verdict rassurant ne vaudrait rien.
const toutPasse = ['Av. de la Gare', 'Bretelle de sortie', 'Rue du Pont'].every(n => RE.test(n));
dit(!toutPasse, 'la regex REFUSE vraiment quelque chose (elle n accepte pas tout)');
const rienNePasse = ['A6a: Paris', '> Orsay'].every(n => !RE.test(n));
dit(!rienNePasse, 'et elle ACCEPTE vraiment quelque chose (elle ne refuse pas tout)');

console.log('\n— Verdict —');
console.log(ko ? '  ' + ko + ' KO sur ' + (ok + ko) + '\n\nECHEC\n' : '  ' + ok + ' ok, 0 ko\n\nTOUT PASSE\n');
process.exit(ko ? 1 : 0);
