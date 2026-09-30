/**
 * L'ONGLET SEGMENTS EN ITALIEN : groupes, reports et bilan (v2.50.10).
 *
 * ⚠️⚠️ POURQUOI CE BANC EXISTE : jusqu'a la 2.50.09, un editeur italien lisait
 * TOUT le contenu des reports en francais. La zone des resultats est bien
 * observee par `observerTraduction`, mais le dictionnaire n'en avait aucune cle :
 * sur 47 noeuds de texte recomposes d'apres les gabarits (report, en-tetes de
 * groupe, bilan), 46 sortaient en francais. Seule l'infobulle du seuil etait
 * traduite — c'est elle qui a servi de TEMOIN au releve.
 *
 * ⭐ Les noeuds ci-dessous sont ceux que produisent les gabarits de
 * `renderResults` : chaque `<b>` ou `<span>` COUPE le texte en noeuds, et
 * `traduireDOM` cherche chaque noeud entier (dictionnaire, puis motifs ancres).
 * Les donnees (noms de voies, communes, nombres) sont realistes.
 *
 * ⚠️ HORS PERIMETRE, et dit : les onglets POI et Numerotation, et les bandeaux
 *    sous le bilan. Ils ne sont pas couverts ici.
 *
 * ⚠️ Fonctions EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-reports-it.js
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

let ok = 0, ko = 0;
function verifier(t, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + t); }
  else { ko++; console.log('  ECHEC ' + t + '\n          attendu ' + JSON.stringify(attendu) +
    '\n          obtenu  ' + JSON.stringify(obtenu)); }
}

function bloc(debut) {
  const i = src.indexOf(debut);
  if (i < 0) throw new Error('introuvable : ' + debut);
  let prof = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, j + 1);
}
const iT = src.indexOf('const TEXTES = {');
const finM = src.indexOf('\n  };', src.indexOf('const MOTIFS = {')) + 5;
const api = new Function('LANGUE', src.slice(iT, finM) + '\n' + bloc('function traduireMotif(') +
  '\nreturn { TEXTES, traduireMotif };')('it');
const d = api.TEXTES.it;
const norm = x => x.replace(/\s+/g, ' ').trim();
const trad = x => d[x] || d[norm(x)] || api.traduireMotif(norm(x));

// Le releve : un noeud de texte par ligne, tel que l'ecran le montre (bords rognes).
const NOEUDS = [
  // --- en-tetes de groupe et barre ---
  'En agglomération (C / R)', 'Hors agglomération (H)', 'À couper — entrée agglo',
  'À couper — limite communale', 'Cartouche seul (nommage bon)', 'Rédaction du nom seule',
  'Bretelle / voie ferrée / rocade', 'Giratoires', 'tout déplier',
  'Déplie ou replie tous les groupes de résultats', '⚡ corriger',
  'Appliquer les corrections automatisables de ce groupe (celles qui portent un doute se font une par une)',
  // --- un report ---
  'Appliquer la correction (sans enregistrer)', 'Marquer comme traité',
  'Chemin de terre · #440224630', 'Rue ·', 'Chemin piétonnier · #12 ·', '3 segments',
  'Verrouillés au-dessus de ton niveau : non modifiables',
  'Tronçons éloignés : la carte se pose sur le plus long', 'éparpillés',
  ': ‹sans nom› / ‹sans ville› → ‹sans nom› / Ancey',
  ': Rue des Écoles / ‹sans ville› → Rue des Écoles / Ancey',
  ': 40 % dans l\'agglomération → à couper au panneau d\'entrée d\'agglomération (EB10)',
  ': 55 % dans Ancey → à couper sur la limite communale',
  ': 55 % dans Ancey · longe la limite sur 30 % → à couper là où la voie quitte la limite communale',
  ': Rue des Écoles sans cartouche → poser le cartouche D5 sur le nom principal',
  ': Av. de la Gare → écrire le type de voie en toutes lettres',
  ': A6a Paris → forme attendue : « A6a: Paris », « Sortie 18: Valensole » — ou « > Orsay » quand aucun numéro ne s\'applique',
  '⚠ déborde de 45 m sur la commune voisine',
  '⚠ mord de 30 m sur l\'agglomération',
  '⚠ déborde de 30 m hors de l\'agglomération',
  '⚠ à cheval sur l\'agglomération sans panneau d\'entrée (55 % dedans) : la ville est laissée à ton appréciation',
  '⚠ plusieurs numéros de route sur le segment',
  '⚠ plusieurs noms de rue — noms alternatifs réels ?',
  '⚠ village rattaché : aucune ville sur le segment, impossible d\'en déduire le nom du village',
  '⚠ plusieurs noms possibles en principal (Rue A, Rue B) : le choix sera demandé à la correction',
  '⚠ adressé à « Montfaucon » — commune voisine, alors que ce segment est dans Saint-Geniès',
  '⚠ longe la limite avec « Montfaucon » : cette voie dessert les deux communes, son adresse est conservée en alternatif',
  '⚠ longe la limite avec « Montfaucon », en agglomération de ce côté-là : c\'est cette commune qui porte le nom principal. Le script ne l\'écrit pas à ta place — vérifie-le et pose-le à la main ; il ne touche pas au principal. ; déborde de 12 m sur la commune voisine',
  '⚠ identifiée comme rocade d\'après son nom (aucun cartouche Rocade posé)',
  '⚠ s\'applique à toute la voie « Rue X » (3 segments) : le cartouche est porté par la rue, pas par un segment',
  '⚠ déborde de 45 m sur la commune voisine ; mord de 30 m sur l\'agglomération',
  // --- bilan ---
  'segment(s) en écart sur', 'analyses à Ancey, regroupés en', 'analyses à Ancey.', 'report(s).',
  '2 en agglo · 5 hors agglo · 0 à couper (agglo) · 1 à couper (commune) ·',
  '2 en agglo · 5 hors agglo · 0 à couper (agglo) · 1 à couper (commune) · 2 débordent légèrement.',
  '3 sans panneau, ville laissée à l\'éditeur', '2 mitoyenne(s) conformes',
  '1 à cheval sans rien à couper', '1 autoroute(s) sans coupe',
  '· 2 débordent légèrement · 1 cartouche(s) à poser · 3 voie(s) à règle propre · 2 giratoire(s).',
  'Ignorés : 3 hors commune, 2 sans adressage', ', 1 règles propres.',
  'Ignorés : 3 hors commune, 2 sans adressage, 1 règles propres.',
  '(dont', 'signalé(s) pour une ville en trop)',
  'Chemins de terre, sentiers, chemins piétonniers, escaliers, voies privées et parkings à cheval sur le polygone d\'agglomération. Ils ne portent pas de panneau d\'entrée d\'agglomération : la limite n\'y est que le tracé du polygone. Ils ne sont pas à couper, et leur ville est laissée à ton appréciation : le script ne propose ni de l\'ajouter ni de la retirer.',
  'Autoroutes à cheval sur une limite communale ou d\'agglomération : elles ne portent aucune ville, ni en principal ni en alternatif. Les couper ne changerait rien à leur nommage. Leur nom reste audité.'
];

console.log('\n=== Onglet Segments : chaque noeud ressort en italien ===\n');
verifier('1. TEMOIN : l\'infobulle du seuil, deja traduite avant la 2.50.10, ressort bien',
  !!trad('Seuil de rattachement'), true);
const manquants = NOEUDS.filter(n => !trad(n));
verifier('2. ⭐⭐ ' + NOEUDS.length + ' noeuds : aucun ne reste sans traduction', manquants, []);
const brut = NOEUDS.map(trad).filter(v => v && /\$\d/.test(v));
verifier('3. aucun « $1 » resté brut', brut, []);
// Un mot francais caracteristique ne doit plus apparaitre dans la traduction.
const RE_FR = /\b(agglomération|couper|déborde|commune voisine|plusieurs|longe la limite|sans cartouche|hors agglo|Ignorés|règle propre|laissée)\b/;
const francais = NOEUDS.filter(n => trad(n) && RE_FR.test(trad(n)));
verifier('4. aucune traduction ne garde un morceau de phrase française', francais, []);

console.log('\n=== Valeurs exactes ===\n');
verifier('5. le cas d\'onryou : jetons de `fmt`, noms gardés',
  trad(': ‹sans nom› / ‹sans ville› → ‹sans nom› / Ancey'), ': ‹senza nome› / ‹senza città› → ‹senza nome› / Ancey');
verifier('6. type de voie + identifiant', trad('Chemin de terre · #440224630'), 'Strada sterrata · #440224630');
verifier('7. note sans panneau (v2.50.10)',
  trad('⚠ à cheval sur l\'agglomération sans panneau d\'entrée (55 % dedans) : la ville est laissée à ton appréciation'),
  '⚠ a cavallo del centro abitato senza cartello di inizio (55 % dentro): la città è lasciata alla tua valutazione');
verifier('8. ⚠️ une note qui CONTIENT « ; » n\'est pas coupée en deux',
  trad('⚠ longe la limite avec « X », en agglomération de ce côté-là : c\'est cette commune qui porte le nom principal. Le script ne l\'écrit pas à ta place — vérifie-le et pose-le à la main ; il ne touche pas au principal.'),
  '⚠ segue il confine con « X », nel centro abitato da quel lato: è quel comune che porta il nome principale. Lo script non lo scrive al posto tuo — verificalo e impostalo a mano; non tocca il principale.');
verifier('9. ⚠️ une note inconnue reste en français, sans faire tomber les autres',
  trad('⚠ inconnue ; déborde de 12 m sur la commune voisine'), '⚠ inconnue ; sconfina di 12 m nel comune vicino');
verifier('10. ⚠️ aucune note connue : pas de traduction (le noeud reste tel quel)',
  trad('⚠ rien de connu ici'), null);
verifier('11. bilan : un morceau inconnu fait renoncer à toute la suite',
  trad('2 en agglo · 3 truc inconnu'), null);
verifier('12. le motif « ⚠ … » ne vole pas le motif plus ancien de la sélection',
  trad('⚠ 3 / 5 sélectionnés — dézoome d\'un cran, puis reclique sur la ligne'),
  '⚠ 3 / 5 selezionato/i — riduci lo zoom di un livello, poi riclicca sulla riga');

console.log('\n=== Français : les accents des textes affichés ===\n');
const FAUTES = ['Chemin pietonnier', 'Marquer comme traite"', 'Troncons eloignes', '>eparpilles<',
  "' numero' +", 'alternatifs reels ?', 'pas decrire la fonction', 'est porte par la rue',
  'position deduite', 'être determinee', "' porte par le segment'", "champ: 'abreviation'",
  "mitoyenIndecis + '  »"];
verifier('13. plus aucune des fautes relevées le 30/09/2026', FAUTES.filter(f => src.includes(f)), []);

console.log('\n' + ok + ' ok, ' + ko + ' echec(s)\n');
process.exit(ko ? 1 : 0);
