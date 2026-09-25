/**
 * PASTILLE DE MISE A JOUR : charte commune (WRP), audit du 25/09/2026.
 *
 * Attendu : au plus un sondage par 24 h (la version vue est gardee), adresses lues dans GM_info
 * (declarees par @updateURL / @downloadURL), clic sur le FICHIER d'installation.
 *
 * `_majVerifier` est EXTRAITE du userscript ; GM_xmlhttpRequest et localStorage sont simules.
 * Temoin : sans la garde des 24 h, chaque chargement interroge GreasyFork.
 *
 * Usage : node tools/test-pastille-maj.js [fichier.user.js]
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
const ligne = nom => { const m = src.match(new RegExp('\\n\\s*const ' + nom + ' = [^\\n]+')); if (!m) throw new Error(nom); return m[0]; };

function monter(s, stock, reponse) {
  const monde = { appels: [], rendus: 0 };
  const code = [
    "const VERSION = '2.49.04', _VER_RE = /^\\d+(\\.\\d+)*$/;",
    "let _majEnLigne = null;",
    ligne('MAJ_CLE'),
    ligne('_majLire'), ligne('_majNoter'),
    extraire(s, '_majCmp'), extraire(s, '_majVerifier'),
    'return { verifier: _majVerifier, enLigne: () => _majEnLigne };'
  ].join('\n');
  const api = new Function('GM_xmlhttpRequest', 'localStorage', 'URL_MAJ', '_majRender', 'log', code)(
    o => { monde.appels.push(o.url); o.onload({ status: 200, responseText: '// @version      ' + reponse + '\n' }); },
    { getItem: k => stock[k] || null, setItem: (k, v) => { stock[k] = v; } },
    'https://update.greasyfork.org/x.meta.js', () => { monde.rendus++; }, () => {});
  return { api, monde };
}

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}

console.log('\n=== Sondage ===');
let stock = {};
let x = monter(src, stock, '2.50.00');
x.api.verifier();
verifier('premier chargement : un sondage', x.monde.appels.length, 1);
verifier('version plus recente : pastille allumee', x.api.enLigne(), '2.50.00');
x = monter(src, stock, '2.50.00');
x.api.verifier();
verifier('rechargement dans les 24 h : AUCUN sondage', x.monde.appels.length, 0);
verifier('… et la pastille se rallume sur la version gardee', x.api.enLigne(), '2.50.00');
stock['agn.maj'] = JSON.stringify({ t: Date.now() - 864e5 - 1, v: '2.49.04' });
x = monter(src, stock, '2.50.01');
x.api.verifier();
verifier('memo de plus de 24 h : nouveau sondage', [x.monde.appels.length, x.api.enLigne()], [1, '2.50.01']);
stock = { 'agn.maj': JSON.stringify({ t: Date.now(), v: '2.49.04' }) };
x = monter(src, stock, '9.99.99');
x.api.verifier();
verifier('version gardee identique : pastille eteinte', x.api.enLigne(), null);

console.log('\n=== En-tete et clic ===');
verifier('@downloadURL declare', /\/\/ @downloadURL  https:\/\/update\.greasyfork\.org\/scripts\/588554\/WME%20Naming%20Auditor\.user\.js/.test(src), true);
verifier('@updateURL declare', /\/\/ @updateURL    https:\/\/update\.greasyfork\.org\/scripts\/588554\/WME%20Naming%20Auditor\.meta\.js/.test(src), true);
verifier('le clic ouvre le fichier d\'installation', /#agn-maj'\)\.onclick = e => \{\s*e\.stopPropagation\(\);\s*hote\.open\(URL_INSTALLER/.test(src), true);
verifier('les adresses viennent de GM_info', /URL_MAJ = _gmScript\(\)\.updateURL \|\| GF_META_URL/.test(src) &&
  /URL_INSTALLER = _gmScript\(\)\.downloadURL \|\| GF_SCRIPT_URL/.test(src), true);

console.log('\n=== Temoin ===');
const fn = extraire(src, '_majVerifier');
const mutant = src.replace(fn, fn.replace('if (memo && Date.now() - memo.t < MAJ_DELAI)', 'if (false)'));
if (mutant === src) { ko++; console.log('  ECHEC temoin introuvable'); }
else {
  const s2 = { 'agn.maj': JSON.stringify({ t: Date.now(), v: '2.50.00' }) };
  const m = monter(mutant, s2, '2.50.00');
  m.api.verifier();
  verifier('TEMOIN : sans la garde, chaque chargement interroge GreasyFork', m.monde.appels.length, 1);
}

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
