/**
 * LA ZONE DE TRACE EN ITALIEN — v2.49.03.
 *
 * ⚠️⚠️ POURQUOI CE FICHIER EXISTE : le 23/09/2026, l'aide etait traduite a
 * 100 % mais la zone de trace (volet, guide, fenetre du pre-trace, fin de
 * zonage) ne l'etait qu'a 16 textes sur 70 — et aucun des textes portant un
 * nombre ou un nom ne pouvait l'etre, le dictionnaire exigeant le texte exact.
 * Un editeur italien voyait donc cette zone en francais, en France comme en
 * Italie, sans que rien ne le signale.
 *
 * ⭐⭐ LE TEMOIN EST EXTERIEUR : `fixtures/zone-trace-releve-2026-09-23.json`
 * est un RELEVE FAIT DANS WME (15 etats, Ploemeur), pas une liste tiree du
 * dictionnaire — un controle qui relit ses propres cles ne mesure rien.
 * Le banc rejoue la decision de `traduireDOM` : un BLOC traduit couvre ses
 * fragments ; sinon, chaque fragment doit l'etre (noms propres exceptes).
 *
 * ⚠️ Les VARIANTES ci-dessous n'ont pas ete vues a l'ecran : elles sont lues
 * dans le code (source muette, commune declaree sans agglomeration, carte
 * partie ailleurs…). Elles sont marquees comme telles.
 *
 * Usage : node tools/test-zone-trace-it.js
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');
const releve = JSON.parse(fs.readFileSync('tools/fixtures/zone-trace-releve-2026-09-23.json', 'utf8'));

let ok = 0, ko = 0;
const lignes = [];
function verifier(t, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + t); }
  else { ko++; lignes.push('  ECHEC ' + t + '\n          attendu ' +
    JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
function titre(t) { lignes.push('\n' + t); }

// --- TEXTES, MOTIFS et traduireMotif, EXTRAITS du userscript -----------------
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
const finT = iT + bloc('const TEXTES = {').length + 1;
// Tout ce qui separe TEXTES de la fin de MOTIFS (LIEUX_IT, lieuIt, RAISONS_IT…).
const finM = src.indexOf('\n  };', src.indexOf('const MOTIFS = {')) + 5;
const api = new Function('LANGUE',
  src.slice(iT, finM) + '\n' + bloc('function traduireMotif(') +
  '\nreturn { TEXTES, MOTIFS, traduireMotif };')('it');
const d = api.TEXTES.it;
const norm = x => x.replace(/\s+/g, ' ').trim();
const trad = x => d[x] || d[norm(x)] || api.traduireMotif(norm(x));

titre('Le mécanisme de motifs');
verifier('1. MOTIFS.it existe et porte des entrées', Array.isArray(api.MOTIFS.it) && api.MOTIFS.it.length > 20, true);
verifier('2. ⚠️ chaque motif est ANCRÉ (^…$) : il ne traduit jamais un morceau de phrase',
  api.MOTIFS.it.filter(([re]) => !/^\^/.test(re.source) || !/\$$/.test(re.source)).map(([re]) => re.source), []);
verifier('3. ⚠️ un texte fixe garde sa clé : le motif n\'est essayé qu\'après le dictionnaire',
  /d\[cle\] \|\| d\[cle\.replace\(\/\\s\+\/g, ' '\)\] \|\|\s*traduireMotif/.test(src), true);

titre('⭐⭐ Le relevé fait DANS WME — tout doit ressortir en italien');
const noms = new Set(releve.noms);
const fragments = h => h.replace(/<[^>]+>/g, '\u0001').split('\u0001').map(norm).filter(Boolean);
const couverts = new Set();
for (const [t, x] of releve.releve) if (t === 'B' && trad(x)) fragments(x).forEach(f => couverts.add(f));
const manquants = [];
for (const [t, x] of releve.releve) {
  if (noms.has(norm(x))) continue;
  if (t === 'B') { if (!trad(x) && fragments(x).some(f => !noms.has(f) && /[a-zé]{3}/i.test(f) && !trad(f))) manquants.push('B ' + x); continue; }
  if (couverts.has(norm(x))) continue;
  if (!/[a-zé]{3}/i.test(x)) continue;
  if (!trad(x)) manquants.push(t + ' ' + x);
}
verifier('4. ⭐⭐ ' + releve.releve.length + ' textes relevés : aucun ne reste en français', manquants, []);
const identiques = releve.releve.filter(([t, x]) => !noms.has(norm(x)) && trad(x) && trad(x) === norm(x)).map(e => e[1]);
verifier('5. aucune « traduction » identique au français', identiques, []);
const trous = releve.releve.map(e => trad(e[1])).filter(v => v && /\$\d/.test(v));
verifier('6. ⚠️ aucun « $1 » resté brut dans une traduction', trous, []);

titre('Les textes à variables — traduits, et avec LEURS valeurs');
const V = [
  ['7 commune(s) dans la vue sur 3195', '7 comune/i nella vista su 3195'],
  ['1 polygone', '1 poligono'], ['3 polygones', '3 poligoni'], ['16 communes', '16 comuni'],
  ['Polygone 2 / 5 — quel nom ?', 'Poligono 2 / 5 — quale nome?'],
  ['entrée(s) d\'agglomération (21 panneau(x)) :', 'ingresso/i di centro abitato (21 cartello/i):'],
  ['entrée(s) d\'agglomération (4 panneau(x)).', 'ingresso/i di centro abitato (4 cartello/i).'],
  ['Ville appliquée : Gruissan-Plage (Gruissan)', 'Città applicata: Gruissan-Plage (Gruissan)'],
  ['Entoure la zone bâtie du bourg', 'Delimita la zona edificata del capoluogo'],
  ['Entoure la zone bâtie du bourg (mairie)', 'Delimita la zona edificata del capoluogo (municipio)'],
  ['Entoure la zone bâtie d\'un secteur d\'entrées', 'Delimita la zona edificata di un settore di ingressi'],
  ['Entoure la zone bâtie de Ploemeur à la main.', 'Delimita la zona edificata di Ploemeur a mano.'],
  ['Entoure la zone bâtie d\'Arles à la main.', 'Delimita la zona edificata di Arles a mano.'],
  ['Le zonage du Havre est fait — referme le volet de gauche.', 'La zonizzazione di Le Havre è fatta — richiudi il pannello di sinistra.'],
  ['Tout est prêt : lance l\'analyse de Ploemeur.', 'Tutto è pronto: avvia l\'analisi di Ploemeur.'],
  ['entrée(s) non tracée(s) (alignés le long d\'une route).', 'ingresso/i non tracciato/i (allineati lungo una strada).'],
  ['sur 855 ha, trop isolés :', 'su 855 ha, troppo isolati:'],
  // Reglages (v2.49.03) : le resultat d'un import de partage, avec et sans rejet.
  ['2 commune(s) avec polygone, 0 « sans agglo » et 1 avec hameaux déclarés ajoutée(s). Tes communes existantes n\'ont pas été touchées.',
   '2 comune/i con poligono, 0 « senza centro abitato » e 1 con hameau dichiarati aggiunto/i. I tuoi comuni esistenti non sono stati toccati.'],
  ['2 commune(s) avec polygone, 0 « sans agglo » et 1 avec hameaux déclarés ajoutée(s). Tes communes existantes n\'ont pas été touchées. ⚠️ 3 entrée(s) écartée(s) : code INSEE, polygone ou hameau invalide (le fichier est peut-être abîmé).',
   '2 comune/i con poligono, 0 « senza centro abitato » e 1 con hameau dichiarati aggiunto/i. I tuoi comuni esistenti non sono stati toccati. ⚠️ 3 voce/i scartata/e: codice INSEE, poligono o hameau non valido (il file è forse danneggiato).']
];
for (const [fr, it] of V) verifier('7. « ' + fr + ' »', trad(fr), it);

titre('Variantes LUES DANS LE CODE (non vues à l\'écran le 23/09)');
const VARIANTES = [
  'sans agglomération (déclarée)', 'aucun', 'Relevé interrompu.',
  'Aucun panneau EB10 / EB20 relevé dans cette commune.',
  'Le jeu national ne couvre que 86 départements, et une commune couverte peut n\'avoir aucun panneau saisi : cela ne dit RIEN sur son agglomération.',
  'Vérifie que le tracé englobe bien les habitations de l\'agglomération, et ajuste-le aux poignées (✎) si besoin.',
  'Aucun panneau relevé : rien à proposer. Lance d\'abord « 🪧 Panneaux d\'agglomération ».',
  'aucun tracé possible', '. Trace à la main — les panneaux restent affichés.', 'Aucun polygone créé',
  ', les panneaux ne marquent que les routes.',
  'Aucun panneau sur cette commune : rien à proposer.',
  'Les 7 panneaux relevés ne forment aucune surface exploitable : ils s\'alignent le long d\'une voie. Trace à la main.',
  'Aucun jeu de données de panneaux d\'entrée d\'agglomération n\'existe pour Italia. Le tracé se fait à la main — c\'est déjà le cas dans une bonne partie de la France.',
  'Aucun panneau d\'entrée d\'agglomération relevé sur cette commune dans le jeu officiel de signalisation. Ce n\'est pas un défaut du script : la source est très inégale. Trace l\'agglomération à la main.',
  'Termine d\'abord l\'édition du tracé en cours (💾 pour enregistrer, Échap pour annuler).',
  '(un hameau reste hors agglomération), en commençant par le bourg :', 'bourg principal', 'secteur non relevé',
  '‹ville du segment› (Ploemeur)', '12 sommets — ville appliquée :',
  'Amène la carte sur la commune à traiter : les contours du département se chargent tout seuls.',
  'Rien à faire d\'autre — patiente quelques secondes.',
  'Vérification des panneaux disponibles sur cette commune…',
  'Une seconde — la source est très inégale, et c\'est elle qui décide par où commencer.',
  'C\'est la zone entre les panneaux d\'entrée et de sortie d\'agglo — pas la limite de commune (celle en tirets bleus). Les panneaux ne suffisent pas ici. Double-clic pour fermer le tracé — ou coche « sans agglomération » si la commune n\'en a pas.',
  'Le script travaille sur Lirac — pas sur la commune que tu regardes.',
  'La carte est centrée sur une autre commune. Choisis-la dans la liste pour travailler dessus — ou recadre sur Lirac pour reprendre où tu en étais.',
  'La carte a quitté Lirac — choisis la commune à traiter.',
  '⚠️ Assure-toi d\'avoir tracé', 'toutes',
  'les agglomérations de la commune (le bourg, les villages et les anciennes communes — pas les hameaux, même panneautés) : une agglomération oubliée passe en hors agglomération, et tous ses écarts seront faux.',
  'Aucun panneau d\'agglomération n\'est disponible ici :', 'le script ne peut pas vérifier à ta place',
  'Au besoin,', 'les recense pour toi.', 'est déclarée', 'sans agglomération',
  ': tous ses segments seront jugés hors agglomération. Décoche la case si ce n\'est plus vrai.',
  'Relevé peut-être incomplet', ': une zone rendait le maximum de résultats que l\'API accepte, même découpée au plus fin.',
  'Cette source exige Tampermonkey (la page de WME ne peut pas appeler l\'extérieur).', 'Panneaux d\'agglomération'
];
verifier('8. ' + VARIANTES.length + ' variantes du code : toutes traduites', VARIANTES.filter(x => !trad(x)), []);

titre('⚠️ Les variantes du code existent bien dans le code (sinon elles ne prouvent rien)');
// Chaque variante doit se retrouver dans le source, mots voisins (meme tolerance
// que test-i18n) : une variante inventee ferait passer un dictionnaire faux.
const srcSansDico = src.slice(0, iT) + src.slice(finM);
const presente = x => {
  const mots = (x.match(/[A-Za-zÀ-ÿ]{4,}/g) || []).filter(m => !/^(Lirac|Ploemeur|Italia)$/.test(m));
  if (!mots.length) return true;
  return new RegExp(mots.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]{0,60}')).test(srcSansDico);
};
verifier('9. ⭐ aucune variante inventée', VARIANTES.filter(x => !presente(x)), []);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log(ok + ' verifications OK, ' + ko + ' ECHEC(S)');
process.exit(ko ? 1 : 0);
