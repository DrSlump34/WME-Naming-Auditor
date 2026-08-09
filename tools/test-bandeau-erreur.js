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
 * repliee pour que le bandeau se voie. C'est le geste qu'on s'interdit : il
 * RAMENE l'editeur sur un outil qu'il avait range, pour une erreur qui ne nous
 * regarde pas. Troisieme fois que le projet apprend la meme lecon (2.25.01
 * « on avertit la ou l'editeur DECIDE » ; 2.27.11 « on ne touche plus au zoom
 * en cliquant sur les boutons »). NE PAS « re-optimiser » ces tests en croyant
 * rendre le bandeau plus visible : son invisibilite est le but quand la fenetre
 * est rangee.
 *
 * ⚠️⚠️ ET UN RAFFINEMENT RETIRE PAR LA MESURE — a ne pas reintroduire :
 * j'avais conditionne le bandeau a un recouvrement geometrique reel entre la
 * fenetre et la popover (« on ne recopie que ce qu'on masque »). MESURE EN LIVE
 * dans WME le 28/07 : `.save-popover-container` est en
 * `position:absolute; top:911px; left:0` — EN BAS A GAUCHE, quand la fenetre du
 * script se pose en haut a droite. Le recouvrement aurait toujours ete nul : le
 * bandeau ne se serait plus jamais affiche. Un raffinement non mesure qui tuait
 * la fonction qu'il pretendait affiner.
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
 * globales natives : sans un `Math` explicite, `Math.min` sortirait `undefined`
 * et le test echouerait pour une raison qui n'a rien a voir avec le code teste.
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

/* Une fenetre simulee : seuls comptent son display et sa classe de repli. */
function faireOverlay(display, replie) {
  return {
    style: { display: display },
    classList: { contains: c => c === 'agn-replie' && !!replie }
  };
}
function decider(overlay) {
  return monter('fenetreOuvertePourBandeau', { ui: { overlay: overlay } })();
}

/* ------------------------------------------------------------------ */
console.log('\n— Le bandeau ne se rend JAMAIS visible lui-meme');

verifier('⭐⭐ fenetre FERMEE → on se tait (c\'est le defaut signale le 28/07)',
  decider(faireOverlay('none', false)), false);
verifier('⭐ fenetre REPLIEE → on se tait (la deplier serait le geste interdit)',
  decider(faireOverlay('', true)), false);
verifier('fenetre ouverte et depliee → le bandeau a sa place',
  decider(faireOverlay('', false)), true);
verifier('fenetre ouverte mais display explicite → le bandeau a sa place',
  decider(faireOverlay('block', false)), true);
verifier('fenetre a la fois fermee ET repliee → on se tait',
  decider(faireOverlay('none', true)), false);
verifier('interface pas encore construite → rien',
  decider(null), false);

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
verifier('afficherBandeauErreur ne bascule pas le repli',
  /basculerRepli\s*\(/.test(bandeau), false);

const surveille = extraire('surveillerErreursEnregistrement');
verifier('la surveillance passe par le garde-fou de visibilite',
  /fenetreOuvertePourBandeau\s*\(/.test(surveille), true);

/* ⚠️ MESURE DU 28/07 : filtrer sur la geometrie rendrait le bandeau mort,
   la popover ne passant jamais sous la fenetre. Verrou anti-retour. */
verifier('⭐ aucun filtre geometrique n\'est revenu dans la surveillance',
  /getBoundingClientRect/.test(surveille), false);

/* Rouvrir ou deplier la fenetre PENDANT qu'une erreur est affichee est le
   moment ou la recopie devient utile : sans ces deux rappels, le bandeau ne
   sortirait qu'au prochain soubresaut du DOM. */
verifier('ouvrirOverlay redemande un releve',
  /releverErreurSave\s*\(\s*\)/.test(extraire('ouvrirOverlay')), true);
verifier('basculerRepli redemande un releve',
  /releverErreurSave\s*\(\s*\)/.test(extraire('basculerRepli')), true);

/* ------------------------------------------------------------------ */
console.log('\n— La surveillance du DOM reste au minimum utile (09/08)');

/**
 * ⚠️⚠️ 8ᵉ FOIS QUE CE PIEGE MORD, ET IL A MORDU EN ECRIVANT CES LIGNES :
 * `extraire()` rend le corps ENTIER, commentaires compris. Un verrou pose sur
 * tout le corps aurait trouve le mot `characterData` dans le commentaire qui
 * explique son retrait — et aurait declare le retrait rate alors qu'il etait
 * fait. On ne lit donc QUE les options passees a `.observe(...)`.
 */
function optionsObserve(corps) {
  const i = corps.indexOf('.observe(');
  if (i < 0) return '';
  let par = 0, j = corps.indexOf('(', i);
  for (; j < corps.length; j++) {
    if (corps[j] === '(') par++;
    else if (corps[j] === ')') { par--; if (!par) return corps.slice(i, j + 1); }
  }
  return '';
}
const options = optionsObserve(surveille);

/* ⚠️ Sans ce temoin, les deux verrous ci-dessous passeraient au vert sur une
   chaine VIDE le jour ou l'extraction casserait — un controle qui ne regarde
   rien dit toujours oui. */
verifier('l\'extracteur d\'options a bien lu quelque chose',
  options.length > 20 && /document\.body/.test(options), true);

/* ⚠️⚠️ `characterData` a ete retire le 09/08. MESURE : il n'apportait qu'UNE
   mutation sur 29 670, et le cas qu'il couvrait seul (WME reecrit le texte
   d'une popover DEJA posee) est repris par les deux rappels verifies
   ci-dessus. ⇒ Ce verrou n'est pas un verrou de PERFORMANCE — le gain CPU est
   nul et il ne faut pas le presenter autrement. C'est un verrou de SURFACE :
   on n'observe que ce qui sert. Le remettre demanderait de montrer un cas ou
   les deux rappels ne suffisent pas. */
verifier('⭐ la surveillance n\'ecoute plus characterData',
  /characterData/.test(options), false);
verifier('elle ecoute toujours les insertions (c\'est par la que la popover arrive)',
  /childList\s*:\s*true/.test(options), true);

/* ⚠️ Le jour ou quelqu'un voudra restreindre `subtree`, il lui faudra un
   ancetre stable du popover — a MESURER en live, jamais a deviner. Ce test ne
   fige pas `document.body` : il constate seulement que la surveillance existe
   encore, pour qu'un retrait pur et simple ne passe pas inapercu. */
verifier('la surveillance observe toujours quelque chose',
  /\.observe\s*\(/.test(surveille), true);

/* ------------------------------------------------------------------ */
console.log('\n— L\'explication du refus 406 survit a la refonte');

const expliquerRefus = monter('expliquerRefus', {
  RE_REFUS_HN: /num[ée]ro de rue invalide|invalid house ?number|house ?number is invalid/i
});
verifier('message FR de WME → on explique que ce n\'est pas un doublon',
  /pas un doublon/i.test(expliquerRefus('Le lieu a un numéro de rue invalide.')), true);
verifier('message EN de WME → reconnu aussi',
  /pas un doublon/i.test(expliquerRefus('The place has an invalid house number')), true);
verifier('une autre erreur d\'enregistrement → aucune explication inventee',
  expliquerRefus('Impossible d\'enregistrer : segment verrouillé.'), '');

/* ------------------------------------------------------------------ */
console.log('\n— Garde-fou de l\'extracteur lui-meme');

/* ⚠️ Lecon de la v2.26 : un extracteur devenu aveugle rend un verdict qui
   ment (il declarerait « aucun appel a ouvrirOverlay » sur du vide). */
verifier('l\'extracteur lit bien un corps de fonction non vide',
  bandeau.length > 200 && surveille.length > 200, true);
verifier('et il lit bien LE bon corps (le bandeau porte son titre)',
  /WME a refus/.test(bandeau), true);

/* ------------------------------------------------------------------ */
console.log(lignes.join('\n'));
console.log('\n' + ok + ' ok, ' + ko + ' echec(s)\n');
process.exit(ko ? 1 : 0);
