/**
 * COMMUNES VOISINES : meme resultat, en temps borne (audit du 25/09/2026, P1).
 *
 * L'ancienne recherche parcourait toute la base pour chaque nom de chaque segment, en renormalisant
 * chaque commune : 9 s pour 4 113 communes, 25 s pour 10 000 (mesure sous node). `communeVoisineDeNom`
 * passe desormais par un index des noms normalises.
 *
 * Verifie, sur les fonctions EXTRAITES du script :
 *  - l'EQUIVALENCE avec l'ancienne recherche (recopiee ICI comme etalon, sur 10 000 communes dont des
 *    homonymes, la commune active comprise) ;
 *  - un PLAFOND de temps : 50 000 recherches sur 10 000 communes en moins d'une seconde ;
 *  - que l'index se RECONSTRUIT quand la liste grandit (departement charge en cours de route).
 * Temoin : sans le controle de taille, une commune ajoutee apres coup reste introuvable.
 *
 * Usage : node tools/test-voisines-perf.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'WME-Naming-Auditor.user.js', 'utf8');
const fn = (s, nom) => { const a = s.indexOf('function ' + nom + '('); if (a < 0) throw new Error(nom);
  let n = 0, b = s.indexOf('{', a); for (; b < s.length; b++) { if (s[b] === '{') n++; else if (s[b] === '}') { n--; if (!n) break; } }
  return s.slice(a, b + 1); };
const norm = src.match(/const\s+normSansAccent\s*=\s*([^;]+);/)[1];
const monter = s => new Function('const normSansAccent = ' + norm + ';\nconst _indexNoms = new WeakMap();\n' +
  fn(s, 'indexCommunesParNom') + '\n' + fn(s, 'communeVoisineDeNom') + '\nreturn { communeVoisineDeNom, normSansAccent };')();

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
const api = monter(src);
// L'etalon : la recherche de la 2.49.04, telle quelle.
const ancienne = (nom, liste, codeActif) => {
  const brut = String(nom || '').trim();
  if (!brut || brut.includes('(')) return null;
  const n = api.normSansAccent(brut);
  return (liste || []).find(c => c && c.code !== codeActif && api.normSansAccent(c.nom) === n) || null;
};

// 10 000 communes, dont des homonymes (un nom sur 7 revient dans un autre departement).
const liste = [];
for (let i = 0; i < 10000; i++) {
  const base = 'Saint-Étienne-' + (i % 7 === 0 ? 'du-Bois' : 'de-' + i);
  liste.push({ code: String(10000 + i), nom: i % 2 ? base : base.toUpperCase() });
}
const noms = ['Saint-Étienne-du-Bois', 'saint-etienne-de-42', 'SAINT-ÉTIENNE-DE-9999', 'Inconnue', '', 'Les Ayguades (Gruissan)'];
const actifs = ['10000', '10007', '10042', '99999'];

console.log('\n=== Equivalence avec l\'ancienne recherche ===');
let ecarts = 0;
for (const n of noms) for (const a of actifs) {
  const x = api.communeVoisineDeNom(n, liste, a), y = ancienne(n, liste, a);
  if ((x && x.code) !== (y && y.code)) ecarts++;
}
verifier('memes reponses sur ' + noms.length * actifs.length + ' cas (homonymes, casse, accents, commune active, village rattache)', ecarts, 0);

console.log('\n=== Plafond de temps ===');
const t0 = Date.now();
for (let k = 0; k < 50000; k++) api.communeVoisineDeNom('Saint-Étienne-de-' + (k % 10000), liste, '10000');
const duree = Date.now() - t0;
verifier('50 000 recherches sur 10 000 communes en moins d\'1 s (mesure : ' + duree + ' ms)', duree < 1000, true);

console.log('\n=== La liste grandit ===');
const l2 = liste.slice(0, 100);
api.communeVoisineDeNom('x', l2, '0');                       // l'index est construit
l2.push({ code: '77777', nom: 'Nouvelle-Commune' });
verifier('une commune ajoutee apres coup est trouvee', (api.communeVoisineDeNom('Nouvelle-Commune', l2, '0') || {}).code, '77777');

console.log('\n=== Temoin ===');
const mutant = src.replace('if (memo && memo.n === liste.length) return memo.index;', 'if (memo) return memo.index;');
if (mutant === src) { ko++; console.log('  ECHEC temoin introuvable'); }
else {
  const m = monter(mutant), l3 = liste.slice(0, 100);
  m.communeVoisineDeNom('x', l3, '0');
  l3.push({ code: '77777', nom: 'Nouvelle-Commune' });
  verifier('TEMOIN : sans le controle de taille, la nouvelle commune est introuvable',
           m.communeVoisineDeNom('Nouvelle-Commune', l3, '0'), null);
}

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
