/**
 * OU EN EST LA TRADUCTION DE L'INTERFACE (hors aide) — mesure, pas estimation.
 *
 * ⚠️ ORIGINE : audit du 25/09/2026 — l'onglet Scripts, deux boites sur trois, la bulle et le volet
 * (une fois deplace dans le body) restaient en francais en Italie. `couverture-i18n.js` ne compte
 * que l'AIDE ; celui-ci releve, dans le CODE de chaque zone de l'interface, les textes des gabarits
 * HTML (imbriques compris), leurs infobulles, et les chaines entre quotes, puis dit lesquels
 * manquent a `TEXTES.it` — la ou `traduireDOM` les cherchera (espaces normalises).
 *
 * ⚠️ Un texte coupe par un `${…}` ou une concatenation ne peut pas etre une cle : il releve des
 * MOTIFS (`traduireMotif`). L'outil le signale a part (« a motif »), il ne le compte pas manquant.
 *
 * Usage : node tools/couverture-interface.js [--liste] [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv.find(a => a.endsWith('.user.js')) || 'WME-Naming-Auditor.user.js', 'utf8');
const LISTE = process.argv.includes('--liste');

function objetApres(debut) {
  const i = src.indexOf(debut);
  let n = 0, j = src.indexOf('{', i);
  const d = j;
  for (; j < src.length; j++) { if (src[j] === '{') n++; else if (src[j] === '}') { n--; if (!n) { j++; break; } } }
  return src.slice(d, j);
}
const TEXTES = new Function('return ' + objetApres('const TEXTES = {') + ';')();
const norm = t => t.replace(/\s+/g, ' ').trim();
const cles = new Set(Object.keys(TEXTES.it).map(norm));
// Les motifs italiens : on les rejoue sur un texte complet pour savoir s'il est couvert.
const motifsSrc = objetApres('const MOTIFS = {');
let MOTIFS = null;
try { MOTIFS = new Function('lieuIt', 'return ' + motifsSrc + ';')(() => ''); } catch (e) { MOTIFS = { it: [] }; }
const parMotif = t => (MOTIFS.it || []).some(([re]) => re.test(t));

/**
 * Decoupe du code JS : rend les litteraux (gabarits et chaines) avec leur nature.
 * Un gabarit imbrique dans un `${…}` est rendu a part ; dans son parent, le `${…}` devient \0.
 */
function litteraux(code) {
  const out = [];
  let k = 0;
  const lireGabarit = () => {          // code[k] === '`'
    let corps = ''; k++;
    while (k < code.length && code[k] !== '`') {
      if (code[k] === '\\') { corps += code[k] + code[k + 1]; k += 2; continue; }
      if (code[k] === '$' && code[k + 1] === '{') { k += 2; lireExpr(); corps += '\u0000'; continue; }
      corps += code[k++];
    }
    k++; out.push({ type: 'gabarit', corps });
  };
  const lireChaine = q => {
    let corps = ''; k++;
    while (k < code.length && code[k] !== q) {
      if (code[k] === '\\') { corps += code[k + 1]; k += 2; continue; }
      if (code[k] === '\n') break;
      corps += code[k++];
    }
    k++; out.push({ type: 'chaine', corps });
  };
  const lireExpr = () => {             // jusqu'a la } fermante
    let n = 1;
    while (k < code.length && n) {
      const c = code[k];
      if (c === '`') { lireGabarit(); continue; }
      if (c === '\'' || c === '"') { lireChaine(c); continue; }
      if (c === '{') n++; else if (c === '}') { n--; if (!n) { k++; return; } }
      k++;
    }
  };
  while (k < code.length) {
    const c = code[k];
    if (c === '/' && code[k + 1] === '/') { k = code.indexOf('\n', k); if (k < 0) break; continue; }
    if (c === '/' && code[k + 1] === '*') { k = code.indexOf('*/', k) + 2; continue; }
    if (c === '`') { lireGabarit(); continue; }
    if (c === '\'' || c === '"') { lireChaine(c); continue; }
    k++;
  }
  return out;
}

/** Les textes VISIBLES d'un litteral : nœuds texte et infobulles d'un gabarit, ou la chaine. */
function textes(l) {
  const r = [];
  if (l.type === 'gabarit' || /<[a-z]/i.test(l.corps)) {
    const g = l.corps.replace(/<!--[\s\S]*?-->/g, '');
    // Le texte avant la premiere balise et apres la derniere compte aussi.
    ('>' + g + '<').replace(/>([^<>]*)</g, (m, t) => { r.push({ t, coupe: t.includes('\u0000') }); return m; });
    g.replace(/\b(?:title|placeholder|aria-label)="([^"]*)"/g, (m, t) => { r.push({ t, coupe: t.includes('\u0000') }); return m; });
  } else r.push({ t: l.corps, coupe: false, chaine: true });
  return r;
}

const ZONES = [
  ['onglet Scripts', 'function buildReglages(', '  function '],
  ['volet et fenetre', 'function buildOverlay(', '  function '],
  ['boite « saisie d\'adresse »', 'function demanderAdresse(', '  function '],
  ['boite « nom principal »', 'function demanderNomPrincipal(', '  function '],
  ['bulle au survol', 'function afficherBulle(', '  function '],
  ['liste des agglomerations', 'function renderAgglos(', '  function '],
];
const EMOJI_SEUL = /^[\s\p{Extended_Pictographic}️\u0000·—–:,.;!?%()\[\]|/+<>=≥≤→←▶▼▸▾✕✎◎⬇⬆-]*$/u;
const TECHNIQUE = /^(#|\.)?agn[-\w]*|^https?:|^[\w.-]+\/[\w./-]*$|^[A-Za-z_$][\w$]*$|^[a-z-]+:[^\s]*$|^\s*[.#][\w-]+[\s,{]/;
let total = 0, manque = 0, aMotif = 0;
for (const [nom, deb, finMarque] of ZONES) {
  const a = src.indexOf(deb);
  if (a < 0) { console.log('⚠️ zone introuvable : ' + nom); continue; }
  const b = src.indexOf('\n' + finMarque, a + deb.length);
  const vus = new Set(), absents = [], motifs = [];
  for (const l of litteraux(src.slice(a, b < 0 ? undefined : b))) {
    for (const { t: brut, coupe, chaine } of textes(l)) {
      const t = norm(brut.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, '\''));
      if (!t || EMOJI_SEUL.test(t) || TECHNIQUE.test(t) || vus.has(t)) continue;
      // Une chaine JS n'est un texte que si elle a au moins deux mots, ou un accent.
      if (!/[A-Za-zÀ-ÿ]{3,}/.test(t) || (chaine && !/[À-ÿ]|[A-Za-z]{3,}\s+\S+/.test(t))) continue;
      vus.add(t); total++;
      if (cles.has(t.replace(/\u0000/g, '').trim())) continue;
      if (coupe || chaine && !/^[A-ZÀ-Ý«⚠️⭐]/u.test(t)) { aMotif++; motifs.push(t.replace(/\u0000/g, '…')); continue; }
      if (parMotif(t)) continue;
      manque++; absents.push(t);
    }
  }
  console.log(nom + ' : ' + (vus.size - absents.length - motifs.length) + '/' + vus.size + ' traduits' +
              (motifs.length ? ' (' + motifs.length + ' morceau(x) a motif)' : ''));
  if (LISTE) { absents.forEach(t => console.log('   ✗ ' + t)); motifs.forEach(t => console.log('   ~ ' + t)); }
}
console.log('\nTOTAL : ' + (total - manque - aMotif) + '/' + total + ' traduits, ' + manque + ' manquant(s), ' +
            aMotif + ' morceau(x) a motif');
