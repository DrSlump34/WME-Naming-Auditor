/**
 * CHARGEMENT AUTOMATIQUE DU DEPARTEMENT VISIBLE : un echec se dit, et se retente (audit du 25/09/2026).
 *
 * Avant : un departement en echec etait annonce « chargé » avec les autres, et plus jamais retente.
 * `autoChargerDepartement` et `programmerRetente` sont EXTRAITES du script ; le reseau est simule.
 * Temoin : sans `programmerRetente`, le departement rate n'est plus jamais retente.
 *
 * Usage : node tools/test-auto-dep.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'WME-Naming-Auditor.user.js', 'utf8');
const fn = (s, nom) => { const a = s.indexOf('function ' + nom + '('); if (a < 0) throw new Error(nom);
  let n = 0, b = s.indexOf('{', a); for (; b < s.length; b++) { if (s[b] === '{') n++; else if (s[b] === '}') { n--; if (!n) break; } }
  return s.slice(a - (s.slice(a - 6, a) === 'async ' ? 6 : 0), b + 1); };

function monter(s, monde) {
  const code = [
    'const depsTentes = new Set(); let autoEnCours = false;',
    'const DELAI_RETENTE_MS = 60000; const depsRetente = new Map();',
    fn(s, 'programmerRetente'), fn(s, 'autoChargerDepartement'),
    'return { auto: autoChargerDepartement, depsTentes };'
  ].join('\n');
  return new Function('options', 'ui', 'sdk', 'communeDuPoint', 'depsDeLaVue', 'depsCharges', 'REF',
    'progression', 'chargerDepuisGouv', 'esc', 'renderContours', 'log', 'Date', code)(
    { autoDep: true }, monde.ui, { Map: { getMapExtent: () => [0, 0, 1, 1] } }, () => null,
    async () => ['11', '34'], () => monde.charges,
    { sourceContours: { unites: () => [{ code: '11', nom: 'Aude' }, { code: '34', nom: 'Hérault' }] } },
    () => ({ fin() {} }), async codes => { monde.appels.push(codes.slice()); return monde.reponse(codes); },
    t => String(t), () => {}, () => {}, { now: () => monde.t });
}
const monde = () => ({ t: 1000, charges: [], appels: [],
  ui: { overlay: { style: { display: '' } }, statutContours: { innerHTML: '' } },
  reponse: codes => ({ nb: 400, echecs: codes.includes('34') ? ['34 (HTTP 500)'] : [] }) });

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}

(async () => {
  const m = monde(), api = monter(src, m);
  await api.auto();
  const html = m.ui.statutContours.innerHTML;
  verifier('l\'Aude est annoncee chargee', /agn-ok">Contours de Aude chargés/.test(html), true);
  verifier('l\'Herault n\'est PAS annonce charge, il est dit en echec', /agn-alerte">Contours de Hérault non chargés : 34 \(HTTP 500\)/.test(html), true);
  m.charges = ['11'];
  await api.auto();
  verifier('une minute n\'est pas passee : pas de nouvel essai', m.appels.length, 1);
  m.t += 61000; m.reponse = () => ({ nb: 350, echecs: [] });
  await api.auto();
  verifier('apres une minute : l\'Herault est retente, seul', m.appels[1], ['34']);

  const mutant = src.replace('rates.forEach(programmerRetente);', '');
  if (mutant === src) { ko++; console.log('  ECHEC temoin introuvable'); }
  else {
    const m2 = monde(), t = monter(mutant, m2);
    await t.auto(); m2.charges = ['11']; m2.t += 61000; await t.auto();
    verifier('TEMOIN : sans retente, l\'Herault n\'est plus jamais demande', m2.appels.length, 1);
  }
  console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
  process.exit(ko ? 1 : 0);
})();
