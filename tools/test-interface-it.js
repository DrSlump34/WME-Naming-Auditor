/**
 * L'INTERFACE ENTIERE EN ITALIEN — le garde-fou du releve integral (v2.50.10).
 *
 * ⚠️⚠️ POURQUOI CE BANC EXISTE : l'italien a ete complete par ZONES (zone de
 * trace, aide, reports…), et chaque zone oubliee s'est decouverte par hasard —
 * le 30/09/2026, les reports (145 noeuds sur 174 en francais), puis tout le
 * reste (barres de progression, contours, boites, corrections, bandeaux).
 * L'auteur : « On va pas iterer 15 fois sur les traductions. On gere tout. »
 *
 * ⭐ Ce banc part du SOURCE ENTIER (`tools/releve-textes.js`) :
 *   1. tout morceau francais affichable doit etre couvert par le dictionnaire ou
 *      un motif, OU figurer au tri (`tools/fixtures/releve-textes-tri.json`) —
 *      jamais affiche (raison), ou morceau d'un noeud plus grand (le noeud) ;
 *   2. chaque noeud cite par le tri se retraduit ;
 *   3. les 330 noeuds recomposes lors du releve (`noeuds-interface-it-…json`)
 *      ressortent en italien, sans « $1 » brut.
 * ⇒ UN TEXTE FRANCAIS AJOUTE SANS TRADUCTION FAIT ECHOUER CE BANC.
 *
 * Usage : node tools/test-interface-it.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RACINE, 'WME-Naming-Auditor.user.js'), 'utf8');
const tri = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'releve-textes-tri.json'), 'utf8'));
const temoins = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'noeuds-interface-it-2026-09-30.json'), 'utf8')).noeuds;
const { nonCouverts } = require('./releve-textes.js');

let ok = 0, ko = 0;
function verifier(t, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + t); }
  else { ko++; console.log('  ECHEC ' + t + '\n          attendu ' + JSON.stringify(attendu) +
    '\n          obtenu  ' + JSON.stringify(obtenu).slice(0, 1500)); }
}
function bloc(debut) {
  const i = src.indexOf(debut);
  let prof = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') prof++; else if (src[j] === '}') { prof--; if (!prof) break; } }
  return src.slice(i, j + 1);
}
const iT = src.indexOf('const TEXTES = {');
const finM = src.indexOf('\n  };', src.indexOf('const MOTIFS = {')) + 5;
const api = new Function('LANGUE', src.slice(iT, finM) + '\n' + bloc('function traduireMotif(') +
  '\nreturn { TEXTES, traduireMotif };')('it');
const d = api.TEXTES.it;
const norm = x => x.replace(/\s+/g, ' ').trim();
const trad = x => d[x] || d[norm(x)] || api.traduireMotif(norm(x));

console.log('\n=== Le relevé intégral du source ===\n');
verifier('1. TEMOIN : le relevé lit bien le source (plus de 1 000 morceaux vus)',
  require('./releve-textes.js').releve.length > 1000, true);
const connus = new Set([...Object.keys(tri.horsAffichage), ...Object.keys(tri.couvertAuNoeud)]);
const nouveaux = [...new Set(nonCouverts.filter(r => !connus.has(r.t)).map(r => r.l + ' ' + r.t))];
verifier('2. ⭐⭐⭐ aucun morceau français affichable ni traduit ni trié (' + nonCouverts.length +
  ' non couverts, tous au tri)', nouveaux, []);

console.log('\n=== Le tri : chaque morceau « couvert au nœud » se retraduit dans son nœud ===\n');
const noeudsTri = Object.entries(tri.couvertAuNoeud).filter(([, n]) => !trad(n)).map(([m, n]) => m + '  ⇒  ' + n);
verifier('3. ' + Object.keys(tri.couvertAuNoeud).length + ' nœuds du tri : tous traduits', noeudsTri, []);

console.log('\n=== Les ' + temoins.length + ' nœuds recomposés lors du relevé ===\n');
verifier('4. ⭐⭐ tous ressortent en italien', temoins.filter(n => !trad(n)), []);
verifier('5. aucun « $1 » resté brut', temoins.map(trad).filter(v => v && /\$\d/.test(v)), []);
// Mots francais sans equivalent italien homographe, hors noms cites entre guillemets.
const RE_FR = /\b(les|des|une|avec|dans|pour|cette|ces|leur|déjà|être|été|réessaie|zoome|coche|charge les|télécharge|départements?|contours?)\b/i;
// Les DONNEES des nœuds (noms de rue, de commune) restent en français : on les retire avant de juger.
const DONNEES = /Rue des Écoles|Saint-Laurent-des-Arbres|«[^»]*»/g;
const restes = temoins.filter(n => { const t = trad(n); return t && RE_FR.test(t.replace(DONNEES, '')); })
  .filter(n => !/Error|Failed|Unexpected|stateId|segment is locked/.test(n));
verifier('6. aucune traduction ne garde un morceau de phrase française', restes, []);

console.log('\n' + ok + ' ok, ' + ko + ' echec(s)\n');
process.exit(ko ? 1 : 0);
