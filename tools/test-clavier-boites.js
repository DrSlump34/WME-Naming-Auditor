/**
 * CLAVIER DES BOITES DE DIALOGUE (audit du 25/09/2026, charte n°25).
 *
 * Les trois boites (propositions d'agglomeration, saisie d'un nom, choix du principal) coupaient
 * TOUTES les frappes : Ctrl+S etait avale, Echap ne fermait rien.
 * Attendu : Ctrl/Cmd/Alt passent hors d'un champ de saisie ; Echap declenche la sortie ; le reste
 * ne part pas dans WME.
 *
 * `isolerClavier` est EXTRAITE du userscript, sur une boite simulee.
 * Temoin : la version d'avant (tout couper) avale Ctrl+S.
 *
 * Usage : node tools/test-clavier-boites.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
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

/** Pose `isolerClavier` sur une fausse boite ; rend une fonction qui joue une frappe. */
function monter(fn) {
  const ecouteurs = {}, sorties = [];
  const boite = { addEventListener: (t, f) => { (ecouteurs[t] = ecouteurs[t] || []).push(f); } };
  new Function(fn + '\nreturn isolerClavier;')()(boite, () => sorties.push('annuler'));
  return (type, touche, mods, cible) => {
    const e = Object.assign({ key: touche, ctrlKey: false, metaKey: false, altKey: false,
      target: cible || { tagName: 'BUTTON' }, arrete: false, empeche: false,
      stopPropagation() { this.arrete = true; }, preventDefault() { this.empeche = true; } }, mods || {});
    (ecouteurs[type] || []).forEach(f => f(e));
    return { arrete: e.arrete, sorties: sorties.slice() };
  };
}

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
const CHAMP = { tagName: 'INPUT' };
const fn = extraire(src, 'isolerClavier');
let frappe = monter(fn);

console.log('\n=== Ce qui passe, ce qui est garde ===');
verifier('une lettre ne part pas dans WME', frappe('keydown', 'a').arrete, true);
verifier('Ctrl+S (hors champ) passe : WME enregistre', frappe('keydown', 's', { ctrlKey: true }).arrete, false);
verifier('Cmd+S (Mac) passe', frappe('keydown', 's', { metaKey: true }).arrete, false);
verifier('⚠️ Ctrl+Z DANS un champ reste au champ (sinon WME defait une edition)',
         frappe('keydown', 'z', { ctrlKey: true }, CHAMP).arrete, true);
verifier('keyup d\'une lettre garde aussi', frappe('keyup', 'a').arrete, true);

console.log('\n=== Echap ===');
frappe = monter(fn);
verifier('Echap declenche la sortie de la boite', frappe('keydown', 'Escape').sorties, ['annuler']);
verifier('… une seule fois (pas au keyup)', frappe('keyup', 'Escape').sorties, ['annuler']);
verifier('Echap depuis un champ ferme aussi', frappe('keydown', 'Escape', {}, CHAMP).sorties, ['annuler', 'annuler']);

console.log('\n=== Branchements ===');
verifier('les trois boites passent par isolerClavier', (src.match(/isolerClavier\(boite, \(\) =>/g) || []).length, 3);
verifier('plus aucun stopPropagation de touche sans condition',
         /\['keydown', 'keypress', 'keyup'\]\.forEach\(ev =>\s*boite\.addEventListener\(ev, e => e\.stopPropagation\(\)\)\)/.test(src), false);

console.log('\n=== Temoin ===');
const mutant = fn.replace("if ((e.ctrlKey || e.metaKey || e.altKey) && !saisie) return;", '');
if (mutant === fn) { ko++; console.log('  ECHEC temoin introuvable'); }
else verifier('TEMOIN : sans la condition, Ctrl+S est avale', monter(mutant)('keydown', 's', { ctrlKey: true }).arrete, true);

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
