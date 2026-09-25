/**
 * CONTOURS IMPORTES : pas de commune sans code valide (audit du 25/09/2026).
 *
 * Avant, `code: code || nom` : un contour sans code prenait son NOM pour code, et tout ce qui range
 * par code (departement, agglos, partage) partait sous une cle fantome. `chargerFeatureCollection`
 * est EXTRAITE du script, avec `litPropriete`, `bboxOf`, `pointsDeGeom` et le format de code du
 * referentiel francais. Temoin : le retour a `code || nom` fait entrer « Coursan » comme code.
 *
 * Usage : node tools/test-contours-code.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'WME-Naming-Auditor.user.js', 'utf8');
const fn = (s, nom) => { const a = s.indexOf('function ' + nom + '('); if (a < 0) throw new Error(nom);
  let n = 0, b = s.indexOf('{', a); for (; b < s.length; b++) { if (s[b] === '{') n++; else if (s[b] === '}') { n--; if (!n) break; } }
  return s.slice(a, b + 1); };
const cst = nom => src.match(new RegExp('const ' + nom + ' = [^;]+;'))[0];

function monter(s) {
  const code = [
    cst('CLES_NOM'), cst('CLES_CODE'),
    "const REF = { code: 'FR', clesNom: CLES_NOM, clesCode: CLES_CODE, libelleCode: 'code INSEE'," +
    "  reCodeCommune: " + src.match(/reCodeCommune: (\/\^\(\\d\{5\}\|2\[AB\]\\d\{3\}\)\$\/)/)[1] + " };",
    "const codeCommuneValide = c => typeof c === 'string' && REF.reCodeCommune.test(c);",
    'let communes = [], metaContours = null;',
    fn(s, 'litPropriete'), fn(s, 'bboxOf'), fn(s, 'pointsDeGeom'),
    "const depDuCode = c => String(c).slice(0, 2); const depsCharges = () => [...new Set(communes.map(c => depDuCode(c.code)))];",
    fn(s, 'chargerFeatureCollection'),
    'return { charger: chargerFeatureCollection, communes: () => communes };'
  ].join('\n');
  return new Function(code)();
}
const carre = [[[3, 43], [3.1, 43], [3.1, 43.1], [3, 43]]];
const F = props => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: carre } });

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}

const api = monter(src);
const r = api.charger({ type: 'FeatureCollection', features: [
  F({ nom: 'Coursan', code: '11106' }), F({ nom: 'Ajaccio', code: '2A004' }),
  F({ nom: 'Sans Code' }), F({ nom: 'Code Faux', code: 'XYZ' }), F({ code: '11999' })] }, 'essai.json');
verifier('deux communes valides entrent, avec leur code', api.communes().map(c => c.code), ['11106', '2A004']);
verifier('les écartés sont comptés : 2 sans code valide, 1 sans nom', [r.sansCode, r.sansNom], [2, 1]);
let msg = '';
try { monter(src).charger({ type: 'FeatureCollection', features: [F({ nom: 'Coursan' })] }, 'x'); } catch (e) { msg = e.message; }
verifier('un fichier sans aucun code : erreur qui le dit', /sans code INSEE valide/.test(msg), true);
verifier('l\'import de fichier affiche les écartés', /contour\(s\) écarté\(s\) faute de ' \+ esc\(REF\.libelleCode\)/.test(src), true);

const mutant = src.replace('if (!codeCommuneValide(code)) { sansCode++; continue; }', '').replace('out.push({ code, nom,', 'out.push({ code: code || nom, nom,');
if (mutant === src) { ko++; console.log('  ECHEC temoin introuvable'); }
else {
  const m = monter(mutant);
  m.charger({ type: 'FeatureCollection', features: [F({ nom: 'Coursan' })] }, 'x');
  verifier('TEMOIN : avec `code || nom`, « Coursan » devient un code', m.communes().map(c => c.code), ['Coursan']);
}
console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
