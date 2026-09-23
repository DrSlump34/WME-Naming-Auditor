/**
 * Tests des SECTEURS DECLARES HAMEAU — v2.49.00.
 *
 * ⚠️⚠️ POURQUOI CE FICHIER EXISTE : le schema 2 (vote t411162, 6-0, clos le
 * 14/09/2026) est ecrit dans le wiki « Nommage des segments » depuis la v52 du
 * 23/09 : « Les panneaux EB10/EB20 ne suffisent pas a faire d'un lieu une
 * agglomeration. Un hameau ou un lieu-dit reste hors agglomeration, meme equipe
 * de panneaux. » Jusqu'a la 2.48, WNA tenait tout secteur d'entrees non couvert
 * pour une agglomeration OUBLIEE et poussait a l'entourer.
 *
 * Ce banc eprouve le PANNEAU DE VIGILANCE de fin de zonage, la ou l'editeur
 * tranche : chaque secteur libre porte « C'est un hameau », chaque hameau
 * declare porte « Annuler », et le clic change bien l'etat.
 * ⚠️ Fonctions EXTRAITES du userscript, jamais recopiees. DOM minimal, sans
 * dependance (meme principe que `test-ui-sections.js`).
 *
 * Usage : node tools/test-hameaux.js
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
function verifier(t, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + t); }
  else { ko++; lignes.push('  ECHEC ' + t + '\n          attendu ' +
    JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
function titre(t) { lignes.push('\n' + t); }

/** Un noeud minimal : innerHTML, enfants, title, onclick. */
function el(html) {
  const m = html.match(/^<(\w+)[^>]*>([\s\S]*?)<\/\1>$/);
  return { html, innerHTML: m ? m[2] : '', enfants: [], title: '', onclick: null,
           appendChild(c) { this.enfants.push(c); return c; } };
}
const tout = n => [n].concat(...n.enfants.map(tout));
const texte = n => tout(n).map(x => x.innerHTML).join(' ');
const boutons = n => tout(n).filter(x => /^<button/.test(x.html));

const distance = src.match(/const distanceM = \(a, b\) => [\s\S]*?\);\n/)[0];
const tol = src.match(/const TOLERANCE_HAMEAU_M = \d+;/)[0];

/** Monte les fonctions du panneau avec un etat donne. */
function monter(etat) {
  const e = Object.assign({ agglos: {}, hameaux: {}, sansAgglo: {}, secteurs: [],
    commune: { code: '56162', nom: 'Ploemeur' }, sondage: null, releveFait: true }, etat);
  let sauvegardes = 0, rendus = 0;
  const f = new Function('el', 'esc', 'agglos', 'hameaux', 'sansAgglo', 'secteursCourants',
    'communeActive', 'sondageCourant', 'releveFait', 'pointInRing', 'sauverPrefs', 'renderAgglos',
    distance + tol +
    extraire('secteurCouvert') + extraire('secteurHameau') + extraire('secteurTranche') +
    extraire('declarerHameau') + extraire('ajouterHameauxDeclares') +
    extraire('avertissementExhaustivite') +
    '\nreturn { avertissementExhaustivite, secteurTranche };');
  const api = f(el, s => String(s), e.agglos, e.hameaux, e.sansAgglo, e.secteurs, e.commune,
    () => e.sondage, e.releveFait, () => false,
    () => { sauvegardes++; }, () => { rendus++; });
  return Object.assign(api, { e, compte: () => ({ sauvegardes, rendus }) });
}

const S1 = { nom: 'Ploemeur', g: { centre: { lon: -3.4260, lat: 47.7360 }, portes: 6 } };
const S2 = { nom: 'Lomener', g: { centre: { lon: -3.4300, lat: 47.7050 }, portes: 3 } };

titre('Un secteur libre porte « C\'est un hameau », et le clic le tranche');
{
  const m = monter({ secteurs: [S1, S2] });
  const n = m.avertissementExhaustivite();
  verifier('1. les deux secteurs sont annoncés à trancher', /2 secteur\(s\)/.test(n.innerHTML), true);
  verifier('2. la règle est dite : hameau ⇒ hors agglomération même avec des panneaux',
    /hameau ou lieu-dit<\/b> ⇒ il reste hors agglomération, même avec des panneaux/.test(n.innerHTML), true);
  verifier('3. un bouton « C\'est un hameau » par secteur',
    boutons(n).map(b => b.innerHTML), ["C\\'est un hameau", "C\\'est un hameau"].map(x => x.replace('\\', '')));
  verifier('4. l\'arbitre du doute est LC ou CM (plus le SM/RM)',
    /Local Champ<\/b> ou un <b>Country Manager/.test(texte(n)) && !/Regional Manager/.test(texte(n)), true);
  boutons(n)[1].onclick();
  verifier('5. ⭐ clic sur Lomener ⇒ déclaré hameau, sauvé, redessiné',
    [m.e.hameaux['56162'].length, m.compte().sauvegardes, m.compte().rendus], [1, 1, 1]);
  verifier('6. Lomener est désormais tranché, Ploemeur non',
    [m.secteurTranche(S2.g), m.secteurTranche(S1.g)], [true, false]);
  const n2 = m.avertissementExhaustivite();
  verifier('7. le panneau ne réclame plus que Ploemeur', /1 secteur\(s\)/.test(n2.innerHTML), true);
  verifier('8. ⭐ et le hameau déclaré reste VISIBLE, avec « Annuler »',
    [/1 secteur\(s\) déclaré\(s\) hameau/.test(texte(n2)), boutons(n2).map(b => b.innerHTML).includes('Annuler')],
    [true, true]);
}

titre('Tout est tranché : le panneau doux garde la liste des hameaux');
{
  const m = monter({ secteurs: [S1, S2],
    agglos: { '56162': [{ ring: [[0, 0]] }] },
    hameaux: { '56162': [{ lon: -3.4300, lat: 47.7050 }] } });
  // Ploemeur « couvert » : on force la couverture par un anneau qui le contient.
  const m2 = monter({ secteurs: [S2], hameaux: { '56162': [{ lon: -3.4300, lat: 47.7050 }] } });
  const n = m2.avertissementExhaustivite();
  verifier('9. aucun secteur libre ⇒ message « tranchés (polygone ou hameau) »',
    /tranchés \(polygone ou hameau\)/.test(n.innerHTML), true);
  verifier('10. ⭐ la liste des hameaux y est, avec « Annuler »',
    boutons(n).map(b => b.innerHTML), ['Annuler']);
  boutons(n)[0].onclick();
  verifier('11. ⭐ « Annuler » retire la déclaration (liste VIDE gardée pour la fusion)',
    [Array.isArray(m2.e.hameaux['56162']), m2.e.hameaux['56162'].length], [true, 0]);
  verifier('12. … et le secteur redevient à trancher', m2.secteurTranche(S2.g), false);
  void m;
}

titre('Aucun secteur relevé : le rappel ne réclame plus les hameaux');
{
  const m = monter({ secteurs: [], releveFait: false });
  const n = m.avertissementExhaustivite();
  verifier('13. ⭐ « pas les hameaux, même panneautés »', /pas les hameaux, même/.test(n.innerHTML), true);
  verifier('14. ⚠️ et plus aucune trace de « bourg, hameaux, villages rattachés »',
    /bourg, hameaux, villages rattachés/.test(n.innerHTML), false);
}

titre('Aucun texte ne renvoie plus l\'arbitrage au State ou Regional Manager');
{
  // ⚠️ Hors commentaires : un commentaire qui cite l'ancienne regle n'est pas du texte affiche.
  const code = src.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  verifier('15. ⭐ « Regional Manager » absent du code affiché',
    (code.match(/Regional Manager/g) || []).length, 0);
  verifier('16. « hameau séparément » absent (le pré-tracé ne réclame plus les hameaux)',
    (code.match(/hameau séparément|hameaux séparément/g) || []).length, 0);
}

titre('⚠️ v2.49.01 — sans polygone, les hameaux déclarés restent visibles');
{
  // La sortie « Aucune agglomération tracée » de `renderAgglos` ne passe pas par
  // le panneau de vigilance : sans ce branchement, « C'est un hameau » puis
  // « Tout arrêter » laissait une déclaration invisible, donc inannulable.
  const r = extraire('renderAgglos');
  // ⚠️ La fin se cherche APRES le debut : `renderAgglos` a d'autres sorties
  // `majGuidage(); return;` plus haut, et la premiere donnait une tranche vide.
  const debut = r.indexOf('if (!liste.length) {');
  const vide = r.slice(debut, r.indexOf('majGuidage();\n      return;', debut));
  verifier('17. (garde-fou du test) la tranche lue est bien la branche vide',
    /Aucune agglomération tracée/.test(vide), true);
  verifier('17. ⭐ la branche « aucune agglomération » liste les hameaux déclarés',
    /ajouterHameauxDeclares\(/.test(vide), true);
}

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log(ok + ' verifications OK, ' + ko + ' ECHEC(S)');
process.exit(ko ? 1 : 0);
