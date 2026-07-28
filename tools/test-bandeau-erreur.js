/**
 * Tests du bandeau qui recopie une erreur d'enregistrement de WME (v2.27.12).
 *
 * ⚠️⚠️ CE QUE CES TESTS PROTEGENT — C'EST UN TEST DE VOLONTE, PAS DE CALCUL :
 *
 * Signale par l'auteur le 28/07 : « lorsque WME genere une erreur a
 * l'enregistrement, SANS que le script soit implique, ca ouvre systematiquement
 * l'overlay. C'est tres chiant. »
 *
 * Le mecanisme d'origine rouvrait la fenetre fermee et depliait la fenetre
 * repliee pour que le bandeau se voie. Or la recopie ne se justifie QUE parce
 * que notre fenetre cache la popover de WME (ancree en haut a DROITE). Fenetre
 * fermee : elle ne cache rien, la popover est lisible, on n'a rien a apporter —
 * et la rouvrir RAMENE l'editeur sur un outil qu'il avait range.
 *
 * ⇒ C'est la troisieme fois que le projet apprend la meme lecon (2.25.01 :
 *   « on avertit la ou l'editeur DECIDE » ; 2.27.11 : « on ne touche plus au
 *   zoom en cliquant sur les boutons »). NE PAS « re-optimiser » ces tests en
 *   croyant rendre le bandeau plus visible : son invisibilite est le but quand
 *   il n'a rien a apporter.
 *
 * ⚠️ Fonctions EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-bandeau-erreur.js
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

/**
 * ⚠️ Le `with` sur un Proxy qui repond « je connais tout » masque AUSSI les
 * globales natives : sans ce `Math` explicite, `Math.min` sort `undefined` et
 * le test echoue pour une raison qui n'a rien a voir avec le code teste.
 */
function monter(nom, connus) {
  const bac = new Proxy(Object.assign({ Math: Math }, connus || {}), {
    has: () => true,
    get: (t, k) => (k === Symbol.unscopables ? undefined : t[k])
  });
  return new Function('__bac', 'with(__bac){' + extraire(nom) + ';return ' + nom + ';}')(bac);
}

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else {
    ko++; lignes.push('  ECHEC ' + titre + '\n          attendu ' +
      JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu));
  }
}

/* Un rectangle facon `getBoundingClientRect`. */
function rect(x, y, w, h) {
  return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h };
}

/* ------------------------------------------------------------------ */
console.log('\n— La geometrie : recouvre-t-on la popover ?');

const masqueLaPopover = monter('masqueLaPopover');

// La situation reelle mesuree en live le 21/07 : la popover de WME est ancree
// en haut a DROITE, et la fenetre du script s'y pose par defaut.
const POPOVER = rect(1450, 60, 420, 120);

verifier('fenetre posee dessus (cas du 21/07) → on masque',
  masqueLaPopover(rect(1440, 40, 400, 560), POPOVER), true);
verifier('fenetre rangee a gauche de l\'ecran → on ne masque rien',
  masqueLaPopover(rect(20, 40, 400, 560), POPOVER), false);
verifier('fenetre plus bas que la popover → on ne masque rien',
  masqueLaPopover(rect(1440, 400, 400, 300), POPOVER), false);
verifier('chevauchement d\'un seul coin → on masque quand meme',
  masqueLaPopover(rect(1860, 170, 400, 560), POPOVER), true);
verifier('bords qui se touchent sans se recouvrir → non',
  masqueLaPopover(rect(1870, 60, 400, 560), POPOVER), false);
verifier('popover de hauteur nulle (en cours d\'apparition) → non',
  masqueLaPopover(rect(1440, 40, 400, 560), rect(1450, 60, 420, 0)), false);
verifier('pas de popover du tout → non',
  masqueLaPopover(rect(1440, 40, 400, 560), null), false);
verifier('pas de fenetre → non',
  masqueLaPopover(null, POPOVER), false);

/* ------------------------------------------------------------------ */
console.log('\n— La decision : le bandeau ne se rend JAMAIS visible lui-meme');

/* On rejoue `notreFenetreMasqueLaPopover` sur une fenetre simulee. Les rects
   viennent de `getBoundingClientRect`, qu'on fournit. */
function faireOverlay({ display, replie, r }) {
  return {
    style: { display: display },
    classList: { contains: c => c === 'agn-replie' && !!replie },
    getBoundingClientRect: () => r
  };
}
function decider(etat) {
  const fn = monter('notreFenetreMasqueLaPopover', {
    ui: { overlay: etat.overlay },
    masqueLaPopover: masqueLaPopover
  });
  return fn(etat.pop);
}
const POP_DOM = { getBoundingClientRect: () => POPOVER };
const SUR_LA_POPOVER = rect(1440, 40, 400, 560);

verifier('⭐ fenetre FERMEE → on se tait (elle ne cachait rien)',
  decider({ overlay: faireOverlay({ display: 'none', r: SUR_LA_POPOVER }), pop: POP_DOM }),
  false);
verifier('⭐ fenetre REPLIEE → on se tait (la deplier serait le geste interdit)',
  decider({ overlay: faireOverlay({ display: '', replie: true, r: SUR_LA_POPOVER }), pop: POP_DOM }),
  false);
verifier('fenetre ouverte MAIS ailleurs sur l\'ecran → on se tait',
  decider({ overlay: faireOverlay({ display: '', r: rect(20, 40, 400, 560) }), pop: POP_DOM }),
  false);
verifier('fenetre ouverte ET posee dessus → on recopie',
  decider({ overlay: faireOverlay({ display: '', r: SUR_LA_POPOVER }), pop: POP_DOM }),
  true);
verifier('aucune popover affichee → rien a recopier',
  decider({ overlay: faireOverlay({ display: '', r: SUR_LA_POPOVER }), pop: null }),
  false);
verifier('interface pas encore construite → rien',
  decider({ overlay: null, pop: POP_DOM }), false);

/* ------------------------------------------------------------------ */
console.log('\n— Les verrous de SOURCE (ce sont eux qui figent la volonte)');

/* ⚠️ Ces verrous valent mieux qu'un test de comportement : le defaut signale
   n'etait pas un mauvais calcul, c'etaient DEUX APPELS. Tant qu'ils ne
   reviennent pas dans ce chemin, il ne peut pas revenir. */
const bandeau = extraire('afficherBandeauErreur');

verifier('⭐⭐ afficherBandeauErreur n\'appelle plus ouvrirOverlay()',
  /ouvrirOverlay\s*\(/.test(bandeau), false);
verifier('⭐⭐ afficherBandeauErreur ne clique plus sur #agn-reduire',
  /agn-reduire/.test(bandeau), false);
verifier('afficherBandeauErreur ne touche pas au display de la fenetre',
  /style\.display\s*=/.test(bandeau), false);

const surveille = extraire('surveillerErreursEnregistrement');
verifier('la surveillance passe par le garde-fou de recouvrement',
  /notreFenetreMasqueLaPopover\s*\(/.test(surveille), true);

/* Rouvrir ou deplier la fenetre PENDANT qu'une erreur est affichee est le
   moment ou la recopie devient utile : sans ces deux rappels, le bandeau ne
   sortirait qu'au prochain soubresaut du DOM. */
verifier('ouvrirOverlay redemande un releve',
  /releverErreurSave\s*\(\s*\)/.test(extraire('ouvrirOverlay')), true);
verifier('basculerRepli redemande un releve',
  /releverErreurSave\s*\(\s*\)/.test(extraire('basculerRepli')), true);

/* ------------------------------------------------------------------ */
console.log('\n— Garde-fou de l\'extracteur lui-meme');

/* ⚠️ Lecon de la v2.26 : un extracteur devenu aveugle rend un verdict qui
   ment (il declarerait « aucun appel a ouvrirOverlay » sur du vide). On
   verifie donc qu'il lit encore quelque chose. */
verifier('l\'extracteur lit bien un corps de fonction non vide',
  bandeau.length > 200 && surveille.length > 200, true);
verifier('et il lit bien LE bon corps (le bandeau porte son titre)',
  /WME a refus/.test(bandeau), true);

/* ------------------------------------------------------------------ */
console.log(lignes.join('\n'));
console.log('\n' + ok + ' ok, ' + ko + ' echec(s)\n');
process.exit(ko ? 1 : 0);
