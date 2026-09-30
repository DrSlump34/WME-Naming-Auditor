/**
 * AUTOROUTE RECONNUE A SON TYPE (audit du 25/09/2026, A9).
 *
 * Un troncon de type Autoroute (3) nomme « N165 » passait par les cas H : la cible reclamait
 * « N165 / commune » en alternatif, et le ⚡ l'ajoutait — une ville que la regle interdit sur une
 * autoroute. Attendu : cas A, aucune ville nulle part, des que le TYPE est Autoroute.
 *
 * `expectedNaming` est EXTRAITE du userscript. Temoin : sans `opts.autoroute`, retour au cas H.
 *
 * Usage : node tools/test-autoroute-type.js [fichier.user.js]
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
const COMMUNE = 'Montpellier';
const nam = (p, ville, alts) => ({
  primary: { name: p, cityName: ville || '', signText: '', signType: null }, primaryId: 1,
  alts: (alts || []).map(a => ({ name: a[0], cityName: a[1] || '', signText: '', signType: null }))
});
const vue = r => [r.cas, r.primary.name + ' / ' + r.primary.cityName, r.alts.map(a => a.name + ' / ' + a.cityName)];
const TYPE_A = { autoroute: true };

const cible = charger(src);
console.log('\n=== Type Autoroute ===');
verifier('« N165 » type Autoroute, hors agglo : cas A, sans ville',
         vue(cible(nam('N165', ''), null, COMMUNE, TYPE_A)), ['A', 'N165 / ', []]);
verifier('… meme en agglomeration : aucune ville',
         vue(cible(nam('N165', COMMUNE), { rattache: false }, COMMUNE, TYPE_A)).slice(0, 2), ['A', 'N165 / ']);
verifier('… et ses alternatifs perdent leur ville',
         vue(cible(nam('N165', '', [['E60', COMMUNE]]), null, COMMUNE, TYPE_A))[2], ['E60 / ']);
verifier('type Autoroute SANS numero : pas de cas A invente',
         cible(nam('', ''), null, COMMUNE, TYPE_A).cas !== 'A', true);

console.log('\n=== Inchange ===');
verifier('« A9 » reconnu a son nom, sans le type : cas A', cible(nam('A9', ''), null, COMMUNE).cas, 'A');
verifier('« N165 » de type ordinaire : cas H (H6)', cible(nam('N165', ''), null, COMMUNE).cas, 'H6');
verifier('la cible recoit bien le type depuis l\'analyse',
         // v2.50.10 : la cible se calcule par cote (`cibleDuCote(ea)`), voir test-sans-panneau.js.
         /REF\.etatCible\(nam, ea \? loc\.agglo : null, communeActive\.nom,\s*\{ autoroute: seg\.roadType === REF\.typeAutoroute \}\)/.test(src), true);

console.log('\n=== Temoin ===');
const mutant = src.replace('((opts && opts.autoroute) ? routes[0] || null : null)', 'null');
if (mutant === src) { ko++; console.log('  ECHEC temoin introuvable'); }
else verifier('TEMOIN : sans le type, « N165 » Autoroute recoit une ville en alternatif',
              vue(charger(mutant)(nam('N165', ''), null, COMMUNE, TYPE_A))[2], ['N165 / ' + COMMUNE]);

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
