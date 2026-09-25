/**
 * FENETRE BORNEE A LA CARTE : glissement, redimensionnement, volet (audit du 25/09/2026).
 *
 * La charte commune veut la fenetre rangee entre le panneau lateral de WME, la colonne des boutons
 * de carte et le pied de page — comme WPEU. WNA laissait la fenetre sortir au glissement
 * (jusqu'a 120 px visibles), ne bornait pas la poignee de redimensionnement, et placait le volet
 * contre l'ECRAN.
 *
 * `bornerFenetre` et `positionVolet` sont EXTRAITES du userscript. `bornerFenetre` doit rester
 * le MEME calcul que celui de WPEU (compare ligne a ligne, espaces normalises).
 * Temoin : l'ancienne formule de glissement laisse la fenetre passer sous les boutons de carte.
 *
 * Usage : node tools/test-fenetre-bornee.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(process.argv[2] || 'WME-Naming-Auditor.user.js', 'utf8');

function extraire(s, nom) {
  const i = s.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let prof = 0, j = s.indexOf('{', i);
  for (; j < s.length; j++) {
    if (s[j] === '{') prof++;
    else if (s[j] === '}') { prof--; if (!prof) break; }
  }
  return s.slice(i, j + 1);
}
const charger = (s, nom) => new Function(extraire(s, nom) + '\nreturn ' + nom + ';')();

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}

// Des bornes mesurees dans WME (panneau lateral ouvert, colonne de boutons a droite).
const Z = { gauche: 272, haut: 56, droite: 1830, bas: 1040 };
const borner = charger(src, 'bornerFenetre');
const volet = charger(src, 'positionVolet');
const geo = g => [g.x, g.y, g.w, g.h];

console.log('\n=== bornerFenetre ===');
verifier('une fenetre qui tient ne bouge pas', borner({ x: 900, y: 100, w: 420, h: 600 }, Z).tenait, true);
verifier('tiree sous les boutons de carte : rangee a leur gauche', geo(borner({ x: 1700, y: 100, w: 420, h: 600 }, Z)), [1410, 100, 420, 600]);
verifier('tiree sur le panneau de WME : rangee au bord de la carte', borner({ x: 100, y: 100, w: 420, h: 600 }, Z).x, 272);
verifier('tiree sur le pied de page : remontee', borner({ x: 900, y: 800, w: 420, h: 600 }, Z).y, 440);
verifier('plus haute que la carte : ramenee a la carte', borner({ x: 900, y: 56, w: 420, h: 5000 }, Z).h, 984);
verifier('carte etroite : le plancher de 280 px ne la fait pas sortir',
         borner({ x: 0, y: 0, w: 420, h: 600 }, { gauche: 10, haut: 10, droite: 210, bas: 800 }).w, 200);

console.log('\n=== Meme calcul que WPEU ===');
const wpeu = path.join(__dirname, '..', '..', 'WME-POI-Event-Updater', 'WME_POI_Event_Updater.user.js');
if (!fs.existsSync(wpeu)) { console.log('  ~~    WPEU absent de ce poste : comparaison sautee'); }
else {
  const corps = s => extraire(s, 'bornerFenetre').split('\n')
    .map(l => l.trim()).filter(l => /^const (dispoL|dispoH|largeur|hauteur|x|y) =/.test(l))
    .map(l => l.replace(/\s+/g, ' '));
  const a = corps(src), b = corps(fs.readFileSync(wpeu, 'utf8'));
  verifier('les six lignes du calcul sont identiques a WPEU', [a.length, a], [6, b]);
}

console.log('\n=== positionVolet ===');
verifier('la place a gauche : volet a gauche de la fenetre',
         volet({ left: 900, right: 1320, top: 60, height: 700 }, Z, 300, 8).left, 592);
verifier('pas la place a gauche (panneau WME) : a droite',
         volet({ left: 400, right: 820, top: 60, height: 700 }, Z, 300, 8).left, 828);
verifier('place nulle part : au bord gauche de la carte, jamais sur WME ni sous les boutons',
         volet({ left: 300, right: 1800, top: 60, height: 700 }, Z, 300, 8).left, 272);
verifier('la hauteur ne passe pas le pied de page',
         volet({ left: 900, right: 1320, top: 600, height: 700 }, Z, 300, 8).height, 440);

console.log('\n=== Branchements ===');
verifier('le glissement passe par bornerFenetre',
         /const g = bornerFenetre\(\{ x: e\.clientX - drag\.dx, y: e\.clientY - drag\.dy,/.test(src), true);
verifier('le redimensionnement est ramene a la carte',
         /r\.right > z\.droite \+ 1\) o\.style\.width/.test(src) && /r\.bottom > z\.bas \+ 1\) o\.style\.height/.test(src), true);
verifier('le volet se place par positionVolet et les bornes de la carte',
         /positionVolet\(ui\.overlay\.getBoundingClientRect\(\), bornesCarte\(\), 300, 8\)/.test(src), true);
verifier('plus aucune formule a 120 px / 40 px', /z\.droite - 120|z\.bas - 40/.test(src), false);

console.log('\n=== Temoin ===');
// La borne de droite de la 2.49.04 (`z.droite - 120`) greffee dans le vrai calcul.
const fn = extraire(src, 'bornerFenetre');
const mutant = fn.replace('Math.min(geo.x, bornes.droite - largeur)', 'Math.min(geo.x, bornes.droite - 120)');
if (mutant === fn) { ko++; console.log('  ECHEC temoin introuvable'); }
else verifier('TEMOIN : avec la borne a 120 px, la fenetre passe 290 px sous les boutons',
  (g => g.x + g.w - Z.droite)(new Function(mutant + '\nreturn bornerFenetre;')()({ x: 1700, y: 100, w: 420, h: 600 }, Z)), 290);

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
