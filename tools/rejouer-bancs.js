/**
 * Rejoue TOUS les bancs et controles du depot, et resume.
 *
 * ⚠️ ORIGINE : audit du 25/09/2026. Les bancs lisent `WME-Naming-Auditor.user.js` par un chemin
 * RELATIF : lances depuis `tools/`, ils echouaient tous ; et il n'y avait pas de lanceur, donc pas
 * de verdict d'ensemble. Celui-ci se place a la racine du depot quel que soit le dossier courant,
 * lance chaque `tools/test-*.js` et `tools/check-*.js`, et rend un code de sortie non nul au
 * premier echec.
 *
 * Usage : node tools/rejouer-bancs.js          (depuis n'importe ou)
 *         node tools/rejouer-bancs.js -v       (affiche la sortie des bancs en echec)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
// Trop long pour un passage courant (> 120 s, et il interroge le reseau) : lance a part.
const A_PART = new Set(['couverture-eb10.js']);
const bancs = fs.readdirSync(__dirname)
  .filter(f => /^(test|check)-.*\.js$/.test(f) && !A_PART.has(f))
  .sort();

const verbeux = process.argv.includes('-v');
let ko = 0;
const t0 = Date.now();
for (const b of bancs) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join('tools', b)], { cwd: RACINE, encoding: 'utf8', timeout: 180000 });
  const bon = r.status === 0;
  if (!bon) ko++;
  console.log((bon ? '  ok    ' : '  ECHEC ') + b.padEnd(34) + String(Date.now() - t).padStart(6) + ' ms'
    + (r.error ? '  (' + r.error.code + ')' : ''));
  if (!bon && verbeux) console.log(String((r.stdout || '') + (r.stderr || '')).split('\n').slice(-15).map(l => '        ' + l).join('\n'));
}
console.log('\n' + bancs.length + ' bancs en ' + Math.round((Date.now() - t0) / 1000) + ' s — '
  + (ko ? ko + ' ECHEC(S)' : 'TOUT PASSE') + (A_PART.size ? '   (a part : ' + [...A_PART].join(', ') + ')' : ''));
process.exit(ko ? 1 : 0);
