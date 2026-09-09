/**
 * OU EN EST LA TRADUCTION DE L'AIDE — mesure, pas estimation.
 *
 * ⚠️ L'aide n'est pas traduite phrase par phrase mais PAR BLOC : la cle est
 * le HTML interne d'un element, parce qu'une phrase y est coupee par ses <b> et
 * que l'italien ne remet pas les morceaux dans cet ordre (voir `traduireDOM`).
 * Ce script monte donc `sectionsAide()` avec CHAQUE referentiel, releve les
 * blocs rendus, et dit lesquels manquent au dictionnaire.
 *
 * ⭐ Il compte pour les DEUX referentiels : un editeur italien qui aide en
 * France lit l'aide FRANCAISE en italien. Les blocs communs ne sont comptes
 * qu'une fois.
 *
 * ⚠️ Il reprend le montage de `tools/test-ui-sections.js` plutot que d'en
 * refaire un : deux montages divergeraient, et c'est le harnais qui fait foi.
 *
 * Usage : node tools/couverture-i18n.js [--sections | --section <id> | --liste]
 */
'use strict';
// Les BLOCS de l'aide a traduire, pour CHAQUE referentiel. Un bloc = le HTML
// interne d'un element qui porte du balisage : c'est exactement ce que
// `traduireDOM` cherchera dans le dictionnaire.
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');
const T = fs.readFileSync('tools/test-ui-sections.js', 'utf8');

const morceau = T.slice(T.indexOf('  function refDeTest(pays)'),
                        T.indexOf('  const sans = corpsDe(false)'));
const extraireFn = nom => {
  const i = src.indexOf('function ' + nom + '(');
  let n = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') n++; else if (src[j] === '}') { n--; if (!n) { j++; break; } } }
  return src.slice(i, j);
};
const bloc = extraireFn('sectionsAide');
const constantes = new Set();
bloc.replace(/\$\{([^}]*)\}/g, (m, x) => {
  (x.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) || []).filter(k => k !== 'REF').forEach(k => constantes.add(k));
  return m;
});
// ⚠️ `valeurDe` vit AVANT le morceau repris du harnais : c'est lui qui déclare
//    les constantes avec leur VRAIE valeur, et sans elle rien ne s'évalue.
//    Cette dépendance invisible a fait rendre à l'outil une sortie VIDE
//    pendant que j'annonçais un chiffre pris au passage précédent.
const valeurDe = nom => {
  const m = src.match(new RegExp('\\bconst ' + nom + '\\s*=\\s*([^;\\n]+)'));
  if (!m) return '0';
  const v = m[1].trim();
  return /^-?[0-9]+([.][0-9]+)?$/.test(v) ? v : '0';
};
const monter = pays => new Function('src', 'extraire', 'bloc', 'constantes', 'valeurDe',
  morceau + '\nreturn sectionsDe(true, ' + JSON.stringify(pays) + ');')
  (src, extraireFn, bloc, constantes, valeurDe);

// Le dictionnaire actuel.
const iT = src.indexOf('const TEXTES = {');
let p = 0, j = src.indexOf('{', iT);
for (; j < src.length; j++) { if (src[j] === '{') p++; else if (src[j] === '}') { p--; if (!p) break; } }
const DICO = new Function(src.slice(iT, j + 1) + '; return TEXTES;')().it;

/**
 * Decoupe grossiere mais suffisante : on prend le contenu des elements de
 * TEXTE (td, p, li, div de note) qui contiennent au moins une balise.
 * ⚠️ On ne parse pas le HTML : on l'ouvre a la regex, ce qui suffit ici parce
 *    que l'aide n'imbrique pas ces elements les uns dans les autres.
 */
function blocsDe(html) {
  const out = [];
  for (const m of html.matchAll(/<(td|p|li|div)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const dedans = m[2].trim().replace(/\s+/g, ' ');
    if (!dedans || !/[A-Za-zÀ-ÿ]{3}/.test(dedans)) continue;
    // ⚠️ ON GARDE AUSSI LES CELLULES SANS BALISE. Premiere version : elles
    //    etaient ecartees comme « simple texte » — or elles s'affichent, et
    //    `traduireDOM` les traduit par la voie des nœuds texte. Les ignorer
    //    faisait SOUS-ESTIMER le travail restant : une mesure fausse dans le
    //    sens rassurant.
    out.push(dedans);
  }
  return out;
}

const par = {};
for (const pays of ['FR', 'IT']) {
  const secs = monter(pays);
  const titres = secs.map(s => s.titre);
  const blocs = [];
  secs.forEach(s => blocsDe(s.corps).forEach(b => blocs.push(b)));
  par[pays] = { titres, blocs };
}
const tousBlocs = new Set([...par.FR.blocs, ...par.IT.blocs]);
const tousTitres = new Set([...par.FR.titres, ...par.IT.titres]);
/**
 * ⭐ CE QUI N'A PAS À ÊTRE TRADUIT, et pourquoi. Sans cette liste, la mesure
 * dirait « reste 7 » pour toujours, et on chercherait un travail qui n'existe
 * pas. Chaque entrée a une raison, et elle est écrite.
 */
const IDENTIQUES = [
  // Déjà en italien : c'est le titre italien lui-même.
  '📖 Le regole ufficiali italiane',
  // Mots italiens employés tels quels dans le texte français : la traduction
  // serait l'identité, et le contrôle 6 du harnais refuse (à juste titre) ce
  // bruit dans le dictionnaire.
  '<b>Frazione</b>', '<b>Scudetti</b>', '<b>Rampe</b>', '<b>Rotatorie</b>',
  '<b>Fari</b>', '<b>⏹ Stop</b>',
  // ⚠️ CITATION D'UN MESSAGE DE WME, pas un texte du script. Sa version
  // italienne existe dans l'éditeur mais nous ne la connaissons pas :
  // l'inventer ferait chercher à l'éditeur un message qu'il ne verra jamais
  // sous ces mots. ⏳ À demander au CC italien.
  '<b>« a un numéro de rue invalide »</b>'
];
const aTraduire = x => !DICO[x] && !IDENTIQUES.includes(x);
const resteBlocs = [...tousBlocs].filter(aTraduire);
const resteTitres = [...tousTitres].filter(aTraduire);

console.log('AIDE — a traduire pour couvrir les DEUX referentiels');
console.log('  titres de section : ' + tousTitres.size + '  (reste ' + resteTitres.length + ')');
console.log('  blocs             : ' + tousBlocs.size + '  (reste ' + resteBlocs.length + ')');
console.log('    dont FR seul    : ' + par.FR.blocs.filter(b => !par.IT.blocs.includes(b)).length);
console.log('    dont IT seul    : ' + par.IT.blocs.filter(b => !par.FR.blocs.includes(b)).length);
console.log('    communs         : ' + par.FR.blocs.filter(b => par.IT.blocs.includes(b)).length);
const car = [...tousBlocs].reduce((s, b) => s + b.length, 0);
console.log('  volume            : ' + car + ' caracteres');

// Par section, pour prioriser.
if (process.argv[2] === '--sections') {
  const parSection = {};
  for (const pays of ['FR', 'IT']) {
    for (const s of monter(pays)) {
      const b = blocsDe(s.corps).filter(aTraduire);
      parSection[s.id] = parSection[s.id] || new Set();
      b.forEach(x => parSection[s.id].add(x));
    }
  }
  const rangs = Object.entries(parSection).sort((a, b) => b[1].size - a[1].size);
  rangs.forEach(([id, set]) => {
    const car = [...set].reduce((n, x) => n + x.length, 0);
    console.log('  ' + String(set.size).padStart(4) + ' blocs  ' +
                String(car).padStart(6) + ' car.  ' + id);
  });
}
if (process.argv[2] === '--section' && process.argv[3]) {
  const cible = process.argv[3];
  const vus = new Set();
  for (const pays of ['FR', 'IT']) {
    for (const s of monter(pays)) {
      if (s.id !== cible) continue;
      blocsDe(s.corps).filter(aTraduire).forEach(x => vus.add(x));
    }
  }
  [...vus].forEach(b => console.log(JSON.stringify(b)));
}
if (process.argv[2] === '--liste') {
  console.log('\n--- TITRES ---');
  resteTitres.forEach(t => console.log(JSON.stringify(t)));
  console.log('\n--- BLOCS ---');
  resteBlocs.forEach(b => console.log(JSON.stringify(b)));
}
