/**
 * Ouvrir la fenetre relance le chargement du departement visible (2.50.08).
 *
 * `autoChargerDepartement` sort sans rien faire tant que la fenetre est fermee,
 * et elle l'est au demarrage. Avant la 2.50.08, `ouvrirOverlay` ne le relancait
 * pas : ouvrir la fenetre sans bouger la carte laissait la liste des communes
 * vide (vecu a Alise-Sainte-Reine, 28/09/2026).
 *
 * Usage : node tools/test-ouverture-charge.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'WME-Naming-Auditor.user.js', 'utf8');

function extraire(s, nom) {
  const i = s.indexOf('function ' + nom + '(');
  if (i < 0) return '';
  let prof = 0, j = s.indexOf('{', i);
  for (; j < s.length; j++) {
    if (s[j] === '{') prof++;
    else if (s[j] === '}') { prof--; if (!prof) break; }
  }
  return s.slice(i, j + 1);
}
// Le code seul : un appel ecrit dans un commentaire ne compte pas.
const code = f => f.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const relance = s => /autoChargerDepartement\(\)\s*\.then\(rafraichirCommunesDeLaVue\)/.test(code(extraire(s, 'ouvrirOverlay')));
const garde = s => /if \(!ui\.overlay \|\| ui\.overlay\.style\.display === 'none'\) return;/.test(extraire(s, 'autoChargerDepartement'));

let ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = obtenu === attendu;
  if (!bon) ko++;
  console.log((bon ? '  ok    ' : '  ECHEC ') + titre + (bon ? '' : '  (obtenu ' + obtenu + ')'));
}

verifier('1. la garde « fenêtre fermée » existe toujours dans autoChargerDepartement', garde(src), true);
verifier('2. ouvrirOverlay relance le chargement du département visible', relance(src), true);
// Témoin : sans l'appel, le contrôle 2 doit tomber.
const sans = src.replace(/\n\s*autoChargerDepartement\(\)\.then\(rafraichirCommunesDeLaVue\)\.then\(replierContoursSelonListe\);/, '');
verifier('3. TÉMOIN : appel retiré — le contrôle 2 tombe', sans !== src && relance(sans), false);

console.log(ko ? ko + ' ECHEC(S)' : '3 vérifications OK');
process.exit(ko ? 1 : 0);
