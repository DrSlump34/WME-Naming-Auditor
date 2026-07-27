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

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(60));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
