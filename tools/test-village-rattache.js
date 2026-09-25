/**
 * VILLAGE RATTACHE : la ville proposee dans un polygone « rattache ».
 *
 * ⚠️ ORIGINE : audit du 25/09/2026 (A3). Un segment qui ne porte que le nom de la COMMUNE
 * (« Coursan ») etait lu comme le nom du village : cible « Coursan (Coursan) », « Rimini, Rimini »
 * en Italie, sans doute signale — et le ⚡ l'ecrivait. En deux passes (sans ville, puis la
 * commune), on y arrivait tout seul.
 *
 * `villeAgglo` et les formats nationaux (reVillageDansVille, formatVillage) sont EXTRAITS du
 * userscript. Temoin : la version d'avant le correctif doit produire « Coursan (Coursan) ».
 *
 * Usage : node tools/test-village-rattache.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'WME-Naming-Auditor.user.js', 'utf8');

function extraire(s, nom) {
  const i = s.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let prof = 0, j = s.indexOf('{', i);
  for (; j < s.length; j++) {
    if (s[j] === '{') prof++;
    else if (s[j] === '}') { prof--; if (!prof) break; }
  }
  return s.slice(i, j + 1);
}
// Les deux referentiels, lus dans le script (FR puis IT, dans l'ordre du fichier).
const formats = [...src.matchAll(/reVillageDansVille: (\/.+\/),\s*\n?\s*formatVillage: (\(village, commune\) => [^\n]+),/g)]
  .map(m => ({ reVillageDansVille: eval(m[1]), formatVillage: eval(m[2]) }));
if (formats.length !== 2) throw new Error('formats nationaux attendus : 2, trouves : ' + formats.length);
const [FR, IT] = formats;
const norm = src.match(/const normSansAccent = ([^;]+);/)[1];
const charger = (s, REF) => new Function('REF', 'const normSansAccent = ' + norm + ';\n' + extraire(s, 'villeAgglo') + '\nreturn villeAgglo;')(REF);

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok   ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n         attendu ' + JSON.stringify(attendu) + '\n         obtenu  ' + JSON.stringify(obtenu)); }
}
const nam = ville => ({ primary: { name: 'Rue X', cityName: ville }, alts: [] });
const RAT = { rattache: true };

console.log('\n=== France ===');
let va = charger(src, FR);
verifier('village porte : « Les Ayguades » -> « Les Ayguades (Gruissan) »',
         va(nam('Les Ayguades'), RAT, 'Gruissan'), { ville: 'Les Ayguades (Gruissan)', doute: null });
verifier('deja au bon format : inchange', va(nam('Les Ayguades (Gruissan)'), RAT, 'Gruissan').ville, 'Les Ayguades (Gruissan)');
let r = va(nam('Coursan'), RAT, 'Coursan');
verifier('le segment porte la COMMUNE : cible = la commune, PAS « Coursan (Coursan) »', r.ville, 'Coursan');
verifier('… et un doute est signale', !!r.doute, true);
verifier('deja abime en « Coursan (Coursan) » : ramene a la commune, avec doute',
         [va(nam('Coursan (Coursan)'), RAT, 'Coursan').ville, !!va(nam('Coursan (Coursan)'), RAT, 'Coursan').doute], ['Coursan', true]);
verifier('accents et casse ignores (« gruissan » sur Gruissan)', va(nam('gruissan'), RAT, 'Gruissan').ville, 'Gruissan');
verifier('aucune ville sur le segment : doute (inchange)', !!va(nam(''), RAT, 'Gruissan').doute, true);
verifier('polygone non rattache : la commune, sans doute', va(nam('Coursan'), { rattache: false }, 'Coursan'), { ville: 'Coursan', doute: null });

console.log('\n=== Italie ===');
va = charger(src, IT);
verifier('frazione portee : « Miramare » -> « Miramare, Rimini »', va(nam('Miramare'), RAT, 'Rimini').ville, 'Miramare, Rimini');
r = va(nam('Rimini'), RAT, 'Rimini');
verifier('le segment porte le COMUNE : cible = Rimini, PAS « Rimini, Rimini »', [r.ville, !!r.doute], ['Rimini', true]);

console.log('\n=== Temoin ===');
const avant = src.replace(/\n\s*\/\/ ⚠️⚠️ AUDIT DU 25\/09\/2026 : un segment qui ne porte que[\s\S]*?\n    }\n/, '\n');
if (avant === src) { ko++; console.log('  ECHEC temoin : le correctif n\'a pas ete trouve pour le retirer'); }
else verifier('TEMOIN : sans le correctif, la cible devient « Coursan (Coursan) »',
              charger(avant, FR)(nam('Coursan'), RAT, 'Coursan').ville, 'Coursan (Coursan)');

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
