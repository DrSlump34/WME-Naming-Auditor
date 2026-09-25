/**
 * NOM COMPOSITE SEUL : « D980 - Route de Bagnols » est le seul nom du segment.
 *
 * ⚠️ ORIGINE : audit du 25/09/2026 (A2). `expectedNaming` ramenait le composite a son nom
 * seul et JETAIT le numero : hors agglomeration la cible devenait « Route de Bagnols » sans
 * ville en principal (un nom de rue la ou la regle veut le numero), et en agglomeration le
 * numero disparaissait des alternatifs. Le ⚡ ecrivait cette cible : la D980 quittait le
 * segment.
 *
 * Attendu : le composite se range comme s'il etait deja separe — H9 hors agglomeration
 * (numero en principal sans ville, nom et numero en alternatif avec la commune), C1 en
 * agglomeration (nom en principal, numero en alternatif, avec la ville).
 *
 * ⚠️ Fonctions EXTRAITES du userscript. Temoin : l'ancien `nettoyer` doit perdre le numero.
 *
 * Usage : node tools/test-composite-seul.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'WME-Naming-Auditor.user.js', 'utf8');

function extraire(s, nom) {
  const i = s.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let par = 0, j = s.indexOf('(', i);
  for (; j < s.length; j++) {
    if (s[j] === '(') par++;
    else if (s[j] === ')') { par--; if (!par) { j++; break; } }
  }
  let prof = 0; j = s.indexOf('{', j);
  for (; j < s.length; j++) {
    if (s[j] === '{') prof++;
    else if (s[j] === '}') { prof--; if (!prof) break; }
  }
  return s.slice(i, j + 1);
}
function relire(nom) {
  const m = src.match(new RegExp('const\\s+' + nom + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('constante introuvable : ' + nom);
  return 'const ' + nom + ' = ' + m[1] + ';';
}
const charger = s => new Function([
  relire('RE_ROUTE'), relire('RE_COMMUNALE'), relire('RE_AUTOROUTE'),
  relire('RE_NOM_COMPOSITE'), relire('normSansAccent'),
  'const REF = { reRoute: RE_ROUTE, reCommunale: RE_COMMUNALE,' +
  '  reAutoroute: RE_AUTOROUTE, reNomComposite: RE_NOM_COMPOSITE };',
  relire('isRoute'), relire('isCommunale'),
  'const options = { altEnTrop: false };',
  extraire(s, 'villeAgglo'), extraire(s, 'expectedNaming'),
  'return expectedNaming;'
].join('\n'))();

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
const COMMUNE = 'Bagnols-sur-Cèze';
const nam = (p, ville, alts) => ({
  primary: { name: p, cityName: ville || '', signText: '', signType: null }, primaryId: 1,
  alts: (alts || []).map(a => ({ name: a[0], cityName: a[1] || '', signText: '', signType: null }))
});
const vue = r => [r.cas, r.primary.name + ' / ' + r.primary.cityName, r.alts.map(a => a.name + ' / ' + a.cityName)];
const AGGLO = { rattache: false };

let en = charger(src);
console.log('\n=== Hors agglomeration ===');
verifier('composite seul -> H9 : D980 en principal, nom et numero en alternatif avec la commune',
         vue(en(nam('D980 - Route de Bagnols', ''), null, COMMUNE)),
         ['H9', 'D980 / ', ['D980 / ' + COMMUNE, 'Route de Bagnols / ' + COMMUNE]]);
verifier('« D 62 — Chemin des Vignes » : le numero est recolle (D62)',
         vue(en(nam('D 62 — Chemin des Vignes', ''), null, COMMUNE))[1], 'D62 / ');
verifier('composite + le meme numero deja en alternatif : pas de doute « plusieurs numeros »',
         en(nam('D980 - Route de Bagnols', '', [['D980', COMMUNE]]), null, COMMUNE).doute, null);

verifier('H6 CONFORME (D980 sans ville + D980 / commune) : aucun doute',
         en(nam('D980', '', [['D980', COMMUNE]]), null, COMMUNE).doute, null);
verifier('H7 CONFORME (nom sans ville + nom / commune) : aucun doute',
         en(nam('Route de Bagnols', '', [['Route de Bagnols', COMMUNE]]), null, COMMUNE).doute, null);
verifier('deux numeros DIFFERENTS : le doute reste',
         en(nam('D980', '', [['D6', COMMUNE]]), null, COMMUNE).doute, 'plusieurs numéros de route sur le segment');

console.log('\n=== En agglomeration ===');
verifier('composite seul -> C1 : nom en principal, numero en alternatif, avec la ville',
         vue(en(nam('D980 - Route de Bagnols', COMMUNE), AGGLO, COMMUNE)),
         ['C1', 'Route de Bagnols / ' + COMMUNE, ['D980 / ' + COMMUNE]]);

console.log('\n=== Inchange ===');
verifier('le cas reel N580 (composite en doublon du nom) : un seul nom, un seul numero',
         en(nam('N580', '', [['N580 - Route d\'Avignon'], ['Route d\'Avignon']]), null, COMMUNE).doute, null);

console.log('\n=== Temoin ===');
const avant = src.replace(/    \/\/ ⚠️⚠️ AUDIT DU 25\/09\/2026 \(A2\)[\s\S]*?\n    };\r?\n/,
  "    const nettoyer = e => { const m = (e.name || '').match(REF.reNomComposite);\n" +
  "      return m ? { name: m[2].trim(), cityName: e.cityName } : e; };\n")
  .replace('.flatMap(nettoyer)', '.map(nettoyer)');
if (avant === src) { ko++; console.log('  ECHEC temoin : le correctif n\'a pas ete trouve'); }
else verifier('TEMOIN : l\'ancien nettoyage perd la D980 (cible H7)',
              vue(charger(avant)(nam('D980 - Route de Bagnols', ''), null, COMMUNE)).slice(0, 2),
              ['H7', 'Route de Bagnols / ']);
const avantDoute = src.replace(/libelles\(routes\) > 1/, 'routes.length > 1');
verifier('TEMOIN : compte en entrees, le H6 conforme leve « plusieurs numeros »',
         charger(avantDoute)(nam('D980', '', [['D980', COMMUNE]]), null, COMMUNE).doute,
         'plusieurs numéros de route sur le segment');

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
