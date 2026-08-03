/**
 * Tests du contrôle « numéro collé au nom » — v2.14.
 *
 * Regle : « Dxxx - Nom de la route » est INTERDIT. C'est une ancienne regle FR,
 * abandonnee (auteur, 26/07). Le numero va au nom principal hors agglomeration,
 * ou en alternatif en agglomeration ; il ne se colle jamais au nom de voie.
 *
 * ⚡ Cas reel qui a motive le controle (segments 63412653 / 365882089 / 365882086,
 * N580 a Saint-Laurent-des-Arbres) : principal « N580 », alternatifs « N580 -
 * Route d'Avignon » ET « Route d'Avignon ». Le composite est un RESIDU en doublon.
 *
 * ⚠️ Regex et fonction EXTRAITES du userscript.
 *
 * Usage : node tools/test-nom-composite.js
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

function extraire(nom) {
  const i = src.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let prof = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, j + 1);
}
function relire(nom) {
  const m = src.match(new RegExp('const\\s+' + nom + '\\s*=\\s*([\\s\\S]*?);\\n'));
  if (!m) throw new Error('constante introuvable : ' + nom);
  return 'const ' + nom + ' = ' + m[1] + ';';
}

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

// ── la regex seule ─────────────────────────────────────────────────────────
const RE = new Function(relire('RE_NOM_COMPOSITE') + '\nreturn RE_NOM_COMPOSITE;')();

console.log('\n=== La regex : ce qui DOIT etre attrape ===\n');
const interdits = [
  ['N580 - Route d\'Avignon', 'N580', 'Route d\'Avignon'],   // le cas reel
  ['D980 - Route de Bagnols', 'D980', 'Route de Bagnols'],
  ['D6086-Avenue de Nîmes', 'D6086', 'Avenue de Nîmes'],      // sans espaces
  ['D 62 — Chemin des Vignes', 'D 62', 'Chemin des Vignes'],  // tiret cadratin
  ['C3 – Rue de la Poste', 'C3', 'Rue de la Poste'],          // tiret demi-cadratin
  ['A9 - Autoroute la Languedocienne', 'A9', 'Autoroute la Languedocienne'],
  ['D62E - Route de Tavel', 'D62E', 'Route de Tavel'],        // numero a lettre
  ['CV5 - Chemin du Moulin', 'CV5', 'Chemin du Moulin'],
];
for (const [nom, num, reste] of interdits) {
  const m = nom.match(RE);
  verifier('« ' + nom + ' » attrapé', !!m, true);
  if (m) verifier('   → numéro « ' + num + ' » et nom « ' + reste + ' »',
                  [m[1], m[2].trim()], [num, reste]);
}

console.log('\n=== La regex : ce qui NE DOIT PAS etre attrape ===\n');
const permis = [
  'N580',                              // numero seul
  'Route d\'Avignon',                  // nom seul
  'Rue Jean-Jacques Rousseau',         // tiret DANS un nom propre
  'Chemin de la Croix-Rouge',
  'Avenue Charles-de-Gaulle',
  'Saint-Laurent-des-Arbres',
  'Rue du 8-Mai-1945',                 // chiffres + tirets, mais pas un numero de route
  'Place des Anciens-Combattants',
  'Boulevard Jean-Baptiste-Lulli',
  'Impasse Louis-Pasteur',
  'D980',                              // numero seul, avec cartouche ailleurs
  'Chemin des Vignes',
];
for (const nom of permis) verifier('« ' + nom + " » épargné", !!nom.match(RE), false);

// ── le controle complet ────────────────────────────────────────────────────
console.log('\n=== Le contrôle dans verifierForme ===\n');
const PREAMBULE = [relire('RE_ROUTE'), relire('RE_ABREV'), relire('RE_ABREV_SANS_POINT'),
                   relire('RE_SAINT'), relire('RE_FONCTION'), relire('RE_DIRECTION'),
                   relire('RE_NOM_COMPOSITE'), relire('RE_SUFFIXE_ROCADE'),
                   // ⚠️ Le format des rocades est EXEMPTE du controle : voir
                   // la section « rocade » du userscript et test-guide-fr.js.
                   extraire('formatRocade')].join('\n');
function monter(controles) {
  // ⚠️ `verifierForme` consulte aussi le dictionnaire de redaction depuis la
  // v2.28.00. On lui fournit ici un environnement NEUTRE (interrupteur ferme,
  // aucune regle chargee) : ce fichier teste le nom composite, pas le
  // dictionnaire — celui-la a le sien, tools/test-dictionnaire.js.
  const code = PREAMBULE + '\n' +
    'const options = { controles: ' + JSON.stringify(controles) + ' };\n' +
    'const DICO_AUTORISE = false;\n' +
    'const dico = { regles: [] };\n' +
    'function ecartDeRedaction(){ return null; }\n' +
    'function initialeIsolee(){ return false; }\n' +
    extraire('verifierForme') + '\nreturn verifierForme;';
  return new Function(code)();
}
const N = (nom, alts) => ({
  primary: { name: nom, cityName: '' },
  alts: (alts || []).map(a => ({ name: a, cityName: '' }))
});
const TOUT = { nomComposite: true, abreviations: false, contractions: false,
               majuscule: false, fonctionDirection: false };
let vf = monter(TOUT);

// Le cas REEL : composite en alternatif, avec le bon nom deja present ailleurs.
let e = vf(N('N580', ['N580 - Route d\'Avignon', 'Route d\'Avignon']));
verifier('cas réel N580 — 1 seul écart', e.length, 1);
verifier('cas réel — signalé sur l\'ALTERNATIF', /\(alt\)/.test(e[0].champ), true);
verifier('cas réel — reconnu comme DOUBLON à supprimer',
         /doublon/i.test(e[0].apres), true);
lignes.push('  ~~    message : « ' + e[0].apres + ' »');

// Composite en alternatif SANS le bon nom ailleurs : on ne parle pas de doublon.
e = vf(N('N580', ['N580 - Route d\'Avignon']));
verifier('sans le bon nom ailleurs — 1 écart', e.length, 1);
verifier('sans le bon nom ailleurs — PAS présenté comme un doublon',
         /doublon/i.test(e[0].apres), false);
verifier('et le remède nomme le nom attendu',
         /Route d&#39;Avignon|Route d'Avignon/.test(e[0].apres), true);

// Composite en PRINCIPAL : corrigeable, le message est different.
e = vf(N('D980 - Route de Bagnols', []));
verifier('composite en PRINCIPAL — 1 écart', e.length, 1);
verifier('principal — pas de mention « (alt) »', /\(alt\)/.test(e[0].champ), false);
verifier('principal — le remède donne le nom seul',
         /^Route de Bagnols/.test(e[0].apres), true);
lignes.push('  ~~    message : « ' + e[0].apres + ' »');

// Rien a signaler quand le nommage est propre.
verifier('nommage propre — aucun écart',
         vf(N('N580', ['Route d\'Avignon'])).length, 0);

// Le controle est DECOCHABLE, comme les autres.
const sans = monter({ nomComposite: false, abreviations: false, contractions: false,
                      majuscule: false, fonctionDirection: false });
verifier('contrôle décoché — aucun écart',
         sans(N('N580', ['N580 - Route d\'Avignon'])).length, 0);

// Il est declare dans le referentiel (donc affiche comme case a cocher).
verifier('déclaré dans REF.controles',
         /cle:\s*'nomComposite',\s*portee:\s*'forme'/.test(src), true);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
