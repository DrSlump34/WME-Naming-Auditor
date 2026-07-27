/**
 * Tests de la SELECTION RAPIDE PAR ZONE DECLAREE (v2.27.05).
 *
 * ⭐ L'IDEE EST DE GLENAN56 (27/07/2026) : « Ça pourrait etre une idee pour
 * completer Naming Auditor avec deux boutons rapides : Selection en ville /
 * Selection hors ville, et qui feraient automatiquement le filtrage que fait
 * Road Selector mais sans avoir a saisir le nom de la ville qu'il connaitrait
 * (a verifier aussi avec les villes de...) ».
 *
 * ⭐ CE QUE CA MESURE : la regle FR lue A L'ENVERS. En agglomeration la ville
 * est portee par le nom principal, hors agglomeration non — le principal est
 * donc une DECLARATION de zone. La confronter au terrain (le polygone d'agglo)
 * montre d'un coup d'oeil « les segments hors ville mais edites comme etant en
 * ville, et les segments en ville qui ne sont pas selectionnes, donc
 * possiblement oublies ».
 *
 * ⚠️ Son « (a verifier aussi avec les villes de...) » est le cas des VILLAGES
 * RATTACHES : « Le Village (Caraman) » designe bien Caraman. Sans ce cas, tous
 * les segments d'un village rattache seraient comptes hors ville — a l'envers.
 *
 * ⚠️ Fonctions EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-selection-zone.js
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
  relire('normSansAccent'),
  extraire('villeDeCetteCommune'), extraire('declarationDeZone'),
  'return { villeDeCetteCommune, declarationDeZone };'
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

const e = (n, v) => ({ name: n || '', cityName: v || '', signText: '', signType: null });
const nam = (p, a) => ({ primary: p, primaryId: 1, alts: a || [] });
const zone = (p, a) => api.declarationDeZone(nam(p, a), 'Caraman');

console.log('\n=== Selection rapide par zone declaree ===\n');

// ---------------------------------------------------------------------------
// 1. LA VILLE DESIGNE-T-ELLE CETTE COMMUNE ?
// ---------------------------------------------------------------------------
verifier('1. le nom exact', api.villeDeCetteCommune('Caraman', 'Caraman'), true);
verifier('2. ⭐ village rattache « Village (Commune) » — son « villes de... »',
  api.villeDeCetteCommune('Le Village (Caraman)', 'Caraman'), true);
verifier('3. village rattache, espaces irreguliers',
  api.villeDeCetteCommune('Les Ayguades  ( Gruissan )', 'Gruissan'), true);
verifier('4. ⚠️ accents : WME et l\'INSEE ne s\'accordent pas',
  api.villeDeCetteCommune('Saint-Genies-de-Comolas', 'Saint-Geniès-de-Comolas'), true);
verifier('5. casse indifferente', api.villeDeCetteCommune('CARAMAN', 'Caraman'), true);
verifier('6. une commune VOISINE n\'est pas cette commune',
  api.villeDeCetteCommune('Auriac-sur-Vendinelle', 'Caraman'), false);
verifier('7. ⚠️ un village rattache d\'UNE AUTRE commune ne compte pas',
  api.villeDeCetteCommune('Le Village (Auriac)', 'Caraman'), false);
verifier('8. ville vide', api.villeDeCetteCommune('', 'Caraman'), false);
verifier('9. commune vide', api.villeDeCetteCommune('Caraman', ''), false);
verifier('10. parenthese sans fermeture : pas un format rattache',
  api.villeDeCetteCommune('Le Village (Caraman', 'Caraman'), false);

// ---------------------------------------------------------------------------
// 2. CE QUE LE SEGMENT DECLARE
// ---------------------------------------------------------------------------
verifier('11. ville de la commune en principal ⇒ se declare EN ville',
  zone(e('Rue des Ecoles', 'Caraman')), 'ville');
verifier('12. aucune ville en principal ⇒ se declare HORS ville',
  zone(e('D18', '')), 'horsVille');
verifier('13. sans nom NI ville ⇒ hors ville (c\'est bien ce qu\'il declare)',
  zone(e('', '')), 'horsVille');
verifier('14. sans nom mais AVEC la ville ⇒ en ville — le cas signale par Glenan',
  zone(e('', 'Caraman')), 'ville');
verifier('15. village rattache ⇒ en ville',
  zone(e('Rue du Puits', 'Le Village (Caraman)')), 'ville');
verifier('16. ville d\'une commune voisine ⇒ ni l\'un ni l\'autre',
  zone(e('Rue des Ecoles', 'Auriac-sur-Vendinelle')), 'autreVille');

// ⭐ On ne regarde QUE le principal : hors agglo, une ville en ALTERNATIF est
// la cible attendue — la compter ferait basculer en « ville » tous les
// segments correctement nommes hors agglomeration.
verifier('17. ⭐ une ville en ALTERNATIF ne declare RIEN',
  zone(e('D18', ''), [e('D18', 'Caraman')]), 'horsVille');
verifier('18. et le principal fait foi meme si l\'alt dit autre chose',
  zone(e('Rue des Ecoles', 'Caraman'), [e('Rue des Ecoles', '')]), 'ville');
verifier('19. espaces seuls ne sont pas une ville', zone(e('D18', '   ')), 'horsVille');
verifier('20. nommage absent : pas d\'exception',
  api.declarationDeZone(null, 'Caraman'), null);

// ---------------------------------------------------------------------------
// 3. VERROUS DE CONTRAT — le branchement
// ---------------------------------------------------------------------------
verifier('21. la selection ne porte que sur les segments CHARGES',
  /sdk\.DataModel\.Segments\.getAll\(\)/.test(extraire('selectionnerParZone')), true);
verifier('22. ⚠️ et elle filtre par emprise (getAll rend l\'ancienne vue)',
  /getMapExtent/.test(extraire('selectionnerParZone')), true);
verifier('23. les segments de la commune voisine sont ecartes',
  /partCommune < 1 - options\.seuil/.test(extraire('selectionnerParZone')), true);
verifier('24. ⭐ le compte rendu dit toujours sur quoi la selection a porte',
  /direSelectionZone\(zone, retenus\.length, vus, horsCommune\.length\)/
    .test(extraire('selectionnerParZone')), true);
verifier('25. le cas ZERO a sa propre branche',
  /if \(!vus\)/.test(extraire('direSelectionZone')) &&
  /else if \(!n\)/.test(extraire('direSelectionZone')), true);
verifier('26. un bouton ferme DIT pourquoi',
  /Choisis d\\'abord une commune/.test(extraire('majBoutonsZone')), true);
verifier('27. les deux boutons existent dans l\'interface',
  /id="agn-sel-ville"/.test(src) && /id="agn-sel-hors"/.test(src), true);
verifier('28. et ils sont branches',
  /selectionnerParZone\('ville'\)/.test(src) &&
  /selectionnerParZone\('horsVille'\)/.test(src), true);
// L'extracteur lit-il encore quelque chose ? (lecon de la v2.26)
verifier('29. l\'extracteur a bien lu declarationDeZone',
  /cityName/.test(extraire('declarationDeZone')), true);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
