/**
 * RELEVE INTEGRAL DES TEXTES FRANCAIS DU SCRIPT — et de ce que l'italien ne couvre pas.
 *
 * ⚠️⚠️ POURQUOI CET OUTIL EXISTE (30/09/2026) : la traduction italienne a ete
 * completee par zones — la zone de trace (23/09), l'aide (09/09), puis les
 * reports (30/09), ou 145 noeuds sur 174 sortaient en francais alors que
 * « l'italien » etait annonce. Chaque zone oubliee s'est decouverte par hasard.
 * L'auteur : « On va pas iterer 15 fois sur les traductions. On gere tout. »
 * ⇒ on part du SOURCE ENTIER, pas d'une zone.
 *
 * Methode :
 *  1. un decoupeur JavaScript (sans dependance) separe commentaires, chaines,
 *     gabarits et expressions regulieres — les commentaires ne sont PAS du texte
 *     affiche ([[compter-occurrences-code]]) ;
 *  2. de chaque chaine on tire le texte VISIBLE : ce qui est entre les balises,
 *     et les attributs `title` / `placeholder` ;
 *  3. chaque morceau francais est confronte au dictionnaire italien et aux
 *     motifs, par les fonctions EXTRAITES du script. Un morceau est COUVERT s'il
 *     est une cle, s'il est contenu dans une cle (morceau d'une phrase traduite
 *     en bloc), ou si un motif le traduit.
 *
 * ⚠️ Ce qui reste « non couvert » est une liste de CANDIDATS, pas un verdict : un
 *    morceau d'une concatenation n'est jamais une cle telle quelle. Chaque ligne
 *    se tranche a la lecture, et le tri est consigne dans `tools/fixtures/`.
 *
 * Usage : node tools/releve-textes.js [--json] [--tout]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const FICHIER = path.join(__dirname, '..', 'WME-Naming-Auditor.user.js');
const src = fs.readFileSync(FICHIER, 'utf8');

// ── 1. Decoupeur ─────────────────────────────────────────────────────────────
// Rend les chaines (simples, doubles, morceaux de gabarit) avec leur ligne.
// ⚠️ Le piege d'un decoupeur maison est la barre oblique : division ou debut
//    d'expression reguliere ? On tranche par le jeton precedent significatif.
function decouper(s) {
  const chaines = [];
  let i = 0, ligne = 1, prec = '';        // prec : dernier jeton significatif
  const pile = [];                          // profondeur des ${ } dans les gabarits
  const MOTS_AVANT_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of',
    'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
  const avance = n => { for (let k = 0; k < n; k++) { if (s[i] === '\n') ligne++; i++; } };
  const regexPossible = () => !prec || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(prec) ||
    /^(=>|==|===|!=|!==|&&|\|\||\?\?|\+=|-=|\*=|\/=)$/.test(prec) || MOTS_AVANT_REGEX.has(prec);

  function lireGabarit() {                   // i pointe apres le ` ou apres la } d'une interpolation
    let morceau = '', l0 = ligne;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') { morceau += s[i] + s[i + 1]; avance(2); continue; }
      if (c === '`') { chaines.push({ t: 'g', v: morceau, l: l0 }); avance(1); prec = 'x'; return; }
      if (c === '$' && s[i + 1] === '{') {
        chaines.push({ t: 'g', v: morceau, l: l0 });
        avance(2); pile.push(0); prec = '{'; return;
      }
      morceau += c; avance(1);
    }
  }

  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r') { avance(1); continue; }
    if (c === '/' && d === '/') { while (i < s.length && s[i] !== '\n') avance(1); continue; }
    if (c === '/' && d === '*') { avance(2); while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) avance(1); avance(2); continue; }
    if (c === '\'' || c === '"') {
      const l0 = ligne; let v = ''; avance(1);
      while (i < s.length && s[i] !== c) {
        if (s[i] === '\\') {
          const e = s[i + 1];
          v += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'u' ? String.fromCharCode(parseInt(s.substr(i + 2, 4), 16)) : e;
          avance(e === 'u' ? 6 : 2); continue;
        }
        v += s[i]; avance(1);
      }
      avance(1); chaines.push({ t: c === '"' ? 'd' : 's', v, l: l0 }); prec = 'x'; continue;
    }
    if (c === '`') { avance(1); lireGabarit(); continue; }
    if (c === '{') { if (pile.length) pile[pile.length - 1]++; avance(1); prec = '{'; continue; }
    if (c === '}') {
      if (pile.length && pile[pile.length - 1] === 0) { pile.pop(); avance(1); lireGabarit(); continue; }
      if (pile.length) pile[pile.length - 1]--;
      avance(1); prec = '}'; continue;
    }
    if (c === '/' && regexPossible()) {    // expression reguliere : on la saute
      avance(1); let classe = false;
      while (i < s.length) {
        const e = s[i];
        if (e === '\\') { avance(2); continue; }
        if (e === '[') classe = true; else if (e === ']') classe = false;
        else if (e === '/' && !classe) break;
        else if (e === '\n') break;
        avance(1);
      }
      avance(1); while (/[a-z]/i.test(s[i] || '')) avance(1);
      prec = 'x'; continue;
    }
    if (/[A-Za-z_$À-ɏ]/.test(c)) {
      let m = ''; while (i < s.length && /[\w$À-ɏ]/.test(s[i])) { m += s[i]; avance(1); }
      prec = m; continue;
    }
    if (/[0-9]/.test(c)) { while (/[\w.]/.test(s[i] || '')) avance(1); prec = 'x'; continue; }
    // ponctuation : on garde le jeton sur 1 a 3 caracteres
    const trois = s.substr(i, 3), deux = s.substr(i, 2);
    if (['===', '!==', '...', '**=', '>>>', '&&=', '||=', '??='].includes(trois)) { prec = trois; avance(3); continue; }
    if (['=>', '==', '!=', '&&', '||', '??', '+=', '-=', '*=', '/=', '<=', '>=', '++', '--', '?.'].includes(deux)) {
      prec = (deux === '++' || deux === '--') ? 'x' : deux; avance(2); continue;
    }
    prec = c; avance(1);
  }
  return chaines;
}

// ── 2. Texte visible d'une chaine ──────────────────────────────────────────────
const norm = x => x.replace(/\s+/g, ' ').trim();
function visibles(v) {
  const out = [];
  // attributs affiches
  // ⚠️ Guillemet par guillemet : `(["'])([^"']*)\1` s'arretait a la PREMIERE apostrophe du texte
  //    (« n'a », « l'agglo »), et tout attribut qui en contenait echappait au releve — trouve par
  //    mutation, le 30/09/2026.
  v.replace(/\b(?:title|placeholder|aria-label|label)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    (m, a, b) => { out.push(a !== undefined ? a : b); return m; });
  // texte hors balises (on retire balises et entites de mise en forme)
  const hors = v.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, '\u0001').replace(/&nbsp;/g, ' ');
  hors.split('\u0001').forEach(t => out.push(t));
  return out.map(norm).filter(Boolean);
}

// ── 3. Francais ? ─────────────────────────────────────────────────────────────
// v2.50.11 : « tout / tous / toutes » ajoutes. « ✓ tout » (bouton de groupe) n'a ni accent ni mot-outil :
// il passait pour un identifiant, et le garde-fou ne voyait pas son absence du dictionnaire (mutation).
const RE_MOT_FR = /(^|[^a-zà-ÿ'’])(le|la|les|des|du|de|un|une|et|est|pas|à|au|aux|sur|dans|pour|par|avec|sans|ou|ce|cette|ces|il|elle|ils|on|ne|en|qui|que|se|sa|son|ses|leur|tu|ton|ta|tes|tout|tous|toutes)(?=$|[^a-zà-ÿ'’])/i;
const RE_ITALIEN = /(^|[^a-zà-ÿ])(di|della|dello|dei|degli|nel|nella|dalla|dal|senza|strada|civico|abitato|uscita|il|gli|sono|questo|questa|comune|essere|viene|centro|numero|lo|una|che)(?=$|[^a-zà-ÿ])/gi;
function estFrancais(t) {
  if (!/[a-zà-ÿ]{3}/i.test(t)) return false;
  if (/^[\w.-]+$/.test(t) && !/[éèêàçùôî]/.test(t)) return false;         // identifiant, cle, mot isole
  if (/^[#.\w-]+(\s*[>,+~]\s*[#.\w-]+)*$/.test(t)) return false;           // selecteur CSS
  if (/[{};]\s*$|^\s*[.#@][\w-]+\s*\{|:\s*[\w#-]+;/.test(t)) return false;  // CSS
  if (/^(https?:|\/\/|data:)/.test(t)) return false;
  const fr = /[éèêàçùôîœ]/i.test(t) || RE_MOT_FR.test(t);
  if (!fr) return /\s/.test(t) && /^[A-ZÀ-Ÿ]/.test(t) && t.length > 12;       // phrase capitalisee sans mot-outil
  const it = (t.match(RE_ITALIEN) || []).length;
  return !(it >= 2 && !/\b(les|des|du|une|est|aux|cette|pas)\b/i.test(t));
}

// ── 4. Le dictionnaire et les motifs, EXTRAITS du script ───────────────────────
function bloc(debut) {
  const i = src.indexOf(debut);
  let prof = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') prof++; else if (src[j] === '}') { prof--; if (!prof) break; } }
  return src.slice(i, j + 1);
}
const iT = src.indexOf('const TEXTES = {');
const finM = src.indexOf('\n  };', src.indexOf('const MOTIFS = {')) + 5;
const api = new Function('LANGUE', src.slice(iT, finM) + '\n' + bloc('function traduireMotif(') +
  '\nreturn { TEXTES, traduireMotif };')('it');
const d = api.TEXTES.it;
const cles = Object.keys(d).map(k => norm(k.replace(/<[^>]*>/g, ' ')));
const clesJointes = '\u0002' + cles.join('\u0002') + '\u0002';
const ligneDe = off => src.slice(0, off).split('\n').length;
const zoneDico = [ligneDe(iT), ligneDe(finM)];

// Le texte des MOTIFS et des tables d'aide, sans les echappements d'expression reguliere : un
// morceau de concatenation (« poser le cartouche ») n'est jamais un noeud entier, mais il est
// couvert si le motif qui traduit le noeud le contient.
const zoneMotifs = norm(src.slice(iT, finM).replace(/\\(.)/g, '$1'));
function couvert(t) {
  if (d[t] || d[norm(t)]) return 'cle';
  try { if (api.traduireMotif(norm(t))) return 'motif'; } catch (e) { /* motif en erreur : non couvert */ }
  if (clesJointes.includes(norm(t))) return 'dans-une-cle';
  // ⚠️ Seuil de longueur : un morceau court (« entrée(s) ») se retrouverait par hasard n'importe ou.
  if (norm(t).length >= 12 && zoneMotifs.includes(norm(t))) return 'dans-un-motif';
  return null;
}

// ── 5. Releve ─────────────────────────────────────────────────────────────────
const chaines = decouper(src);
const releve = [];
for (const c of chaines) {
  if (c.l >= zoneDico[0] && c.l <= zoneDico[1]) continue;     // le dictionnaire lui-meme
  // Lignes de pur code de journalisation : jamais affichees
  const ligneSrc = src.split('\n')[c.l - 1] || '';
  if (/console\.(log|warn|error|info|debug)\(|\blog\(/.test(ligneSrc)) continue;
  // Tables de DONNEES (communes, departements, provinces, alias de noms) : des noms propres
  if (/^\s*\{"code":|^\s*"[^"]+":\s*"[^"]+",?\s*$/.test(ligneSrc)) continue;
  for (const t of visibles(c.v)) {
    if (!estFrancais(t)) continue;
    releve.push({ l: c.l, t, couvert: couvert(t) });
  }
}
const nonCouverts = releve.filter(r => !r.couvert);
const parLigne = new Map();
for (const r of nonCouverts) { if (!parLigne.has(r.l)) parLigne.set(r.l, []); parLigne.get(r.l).push(r.t); }

module.exports = { releve, nonCouverts };
if (require.main !== module) { /* utilise par un banc */ }
else if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify({ total: releve.length, nonCouverts }, null, 1));
} else {
  console.log('Chaines lues : ' + chaines.length + ' · morceaux francais visibles : ' + releve.length +
    ' · couverts : ' + (releve.length - nonCouverts.length) + ' · NON couverts : ' + nonCouverts.length +
    ' (sur ' + parLigne.size + ' lignes)');
  if (process.argv.includes('--tout')) for (const [l, ts] of parLigne) console.log(l + '\t' + ts.join(' ┃ '));
}
