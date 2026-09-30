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
 * ⭐ Etendu le meme jour aux onglets POI et Numerotation, aux bandeaux sous le
 *   bilan et a la barre de navigation : 99 noeuds sur 127 y sortaient en
 *   francais.
 * ⚠️ HORS PERIMETRE, et dit : les boites de dialogue (choix d'adresse, de nom)
 *    et les messages de correction — non releves ici.
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

// --- Onglets POI et Numerotation, bandeaux sous le bilan, barre de navigation ---
const NOEUDS_AUTRES = [
  "‹ Précédent",
  "Suivant ›",
  "3 traités",
  "1 traité",
  "⚠ 3 / 5 sélectionnés — dézoome d'un cran, puis reclique sur la ligne",
  "WME ne descend que les segments présents dans la vue : ceux restés dehors ne peuvent pas être sélectionnés. Dézoome d'un cran, puis reclique sur cette ligne.",
  "Aucun écart dans cet onglet — regarde les autres.",
  "Aucun écart détecté.",
  "‹sans nom› / ‹sans ville›",
  "Boulangerie Martin — ‹sans rue› / ‹sans commune› n° 3",
  "‹sans nom : Boulangerie› — Rue X / Ancey",
  "POI résidentiel — n° 5",
  "POI résidentiel · POI v123456",
  "Numéros de rue ·",
  ": — → renseigner la rue et la commune (Ancey)",
  ": — → renseigner le nom de la voie",
  ": D980 → un numéro de route n'est pas une adresse : renseigner le nom de la voie",
  ": — → renseigner Ancey",
  ": — → renseigner Ancey (la rue « Rue X » est conservée)",
  ": — → renseigner le numéro de rue",
  ": — → n° 12 ? — c'est le point d'adresse le plus proche sur « Rue X » (15 m, numéro de rue), à vérifier avant de saisir",
  ": Montfaucon → Ancey ? — à 35 m de la limite communale, l'adresse de la commune voisine peut être la bonne",
  ": Montfaucon → Ancey — le lieu est dans le contour de Ancey, à 120 m de la limite",
  ": Montfaucon → Ancey — le lieu est dans le contour de Ancey",
  ": — → renseigner « A9 » (autoroute à 40 m), et AUCUNE commune",
  ": — → renseigner le nom de l'autoroute dont ce lieu dépend, et AUCUNE commune",
  ": — → aucun nom de rue à proximité — seulement D980 (12 m), D6 (30 m) : ⚡ pour choisir ou saisir l'adresse",
  ": — → proposition : Rue X / Ancey — n° 12 ? (voie à 15 m, la suivante à 40 m, numéro à 8 m)",
  ": — → proposition : Rue X / Ancey (voie à 15 m)",
  ": — → proposition : Rue X / Ancey (voie à 15 m, la suivante à 40 m) — autres possibilités : Rue Y (40 m), D6 (55 m) (⚡ pour choisir)",
  "🛠 D'où vient cette proposition",
  "Voie nommée la plus proche du point d'accès : « Rue X », à 15 m, la voie suivante étant à 40 m. Le nom est cherché sur le principal ET les alternatifs : hors agglomération, c'est justement l'alternatif qui porte le nom de rue.",
  "Voie nommée la plus proche du lieu : « Rue X », à 15 m, et aucune autre voie nommée à moins de 60 m. Le nom est cherché sur le principal ET les alternatifs : hors agglomération, c'est justement l'alternatif qui porte le nom de rue.",
  "Les seules voies à moins de 60 m portent un numéro de route : ce n'est pas une adresse postale, le script ne le propose donc pas d'office. Le nom est cherché sur le principal ET les alternatifs : hors agglomération, c'est justement l'alternatif qui porte le nom de rue.",
  "⚠️ Numéro n° 12 relevé à 8 m sur cette voie : c'est le point d'adresse le plus proche, PAS une certitude — à cette distance ce peut être celui du voisin. Le script ne l'applique jamais.",
  "Aucun numéro à moins de 30 m sur cette voie : à saisir à la main.",
  "La commune appliquée est celle du contour INSEE (Ancey), pas celle du segment.",
  "⚡ ouvre la liste des noms relevés autour du lieu — le plus probable en tête, les numéros de route ensuite, et une saisie libre. La commune appliquée sera celle du contour INSEE (Ancey).",
  "⚠ position déduite de la surface (60 % dans la commune) : ce POI n'a pas de point d'accès",
  "⚠ position prise sur : point d'accès",
  "⚠ position prise sur : position du lieu",
  "⚠ position prise sur : centre du lieu",
  "Analyse non lancée.",
  "Audit des POI indisponible.",
  "POI en écart sur",
  "audité(s) à Ancey.",
  "12 conforme(s) · 3 hors du contour communal ·",
  "12 conforme(s).",
  "2 élément(s) naturel(s) écarté(s)",
  "4 bâti(s) sans nom écarté(s)",
  "1 sur adresse d'autoroute",
  "Rivière, fleuve, mer, lac, étang, île, forêt, plantation, canal, marais, plage : ces lieux décrivent le paysage et n'ont pas d'adresse postale. Ils sont écartés volontairement.",
  "Zones sans nom qui servent à dessiner le bâti sur l'écran de l'application. Ce ne sont pas des adresses : les commerces qu'elles abritent sont des POI à part entière, eux-mêmes audités.",
  "Aires, échangeurs, jonctions et péages, ou tout POI dont la rue est déjà une autoroute. Règle FR : leur adresse est le nom de l'autoroute dont ils dépendent, et AUCUNE ville. Ils sont audités sur cette cible-là, pas sur une adresse postale.",
  "Le contrôle « numéro de rue manquant » est décoché : il concerne environ la moitié des POI. Coche-le dans les réglages quand tu veux t'y attaquer.",
  "POI résidentiel injustifié",
  "POI résidentiel en agglo",
  ": n° 12 porté par le segment → à passer en POI résidentiel",
  ": n° 12 porté par le segment → à passer en POI résidentiel — adresse à saisir à la conversion",
  ": n° 12 porté par le segment → à passer en POI résidentiel — adresse à choisir à la conversion",
  ": n° 12 porté par le segment → à passer en POI résidentiel — Rue X / Ancey",
  ": n° 12 sur « D980 / ‹sans ville› » — le nom principal est un numéro de route → nom de rue présent en alternatif : « Rue X »",
  ": n° 12 sur « D980 / ‹sans ville› » — le nom principal est un numéro de route → aucun nom de rue sur ce segment, même en alternatif",
  ": n° 5 porté par un POI résidentiel → le numéro doit être porté par le segment (à faire à la main)",
  ": POI résidentiel sans numéro → à trancher : numéro porté par le segment, ou entrée sur une autre voie",
  "⚠ aucune adresse exploitable sur ce segment : la rue du POI ne peut pas être déterminée",
  "⚠ ce segment ne porte qu'un numéro de route : le nom du POI sera demandé à la conversion",
  "⚠ plusieurs noms de rue sur ce segment (Rue A, Rue B) : le choix sera demandé",
  "⚠ voie en limite communale (Ancey, Montfaucon) : la commune de chaque numéro sera demandée",
  "⚠ le segment porte la ville « Montfaucon » alors que le contour donne « Ancey » : c'est la commune INSEE qui est appliquée au POI",
  "⚠ Relevé à la demande d'un éditeur, pour mesurer l'ampleur du cas. Ce n'est pas un écart : aucune règle française ne l'interdit à ce jour. Ne corrige rien sur cette seule base.",
  "⚠ ce POI porte une photo : il a été posé par un contributeur venu sur place — regarde-le de près avant de le supprimer",
  "🛠 Pourquoi ce POI n'a pas lieu d'être",
  "🛠 Deux issues possibles — c'est le terrain qui tranche",
  "le n° 5 est déjà posé sur « Rue X » à 12 m : ce POI fait doublon (constaté sur : numéro existant).",
  "le point d'accès donne sur « Rue X », c'est-à-dire sur la voie de l'adresse elle-même : rien ne justifie un POI (constaté sur : point d'accès).",
  "le POI est le long de « Rue X » (8 m), la voie de son adresse : un numéro porté par le segment dirait la même chose (constaté sur : position du POI).",
  "Sélectionne la voie, ouvre « Ajouter des numéros de rue », pose le n° 5 du bon côté, vérifie qu'il tombe devant l'entrée, puis supprime ce POI.",
  "Sélectionne la voie, ouvre « Ajouter des numéros de rue », pose le numéro du bon côté, vérifie qu'il tombe devant l'entrée, puis supprime ce POI.",
  "⚠️ Vérifie quand même sur place : le script mesure des distances, il ne voit pas la boîte aux lettres.",
  "Si l'entrée (la boîte aux lettres) donne bien sur « Rue X » : le numéro doit être porté par le segment. Sélectionne la voie, ouvre « Ajouter des numéros de rue », pose le n° 5 du bon côté, vérifie qu'il tombe devant l'entrée, puis supprime ce POI.",
  "Si l'entrée (la boîte aux lettres) donne bien sur la rue de l'adresse : le numéro doit être porté par le segment. Sélectionne la voie, ouvre « Ajouter des numéros de rue », pose le numéro du bon côté, vérifie qu'il tombe devant l'entrée, puis supprime ce POI.",
  "Si l'entrée donne sur une AUTRE voie que l'adresse postale : laisse le POI en place. C'est précisément ce qu'il sert à dire, et un numéro porté par le segment ne saurait pas l'exprimer. Marque la ligne comme traitée (✓) pour ne pas la revoir.",
  "numéro(s) lu(s) à Ancey, dont",
  "numéro(s) lu(s) à Ancey",
  "hors agglomération.",
  "(contrôle « numéros hors agglomération » décoché).",
  "Ils ont été lus pour repérer les POI résidentiels qui font doublon avec un numéro déjà posé.",
  "Mesure demandée par un éditeur, sans valeur normative : aucune règle française n'interdit ce cas à ce jour.",
  "📏 Mesure :",
  "numéro(s) en agglomération sur une voie dont le nom principal est un numéro de route, dont",
  "avec un nom de rue en alternatif.",
  "aucun",
  "numéro en agglomération sur une voie nommée « Dxxx » ici — le contrôle a bien tourné, cette commune n'a pas le cas.",
  "POI résidentiel(s), dont",
  "en agglomération ·",
  "en agglomération.",
  "sans justification",
  "3 à leur place (accès sur une autre voie)",
  "2 avec photo",
  "Le numéro est déjà porté par la voie, ou l'entrée donne sur la voie de l'adresse elle-même : le POI n'exprime aucun décalage.",
  "Leur point d'accès donne sur une AUTRE voie que leur adresse : c'est exactement ce qu'un POI résidentiel sert à dire. Ils ne sont pas signalés.",
  "Ces POI portent une photo : quelqu'un est venu sur place les poser. Ils restent signalés, mais en fin de liste.",
  "La conversion cadre elle-même sur les numéros : WME ne les charge qu'à partir du zoom 18.",
  "⚠ Analyse interrompue.",
  "Les reports ci-dessous sont ceux trouvés avant l'arrêt : la commune n'a pas été parcourue en entier.",
  "⚠ Lecture directe indisponible — analyse en mode dégradé.",
  "La commune a été parcourue en déplaçant la carte, ce qui est beaucoup plus lent et peut manquer des objets en bordure.",
  "Motif : inconnu",
  "Si ça se reproduit, l'API interne de WME a probablement changé : c'est à signaler, le script doit être adapté.",
  "Zonage à vérifier",
  "— analyse interrompue, ce constat n'est pas fiable :",
  "Il manque au moins un polygone.",
  "» est portée par 12 segment(s), dont",
  "n'est dans un polygone.",
  "3 seulement",
  "dans un polygone — il est probablement trop petit.",
  "Relance l'analyse en entier pour trancher.",
  "Ces segments se déclarent en agglomération, mais le zonage les place dehors :",
  "les écarts les concernant sont faux, et les corrections proposées iraient dans le mauvais sens",
  ". Trace le polygone manquant, puis relance.",
  "12 segment(s) portent le nom d'une commune voisine",
  "Ils sont pourtant dans Ancey : c'est leur",
  "adresse",
  "qui est fausse, pas le zonage.",
  "Rien à tracer",
  "— les corrections proposées rétablissent déjà Ancey, et ces segments forment leurs propres reports dans la liste."
];

console.log('\n=== Onglet Segments : chaque noeud ressort en italien ===\n');
verifier('1. TEMOIN : l\'infobulle du seuil, deja traduite avant la 2.50.10, ressort bien',
  !!trad('Seuil de rattachement'), true);
const TOUS = NOEUDS.concat(NOEUDS_AUTRES);
const manquants = TOUS.filter(n => !trad(n));
verifier('2. ⭐⭐ ' + TOUS.length + ' noeuds (Segments ' + NOEUDS.length + ', POI / Numérotation / bandeaux ' +
  NOEUDS_AUTRES.length + ') : aucun ne reste sans traduction', manquants, []);
const brut = TOUS.map(trad).filter(v => v && /\$\d/.test(v));
verifier('3. aucun « $1 » resté brut', brut, []);
// Un mot francais caracteristique ne doit plus apparaitre dans la traduction.
// ⚠️ « Traduit » ne suffit pas : un motif peut rendre la phrase FRANCAISE telle quelle (c'etait le cas
//    des lignes « avant → apres » de l'onglet POI avant leurs motifs).
const RE_FR = /\b(agglomération|couper|déborde|commune voisine|plusieurs|longe la limite|sans cartouche|hors agglo|Ignorés|règle propre|laissée|renseigner|porté|proposition|autres possibilités|voie|contour|à passer|constaté|Sélectionne|trancher|Aucun|écart|analyse|numéro|polygone|reports)\b/;
const francais = TOUS.filter(n => trad(n) && RE_FR.test(trad(n)));
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
  "mitoyenIndecis + '  »",
  // onglets POI et Numerotation, bandeaux
  "' traite' + (n", 'ceux trouves', "l'arret :", 'mode degrade', 'ete parcourue', 'Si ca se reproduit',
  'Zonage a verifier', 'Analyse non lancee', '(la boite aux lettres)', 'voit pas la boite', "lu(s) a '"];
verifier('13. plus aucune des fautes relevées le 30/09/2026', FAUTES.filter(f => src.includes(f)), []);

console.log('\n' + ok + ' ok, ' + ko + ' echec(s)\n');
process.exit(ko ? 1 : 0);
