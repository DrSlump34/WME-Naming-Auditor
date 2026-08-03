/**
 * Tests des SECTIONS d'interface (repli, resume) — v2.21.01.
 *
 * ⚠️⚠️ Ce fichier existe a cause d'une panne vecue le 27/07, signalee par
 * l'auteur : « je suis alle sur Saint-Tropez, il ne charge rien, la liste des
 * communes est desesperement vide ».
 *
 * Cause : la v2.21.00 DEPLACE le chargement manuel des contours vers les
 * reglages, puis supprime la section d'origine. `ui.sections` gardait une
 * reference vers ce noeud mort ; `replierSection('contours')` y cherchait
 * `.agn-sect-c` — parti avec le deplacement — et faisait `null.style`.
 * L'exception tombait dans `rafraichirCommunesDeLaVue`, JUSTE avant
 * `renderAgglos`, donc `init()` s'interrompait : plus d'abonnement au
 * deplacement de la carte, donc plus AUCUN chargement automatique de
 * departement. Un simple deplacement de noeud DOM, et tout le demarrage tombe.
 *
 * Ce qu'aucun test existant ne pouvait voir : ils portent tous sur le CALCUL.
 * Ici on eprouve la manipulation du DOM — avec un DOM minimal, sans navigateur.
 *
 * Usage : node tools/test-ui-sections.js
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

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else { ko++; lignes.push('  ECHEC ' + titre + '\n          attendu ' +
    JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
function titre(t) { lignes.push('\n' + t); }

/**
 * Un DOM minimal : juste ce que les fonctions touchent (classList, style,
 * querySelector, appendChild, remove). Pas de dependance externe.
 */
function elem(classe, data) {
  const n = {
    _classes: new Set(classe ? classe.split(' ') : []),
    dataset: data || {}, enfants: [], parent: null,
    style: {}, textContent: '',
    classList: {
      toggle: (c, on) => { if (on) n._classes.add(c); else n._classes.delete(c); },
      add: c => n._classes.add(c), remove: c => n._classes.delete(c),
      contains: c => n._classes.has(c)
    },
    appendChild(x) { if (x.parent) x.parent.enfants = x.parent.enfants.filter(e => e !== x);
                     x.parent = n; n.enfants.push(x); return x; },
    remove() { if (n.parent) n.parent.enfants = n.parent.enfants.filter(e => e !== n); n.parent = null; },
    querySelector(sel) {
      const cl = sel.replace('.', '');
      const cherche = liste => {
        for (const e of liste) {
          if (e._classes.has(cl)) return e;
          const t = cherche(e.enfants); if (t) return t;
        }
        return null;
      };
      return cherche(n.enfants);
    }
  };
  return n;
}
/** Reconstruit une section telle que la produit `buildOverlay`. */
function sectionComplete(nom) {
  const sec = elem('agn-sect', { s: nom });
  const t = elem('agn-sect-t');
  t.appendChild(elem('agn-chev'));
  t.appendChild(elem('agn-sect-r'));
  sec.appendChild(t);
  sec.appendChild(elem('agn-sect-c'));
  return sec;
}

// Contexte minimal attendu par les deux fonctions extraites.
const ctx = { ui: { sections: {} }, metaContours: null, communeActive: null,
              agglos: {}, sansAgglo: {} };
const api = new Function('ui', 'metaContours', 'communeActive', 'agglos', 'sansAgglo',
  extraire('majResumeSections') + '\n' + extraire('replierSection') +
  '\nreturn { replierSection, majResumeSections };')(
  ctx.ui, ctx.metaContours, ctx.communeActive, ctx.agglos, ctx.sansAgglo);

titre('Une section entiere se replie et se deplie normalement');
{
  ctx.ui.sections = { commune: sectionComplete('commune') };
  api.replierSection('commune', false);
  const sec = ctx.ui.sections.commune;
  verifier('1. repliee : la classe est posee', sec.classList.contains('agn-ferme'), true);
  verifier('1. le corps est masque', sec.querySelector('.agn-sect-c').style.display, 'none');
  verifier('1. le chevron pointe a droite', sec.querySelector('.agn-chev').textContent, '▸');
  api.replierSection('commune', true);
  verifier('2. depliee : la classe est retiree', sec.classList.contains('agn-ferme'), false);
  verifier('2. le corps reapparait', sec.querySelector('.agn-sect-c').style.display, '');
  verifier('2. le chevron pointe en bas', sec.querySelector('.agn-chev').textContent, '▾');
}

titre('⚠️ LE CAS SAINT-TROPEZ : une section dont le CORPS a ete deplace ailleurs');
{
  const sec = sectionComplete('contours');
  const ailleurs = elem('agn-contours-manuel');
  ailleurs.appendChild(sec.querySelector('.agn-sect-c'));   // le deplacement
  sec.remove();                                             // puis la suppression
  ctx.ui.sections = { contours: sec };                      // reference perimee
  let erreur = null;
  try { api.replierSection('contours', false); } catch (e) { erreur = e.message; }
  verifier('3. ⚠️ replier une section deplacee NE DOIT PAS lever', erreur, null);
  let erreur2 = null;
  try { api.majResumeSections(); } catch (e) { erreur2 = e.message; }
  verifier('4. ⚠️ le resume des sections non plus', erreur2, null);
}

titre('Le cas normal du deplacement : la reference est retiree');
{
  // C'est ce que fait `rangerChargementContours` : plus d'entree, plus de risque.
  ctx.ui.sections = {};
  let erreur = null;
  try { api.replierSection('contours', false); api.majResumeSections(); }
  catch (e) { erreur = e.message; }
  verifier('5. aucune section « contours » connue ⇒ rien ne se passe, sans erreur', erreur, null);
}

titre('Verrou : le code source retire bien la reference apres le deplacement');
{
  const fn = src.slice(src.indexOf('function rangerChargementContours'),
                       src.indexOf('function etapeCourante'));
  verifier('6. `rangerChargementContours` supprime `ui.sections.contours`',
    /delete\s+ui\.sections\.contours/.test(fn), true);
  verifier('7. … et il le fait APRES avoir retire le bloc du DOM',
    fn.indexOf('bloc.remove()') < fn.indexOf('delete ui.sections.contours'), true);
}

// ===========================================================================
// LES GEOMETRIES « MULTI » — le SDK les REFUSE (v2.21.02)
//
// ⚠️⚠️ Signale par l'auteur : « Saint-Tropez, Ramatuelle, La Croix-Valmer ne
// dessinent pas le polygone de contour ; Gassin ou Cogolin oui ». Mesure : les
// premieres sont des MultiPolygon (ilots, rochers), les secondes des Polygon.
// Le SDK leve « geometry must match the configured type » — meme pour un
// MultiPolygon seul sur un calque neuf. L'exception etait avalee par le `catch`
// du dessin : aucun message, juste un contour absent.
// ⚠️ Le piege ne se limitait pas au contour : le calque des ECARTS recoit les
// POI surfaciques, et `addFeaturesToLayer` valide le tableau ENTIER — un seul
// POI MultiPolygon faisait donc disparaitre TOUT le surlignage.
// ⚠️ « Commune cotiere » n'etait PAS le critere : Cavalaire-sur-Mer est cotiere
// et s'affiche tres bien (c'est un Polygon). Correction faite par l'auteur.
// ===========================================================================
titre('Geometries « Multi » : eclatees en features simples');
{
  const api2 = new Function(extraire('featuresDeGeom') + '\nreturn featuresDeGeom;')();
  const carre = (x, y) => [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]];

  const simple = api2('commune-83036', { type: 'Polygon', coordinates: carre(0, 0) }, { label: 'Cavalaire' });
  verifier('8. un Polygon reste UNE feature', simple.length, 1);
  verifier('8. … avec son identifiant inchange', simple[0].id, 'commune-83036');
  verifier('8. … et sa geometrie telle quelle', simple[0].geometry.type, 'Polygon');
  verifier('8. les proprietes suivent', simple[0].properties.label, 'Cavalaire');

  const multi = api2('commune-83119',
    { type: 'MultiPolygon', coordinates: [carre(0, 0), carre(3, 0), carre(6, 0), carre(9, 0)] },
    { label: 'Saint-Tropez' });
  verifier('9. ⭐ Saint-Tropez : 4 morceaux ⇒ 4 features', multi.length, 4);
  verifier('9. toutes en Polygon (le type accepte)',
    [...new Set(multi.map(f => f.geometry.type))], ['Polygon']);
  verifier('9. ⚠️ des identifiants DISTINCTS (sinon elles se recouvrent)',
    new Set(multi.map(f => f.id)).size, 4);
  verifier('9. chaque morceau garde le libelle', multi.every(f => f.properties.label === 'Saint-Tropez'), true);

  verifier('10. MultiLineString ⇒ des LineString',
    api2('x', { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] }, {})
      .map(f => f.geometry.type), ['LineString', 'LineString']);
  verifier('11. MultiPoint ⇒ des Point',
    api2('x', { type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] }, {}).map(f => f.geometry.type),
    ['Point', 'Point']);
  verifier('12. geometrie absente ⇒ aucune feature (et pas d\'erreur)', api2('x', null, {}), []);
  verifier('13. Hyeres et ses 46 morceaux : 46 features, 46 identifiants',
    (() => { const g = { type: 'MultiPolygon', coordinates: [] };
             for (let i = 0; i < 46; i++) g.coordinates.push(carre(i * 3, 0));
             const f = api2('h', g, {});
             return [f.length, new Set(f.map(x => x.id)).size]; })(), [46, 46]);
}

// ===========================================================================
// L'INFOBULLE DE SURVOL EST DEBRAYABLE (v2.27.09)
//
// ⚠️⚠️ Signale par Glenan56 (27/07) : d'AUTRES SCRIPTS posent leur propre bulle
// au survol, et les deux se recouvrent. Verifie avant de conclure : la bulle
// claire de ses captures n'est NI Naming Auditor (fond #263238, et AUCUN code
// de vitesse) NI « Place Interface Enhancements » (sa source n'a ni tooltip de
// lieu ni vitesse). On ne peut pas arbitrer chez le voisin — on peut se taire.
// ===========================================================================
{
  verifier('14. l\'option existe et est cochee par defaut',
    /bulleSurvol: true/.test(src), true);
  verifier('14. la case a cocher existe dans le volet',
    /id="agn-r-bulle"/.test(src), true);
  verifier('14. elle est branchee sur l\'option',
    /coche\('#agn-r-bulle', 'bulleSurvol'/.test(src), true);
  // ⭐ Couper A LA SOURCE : une option qui masque sans arreter le calcul
  // laisserait le script mesurer la distance a chaque report, en pure perte.
  verifier('14. ⭐ le calcul de survol s\'arrete des l\'entree de la fonction',
    /if \(!options\.bulleSurvol\) return null;/.test(src), true);
  // Et decocher doit effacer la bulle DEJA affichee.
  verifier('14. decocher efface la bulle deja a l\'ecran',
    /coche\('#agn-r-bulle', 'bulleSurvol', \(\) => \{ survole = null; cacherBulle\(\); \}\)/
      .test(src), true);
  verifier('14. l\'aide explique la superposition et ou decocher',
    /Deux infobulles superpos/.test(src) && /Surlignage sur la carte<\/b>/.test(src), true);
}

// ===========================================================================
// 15. 📖 LA SECTION « REGLES OFFICIELLES » — demandee par l'auteur le 03/08 :
// « il faut integrer dans l'appli, comme l'aide, les regles que ce script
// surveille, et mettre le lien vers les regles officielles vers Discuss ».
//
// ⭐ CE QUE CES TESTS PROTEGENT VRAIMENT : que WNA ne se presente jamais comme
// la source de la norme. La regle vient du guide France, WNA ne fait que
// l'appliquer — donc le lien doit etre la, et la section doit PRECEDER
// « Ce que chaque controle verifie ».
// ===========================================================================
{
  const LIEN = 'waze.com/discuss/t/nommage-des-segments-des-rues-des-routes/375658';
  verifier('15. la section des regles officielles existe',
    /\{ id: 'regles', titre: '📖 Les règles officielles françaises'/.test(src), true);
  verifier('15. ⭐ elle PRECEDE « Ce que chaque controle verifie » (la regle avant le controle)',
    src.indexOf("id: 'regles'") < src.indexOf("id: 'controles'"), true);
  verifier('15. le guide FR est lie depuis la section',
    src.slice(src.indexOf("id: 'regles'"), src.indexOf("id: 'controles'"))
       .indexOf(LIEN) !== -1, true);
  verifier('15. … et depuis le pied de l\'aide',
    /agn-aide-pied[\s\S]{0,400}nommage-des-segments/.test(src), true);
  // ⚠️⚠️ Un lien qui remplace l'onglet ferait quitter WME a l'editeur, avec ses
  // modifications non enregistrees. Et sans `rel="noopener"`, la page ouverte
  // garde une poignee sur l'onglet WME.
  verifier('15. ⚠️⚠️ AUCUN lien de l\'aide ne peut remplacer l\'onglet WME',
    (src.match(/<a href="https:\/\/[^"]+"/g) || []).length,
    (src.match(/<a href="https:\/\/[^"]+"\s*\n?\s*target="_blank" rel="noopener"/g) || []).length);
  // ⭐ L'honnetete du script : ce qu'il NE verifie pas doit etre ecrit. Les
  // angles morts ont ete mesures le 03/08 en rejouant les exemples du guide.
  verifier('15. ⭐ l\'aide dit ce que le script NE verifie PAS',
    /Ce que WNA ne vérifie PAS/.test(src), true);
  verifier('15. ⭐ … dont les cas qui exigent de voir le panneau',
    /ne voit pas les panneaux/.test(src), true);
  // ⚠️ Les deux faux positifs connus sont NOMMES : un editeur qui suivrait le
  // script casserait un nom conforme au guide.
  // ⚠️⚠️ CE TEST A CHANGE DE SENS LE 03/08, ET C'EST NORMAL. Il verifiait que
  // l'aide ANNONCE les deux faux positifs rocade (« A86 - Intérieure » signale
  // a tort). Ils sont corriges en v2.33.00 : le cartouche « Rocade » identifie
  // desormais la voie. L'aide ne doit donc plus les annoncer — mais elle doit
  // expliquer ce qui reste incertain, et comment l'editeur le leve.
  // ⭐ Un bloc « ce que je ne verifie pas » qui garderait un defaut corrige
  // serait aussi trompeur qu'un bloc qui tairait un defaut reel.
  verifier('15. ⚠️ l\'aide n\'annonce plus un defaut CORRIGE',
    /c'est le format exigé/.test(src), false);
  verifier('15. ⭐ … et elle dit ce qui leve le doute : poser le cartouche Rocade',
    /cartouche « Rocade »[\s\S]{0,200}lève l'ambiguïté/.test(src), true);
}

// ===========================================================================
// 16. ⚡ L'AIDE NE PARLE DU ⚡ QU'A CEUX QUI L'ONT — auteur, 03/08 :
// « On peut pas expliquer l'existence du ⚡ à ceux qui n'ont aucune raison de
// voir le ⚡. » La correction automatique est reservee aux L5, L6, Global
// Editors et staff (`droits().autorise`, deja en place pour les boutons).
//
// ⚠️ Sa precision, et elle borne le masquage : « Pour ceux qui n'ont pas le
// niveau, ils voient les problemes, et les suggestions de corrections, ils ne
// peuvent juste pas corriger en auto avec le ⚡. » ⇒ on ne masque QUE ce qui
// decrit l'application automatique. Jamais un ecart, jamais un nom propose.
//
// ⭐ TEST FONCTIONNEL, PAS TEXTUEL : on EXECUTE `sectionsAide()` avec les deux
// profils et on regarde ce qui sort. Un test sur la forme du code laisserait
// passer un ⚡ ajoute demain hors du filtre.
// ===========================================================================
{
  const bloc = extraire('sectionsAide');
  // ⚠️ L'aide interpole des constantes du script (seuils affiches a l'editeur).
  // On les declare a la volee plutot qu'en dur : une constante ajoutee demain
  // ne doit pas casser ce test pour une raison sans rapport avec son objet.
  const constantes = new Set();
  bloc.replace(/\$\{([^}]*)\}/g, (m, x) => {
    (x.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) || []).forEach(k => constantes.add(k));
    return m;
  });
  const sectionsDe = autorise => new Function('autorise', [
    [...constantes].map(k => 'const ' + k + ' = 0;').join('\n'),
    'const droits = () => ({ autorise, niveau: "L5", motifs: [], rangsLus: 1 });',
    'const siCorrecteur = html => (droits().autorise ? html : "");',
    bloc,
    'return sectionsAide();'
  ].join('\n'))(autorise);
  const corpsDe = autorise =>
    sectionsDe(autorise).map(s => s.titre + s.corps).join('\n');
  const sans = corpsDe(false), avec = corpsDe(true);

  // ⚠️ Le TEMOIN d'abord : sans lui, « 0 occurrence » ne prouverait rien — le
  // test passerait aussi si `sectionsAide` ne rendait plus rien du tout.
  verifier('16. ⚡ temoin : un correcteur habilite voit bien le ⚡ explique',
    (avec.match(/⚡/g) || []).length > 0, true);
  verifier('16. ⚡⚡ un editeur NON habilite ne lit AUCUNE mention du ⚡',
    (sans.match(/⚡/g) || []).length, 0);
  verifier('16. ⚠️ … ni la phrase sur le depot de modification dans WME',
    /dépose une modification dans WME/.test(sans), false);

  // ⚠️⚠️ CE QUI NE DOIT PAS DISPARAITRE AVEC : il voit les memes ecarts et les
  // memes propositions. Masquer l'outil, jamais le diagnostic.
  verifier('16. ⭐ il garde les regles officielles',
    /Les règles officielles françaises/.test(sans), true);
  verifier('16. ⭐ il garde le detail de chaque controle',
    /Ce que chaque contrôle vérifie/.test(sans), true);
  verifier('16. ⭐ il garde le dictionnaire et ses noms proposes',
    /dictionnaire communautaire français/.test(sans), true);
  verifier('16. ⭐ il garde la conversion des numeros hors agglo',
    /Proposé à la conversion en POI résidentiel/.test(sans), true);
  // ⚠️ Aucune SECTION ne disparait : c'est le ⚡ qu'on tait, pas un pan de
  // l'aide. Un editeur non habilite doit lire exactement les memes chapitres.
  verifier('16. ⭐ aucune section ne disparait — seul le ⚡ est tu',
    sectionsDe(false).map(s => s.id), sectionsDe(true).map(s => s.id));

  // ⚠️⚠️ Le critere ne doit pas etre REINVENTE : deux modeles d'etat finiraient
  // par diverger, et l'aide promettrait une fonction absente.
  verifier('16. ⚠️⚠️ le filtre s\'appuie sur `droits()`, pas sur un second critere',
    /const siCorrecteur = html => \(droits\(\)\.autorise \? html : ''\);/.test(src), true);
  // ⚠️ Le rang est illisible pendant les premieres secondes : une aide batie a
  // ce moment-la masquerait le ⚡ a un L6 pour TOUTE la session.
  verifier('16. ⚠️⚠️ l\'aide est rebatie si elle a ete construite sans profil lisible',
    /aideBatieAvecProfil && profilLu/.test(src), true);
}

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(60));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
