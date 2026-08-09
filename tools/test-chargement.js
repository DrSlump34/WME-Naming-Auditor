/**
 * LE SCRIPT SE CHARGE-T-IL SANS LEVER ? — controle de niveau MODULE.
 *
 * ⭐⭐⭐ ORIGINE : le 09/08/2026, la v2.35.00 a ete poussee avec `node --check`
 * au vert, 907 verifications au vert... et **WNA ne demarrait plus du tout**
 * dans WME. L'onglet du script avait disparu de la barre laterale pendant que
 * celui d'un autre userscript etait toujours la.
 *
 * ⚠️⚠️ CE QUE `node --check` NE VOIT PAS : il valide la SYNTAXE, pas
 * l'EXECUTION. Une zone morte temporelle (`const` lu avant sa ligne), un nom
 * de fonction qui n'existe pas, un appel place trop tot — tout cela passe la
 * syntaxe et casse au chargement. Et la console de Tampermonkey vit dans un
 * contexte isole que l'onglet ne trace pas : l'erreur ne se voit NULLE PART.
 *
 * ⇒ Ce fichier execute le userscript avec des bouchons minimaux et dit ou il
 * casse. Il ne teste aucun comportement : il repond a « est-ce que ca part ? ».
 *
 * Usage : node tools/test-chargement.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

/** Objet qui accepte tout, pour ne pas mourir sur un detail d'API. */
function complaisant(nom) {
  return new Proxy(function () {}, {
    get(c, p) {
      if (p === Symbol.toPrimitive || p === 'toString') return () => nom;
      if (p === 'then') return undefined;              // ne pas passer pour une promesse
      if (p === 'length') return 0;
      if (p === 'style' || p === 'dataset' || p === 'classList') return complaisant(nom + '.' + String(p));
      return complaisant(nom + '.' + String(p));
    },
    set() { return true; },
    apply() { return complaisant(nom + '()'); },
    construct() { return complaisant('new ' + nom); },
    has() { return true; }
  });
}

const elem = () => ({
  style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  children: [], childNodes: [],
  appendChild(x) { return x; }, append() {}, prepend() {}, remove() {},
  insertBefore(x) { return x; }, setAttribute() {}, getAttribute() { return null; },
  removeAttribute() {}, addEventListener() {}, removeEventListener() {},
  querySelector() { return null; }, querySelectorAll() { return []; },
  closest() { return null; }, scrollIntoView() {}, focus() {}, click() {},
  getBoundingClientRect() { return { top:0, left:0, width:0, height:0, right:0, bottom:0 }; },
  innerHTML: '', outerHTML: '', textContent: '', value: '', checked: false, disabled: false,
  options: [], files: [], onclick: null, onchange: null
});

const doc = {
  readyState: 'complete', hidden: false, visibilityState: 'visible',
  body: elem(), head: elem(), documentElement: elem(),
  createElement: () => elem(), createElementNS: () => elem(),
  createTextNode: () => elem(), createDocumentFragment: () => elem(),
  querySelector: () => null, querySelectorAll: () => [],
  getElementById: () => null, getElementsByTagName: () => [],
  addEventListener() {}, removeEventListener() {}, hasFocus: () => true
};

const sandbox = {
  console: { log(){}, warn(){}, error(){}, info(){}, debug(){} },
  document: doc,
  navigator: { language: 'fr-FR', languages: ['fr-FR'], clipboard: { readText: async () => '' },
               storage: { estimate: async () => ({ usage:0, quota:0 }) }, userAgent: 'node' },
  location: { href: 'https://www.waze.com/fr/editor', hostname: 'www.waze.com', search: '' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, length: 0 },
  indexedDB: complaisant('indexedDB'),
  performance: { now: () => 0, memory: { usedJSHeapSize:0, totalJSHeapSize:0, jsHeapSizeLimit:0 } },
  MutationObserver: class { observe() {} disconnect() {} },
  ResizeObserver:  class { observe() {} disconnect() {} },
  IntersectionObserver: class { observe() {} disconnect() {} },
  PerformanceObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
  fetch: async () => ({ ok: true, text: async () => '', json: async () => ({}) }),
  XMLHttpRequest: class { open() {} send() {} setRequestHeader() {} addEventListener() {} },
  GM_xmlhttpRequest: () => {}, GM_getValue: (k, d) => d, GM_setValue: () => {},
  GM_info: { script: { version: '0' } },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  atob: s => Buffer.from(String(s), 'base64').toString('binary'),
  btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
  alert() {}, confirm: () => false, prompt: () => null,
  Element: function(){}, HTMLElement: function(){}, Node: function(){},
  getWmeSdk: () => complaisant('sdk'),
  SDK_INITIALIZED: Promise.resolve(true),
  W: complaisant('W')
};
sandbox.window = sandbox;
sandbox.unsafeWindow = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.top = sandbox;

let erreur = null;
try {
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'WME-Naming-Auditor.user.js', timeout: 20000 });
} catch (e) {
  erreur = e;
}

if (erreur) {
  console.log('\n  ECHEC — le script LEVE au chargement :\n');
  console.log('  ' + erreur.name + ' : ' + erreur.message);
  const pile = String(erreur.stack || '').split('\n').filter(l => /Naming-Auditor/.test(l)).slice(0, 4);
  if (pile.length) { console.log('\n  Ou :'); pile.forEach(l => console.log('   ' + l.trim())); }
  console.log('\n  ⚠️ Une erreur ici veut dire que le script NE DEMARRE PAS dans WME,');
  console.log('     et que rien ne le dira : la console de Tampermonkey n est pas tracee.\n');
  process.exit(1);
}
console.log('\n  ok   le script se charge sans lever  (1 verification)\n');
process.exit(0);
