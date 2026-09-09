/**
 * TRADUIRE A LA SORTIE — la fonction qui porte toute l'i18n de l'interface.
 *
 * ⭐⭐ POURQUOI CE HARNAIS EXISTE : le choix du 09/09 est de ne PAS envelopper
 * les ~1 100 chaines du script dans `tr()`, mais de traduire le DOM produit.
 * Tout repose donc sur UNE fonction. Si elle derape, ce n'est pas une phrase
 * qui tombe : c'est l'interface entiere.
 *
 * ⚠️ C'est aussi pour ca que `traduireDOM` n'emploie PAS `TreeWalker` : une
 * recursion sur `childNodes` fait la meme chose et se rejoue ici, sur un DOM
 * de papier, sans navigateur et sans dependance. Une fonction d'interface
 * qu'aucun harnais ne peut atteindre se verifie a l'oeil, c'est-a-dire pas.
 *
 * 🔴 LA PROPRIETE CRITIQUE EST LA n° 8 : la fonction ne change JAMAIS la
 * structure du document. C'est elle qui garantit que l'observateur de
 * mutations ne se declenche pas lui-meme — sans elle, il y aurait une boucle
 * infinie dans le navigateur de chaque editeur italien.
 *
 * Usage : node tools/test-traduire-dom.js
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

function extraire(nom) {
  const i = src.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let n = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') n++;
    else if (src[j] === '}') { n--; if (!n) { j++; break; } }
  }
  return src.slice(i, j);
}

// La liste des attributs est LUE dans le script, pas recopiee : si quelqu'un
// en ajoute un, le test le prend en compte tout seul.
const mAttrs = src.match(/const ATTRS_VISIBLES = (\[[^\]]*\]);/);
if (!mAttrs) throw new Error('ATTRS_VISIBLES introuvable');
const ATTRS = JSON.parse(mAttrs[1].replace(/'/g, '"'));

/** La fonction du script, montee avec le dictionnaire et la langue voulus. */
function monter(TEXTES, LANGUE) {
  return new Function('TEXTES', 'LANGUE', 'ATTRS_VISIBLES',
    extraire('traduireDOM') + '\nreturn traduireDOM;')(TEXTES, LANGUE, ATTRS);
}

// ── Un DOM de papier : juste ce que la fonction touche ───────────────────────
function texte(v) { return { nodeType: 3, nodeValue: v }; }
function commentaire(v) { return { nodeType: 8, nodeValue: v }; }
function elem(tag, attrs, enfants) {
  const a = Object.assign({}, attrs || {});
  const n = {
    nodeType: 1, tag, _a: a, childNodes: enfants || [],
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(a, k) ? a[k] : null; },
    setAttribute(k, v) { a[k] = v; },
    // ⚠️ `innerHTML` est ici une PROPRIETE CALCULEE, pas un champ : la fonction
    //    la lit pour chercher une cle de bloc, puis l'ECRIT pour poser la
    //    traduction. Un DOM de papier qui se contenterait d'un champ inerte
    //    laisserait passer une fonction qui n'ecrit nulle part.
    _html: null
  };
  Object.defineProperty(n, 'innerHTML', {
    get() {
      if (n._html !== null) return n._html;
      return (n.childNodes || []).map(c =>
        c.nodeType === 3 ? c.nodeValue :
        c.nodeType === 1 ? '<' + c.tag + '>' + c.innerHTML + '</' + c.tag + '>' : ''
      ).join('');
    },
    set(v) { n._html = v; n.childNodes = [texte(v)]; }
  });
  return n;
}
/** Empreinte de la STRUCTURE seule — les valeurs n'y entrent pas. */
function forme(n) {
  if (!n) return '·';
  if (n.nodeType !== 1) return String(n.nodeType);
  return n.tag + '(' + (n.childNodes || []).map(forme).join(',') + ')';
}
function textes(n, out) {
  out = out || [];
  if (!n) return out;
  if (n.nodeType === 3) out.push(n.nodeValue);
  else (n.childNodes || []).forEach(c => textes(c, out));
  return out;
}

const DICO = {
  it: {
    'Analyser la commune': 'Analizza il comune',
    'Segments': 'Segmenti',
    'Données de référence': 'Dati di riferimento',
    'Réduire': 'Riduci',
    'Filtrer une province…': 'Filtra una provincia…'
  },
  // 🔴 CE DICTIONNAIRE FRANCAIS N'EST PAS UN DECOR — il rend le contrôle
  // n° 12 DISCRIMINANT, et il a fallu une mutation pour s'en apercevoir.
  // Sans lui, « en français rien n'est traduit » passait pour une bonne
  // nouvelle alors que c'est `TEXTES.fr` qui est absent du script : supprimer
  // la garde `LANGUE === 'fr'` laissait le test VERT. Le vrai enjeu de cette
  // garde est le coût — aucun parcours de DOM, aucun observateur, pour
  // l'immense majorité des éditeurs, qui sont français. Avec ce dico-ci, la
  // garde est la SEULE chose qui peut faire passer le contrôle.
  fr: { 'Analyser la commune': 'CETTE VALEUR NE DOIT JAMAIS S\'AFFICHER' },
  xx: null
};

let ok = 0, ko = 0;
function v(titre, obtenu, attendu) {
  if (JSON.stringify(obtenu) === JSON.stringify(attendu)) { ok++; return; }
  ko++;
  console.log('  ECHEC ' + titre +
    '\n         attendu ' + JSON.stringify(attendu) +
    '\n         obtenu  ' + JSON.stringify(obtenu));
}

const trIt = monter(DICO, 'it');
const trFr = monter(DICO, 'fr');

// 1. Un texte connu est traduit.
{
  const n = elem('button', {}, [texte('Analyser la commune')]);
  trIt(n);
  v('1. un texte du dictionnaire est traduit', textes(n), ['Analizza il comune']);
}
// 2. Un texte inconnu est laisse INTACT — la fonction ne peut pas degrader.
{
  const n = elem('div', {}, [texte('Une phrase que personne n\'a traduite')]);
  trIt(n);
  v('2. ⭐ un texte absent du dictionnaire reste intact', textes(n),
    ['Une phrase que personne n\'a traduite']);
}
// 3. Les espaces d'origine sont gardes : « Segments <span> » ne doit pas coller.
{
  const n = elem('button', {}, [texte('  Segments  ')]);
  trIt(n);
  v('3. ⭐ les espaces autour sont preserves', textes(n), ['  Segmenti  ']);
}
// 3 bis. ⭐ Une phrase coupee par l'indentation du TEMPLATE se retrouve quand
//        meme : la cle du dictionnaire s'ecrit sur une ligne, le HTML non.
{
  const DICO2 = { it: { 'Délimite la zone bâtie — entre les panneaux d’entrée et de sortie.':
                        'Delimita il centro abitato — tra i cartelli di ingresso e di uscita.' } };
  const n = elem('div', {}, [texte('\n      Délimite la zone bâtie — entre les panneaux\n' +
                                   '                d’entrée et de sortie.\n    ')]);
  monter(DICO2, 'it')(n);
  v('3 bis. ⭐ une clé sur une ligne traduit un texte indenté sur plusieurs',
    textes(n)[0].trim(),
    'Delimita il centro abitato — tra i cartelli di ingresso e di uscita.');
}

// 4. Les attributs qui s'affichent.
{
  const n = elem('input', { title: 'Réduire', placeholder: 'Filtrer une province…',
                            'data-s': 'Segments' }, []);
  trIt(n);
  v('4. title traduit', n.getAttribute('title'), 'Riduci');
  v('5. placeholder traduit', n.getAttribute('placeholder'), 'Filtra una provincia…');
  v('6. ⚠️ un attribut NON visible n\'est pas touche', n.getAttribute('data-s'), 'Segments');
}
// 7. La recursion descend, et l'element racine est traite lui aussi.
{
  const n = elem('div', { title: 'Réduire' }, [
    elem('span', {}, [elem('b', {}, [texte('Données de référence')])]),
    commentaire('Segments'),
    texte('Segments')
  ]);
  trIt(n);
  v('7. la traduction descend en profondeur', textes(n), ['Dati di riferimento', 'Segmenti']);
  v('8. l\'element RACINE est traite aussi', n.getAttribute('title'), 'Riduci');
  v('9. ⚠️ un commentaire n\'est pas traduit', n.childNodes[1].nodeValue, 'Segments');
}
// 10. 🔴 LA PROPRIETE CRITIQUE : la structure ne bouge pas.
{
  const n = elem('div', {}, [
    elem('span', {}, [texte('Segments')]),
    elem('span', {}, [texte('Analyser la commune'), elem('i', {}, [texte('Réduire')])])
  ]);
  const avant = forme(n), avantN = textes(n).length;
  trIt(n);
  v('10. 🔴 la structure du document est INCHANGEE — pas de boucle possible',
    forme(n), avant);
  v('11. … et le nombre de nœuds texte aussi', textes(n).length, avantN);
}
// 12. En francais, la fonction ne fait RIEN.
{
  const n = elem('button', { title: 'Réduire' }, [texte('Analyser la commune')]);
  trFr(n);
  v('12. ⭐ en francais, aucun texte n\'est touche', textes(n), ['Analyser la commune']);
  v('13. … ni aucun attribut', n.getAttribute('title'), 'Réduire');
}
// 14. Une langue declaree mais sans dictionnaire ne casse pas.
{
  const n = elem('div', {}, [texte('Analyser la commune')]);
  monter(DICO, 'xx')(n);
  v('14. une langue sans dictionnaire ne casse rien', textes(n), ['Analyser la commune']);
}
// 15. Les cas vides.
v('15. une racine nulle est rendue telle quelle', trIt(null), null);
v('16. la racine est RENDUE, pour pouvoir chainer', trIt(elem('i', {}, [])).tag, 'i');

// ── LE BLOC AVANT LE FRAGMENT (v2.43) ───────────────────────────────────────
// 🔴 CE QUE CES CAS PROTEGENT : dans l'aide, une phrase est coupee par ses
// `<b>`. Traduire les morceaux un par un ne peut pas marcher — l'italien ne les
// remet pas dans cet ordre. La cle est donc le HTML interne de l'element, et la
// traduction porte son propre balisage.
{
  const DICO3 = { it: {
    'Un numéro de route (<b>Dxxx</b>) doit porter son écusson.':
      'Un numero di strada (<b>SS</b>) deve portare il suo scudetto.',
    'Segments': 'Segmenti'
  } };
  const tr3 = monter(DICO3, 'it');
  const cellule = elem('td', {}, [
    texte('Un numéro de route ('), elem('b', {}, [texte('Dxxx')]),
    texte(') doit porter son écusson.')
  ]);
  tr3(cellule);
  v('20. ⭐⭐ un BLOC coupé par ses balises se traduit en entier',
    cellule.innerHTML, 'Un numero di strada (<b>SS</b>) deve portare il suo scudetto.');
  v('21. 🔴 … et il est MARQUÉ, sinon l\'observateur le reprendrait sans fin',
    cellule.getAttribute('data-agn-tr'), '1');

  // Un element deja marque ne doit plus etre visite du tout.
  const dejaFait = elem('p', { 'data-agn-tr': '1' }, [texte('Segments')]);
  tr3(dejaFait);
  v('22. 🔴 un élément déjà traduit n\'est pas repris', textes(dejaFait), ['Segments']);

  // Le bloc l'emporte sur le fragment : sinon « Segments » serait traduit
  // d'abord et le bloc ne se reconnaitrait plus.
  const DICO4 = { it: { '<b>Segments</b> et le reste': 'IL BLOC', 'Segments': 'NON' } };
  const p = elem('p', {}, [elem('b', {}, [texte('Segments')]), texte(' et le reste')]);
  monter(DICO4, 'it')(p);
  v('23. ⭐ le BLOC est tenté AVANT les fragments qu\'il contient',
    p.innerHTML, 'IL BLOC');

  // Un bloc absent du dictionnaire laisse les fragments suivre leur chemin.
  const q = elem('p', {}, [texte('Segments')]);
  tr3(q);
  v('24. ⚠️ sans clé de bloc, les nœuds texte sont traduits normalement',
    textes(q), ['Segmenti']);
}

// 17. 🔴 L'observateur n'ecoute QUE `childList` — la contrepartie de la n° 10.
{
  const obs = extraire('observerTraduction');
  v('17. 🔴 l\'observateur n\'ecoute que childList (pas d\'attributes ni characterData)',
    /observe\(racine, \{ childList: true, subtree: true \}\)/.test(obs) &&
    !/attributes\s*:\s*true/.test(obs) && !/characterData\s*:\s*true/.test(obs), true);
  v('18. … et il ne demarre pas en francais',
    /if \(LANGUE === 'fr' \|\| !racine\) return null;/.test(obs), true);
}
// 19. Le branchement : l'ossature est traduite AVANT d'etre observee, sinon
//     rien ne la signalerait jamais (elle existe deja quand on observe).
v('19. ⭐ buildOverlay traduit l\'ossature PUIS observe',
  /traduireDOM\(o\);\s*\n\s*observerTraduction\(o\);/.test(src), true);

console.log((ko ? '\n' : '') + ok + ' verifications OK, ' + ko + ' ECHEC(S)');
process.exit(ko ? 1 : 0);
