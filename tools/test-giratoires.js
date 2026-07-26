/**
 * Tests des GIRATOIRES — chantier fonctionnel de l'audit.
 *
 * Regle FR : un giratoire n'a PAS de nom. En agglomeration il porte la ville,
 * hors agglomeration il n'en porte pas. « Sans nom » veut dire une Street vide
 * de la ville visee.
 *
 * ⚠️ Fonctions EXTRAITES du userscript, pas recopiees.
 *
 * Usage : node tools/test-giratoires.js
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

function extraire(nom) {
  const i = src.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let prof = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, j + 1);
}
function relire(nom) {
  const m = src.match(new RegExp('const\\s+' + nom + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('constante introuvable : ' + nom);
  return 'const ' + nom + ' = ' + m[1] + ';';
}

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else {
    ko++;
    lignes.push('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) +
                '\n          obtenu  ' + JSON.stringify(obtenu));
  }
}

const api = new Function(
  relire('fmt') + '\n' + extraire('verifierGiratoire') + '\n' + extraire('villeAgglo') +
  '\nreturn { verifierGiratoire, villeAgglo };')();

/** Construit un `nam` minimal. */
const N = (nom, ville, alts) => ({
  primary: { name: nom || '', cityName: ville || '', signText: '', signType: null },
  primaryId: 1,
  alts: (alts || []).map(a => ({ name: a.name || '', cityName: a.cityName || '',
                                 signText: '', signType: null }))
});

console.log('\n=== Giratoires : nom interdit, ville selon la zone ===\n');

// ── En agglomeration : sans nom, AVEC la ville ──────────────────────────────
verifier('1. agglo, sans nom + bonne ville — conforme',
         api.verifierGiratoire(N('', 'Coursan'), 'Coursan').length, 0);
verifier('2. agglo, sans nom SANS ville — un écart',
         api.verifierGiratoire(N('', ''), 'Coursan').length, 1);
verifier('2. et c\'est bien la ville qui est en cause',
         api.verifierGiratoire(N('', ''), 'Coursan')[0].champ, 'ville du giratoire');
verifier('3. agglo, mauvaise ville — un écart',
         api.verifierGiratoire(N('', 'Narbonne'), 'Coursan').length, 1);
let e = api.verifierGiratoire(N('Rond-point des Vignes', 'Coursan'), 'Coursan');
verifier('4. agglo, avec un NOM — un écart', e.length, 1);
verifier('4. c\'est le nom qui est interdit', e[0].champ, 'nom interdit (giratoire)');
verifier('4. la cible proposee est « sans nom / ville »', e[0].apres, '‹sans nom› / Coursan');

// ── Hors agglomeration : sans nom, SANS ville ─────────────────────────────
verifier('5. hors agglo, sans nom sans ville — conforme',
         api.verifierGiratoire(N('', ''), '').length, 0);
e = api.verifierGiratoire(N('', 'Coursan'), '');
verifier('6. hors agglo, avec une ville — un écart', e.length, 1);
verifier('6. la cible retire la ville', e[0].apres, '‹sans nom› / ‹sans ville›');
e = api.verifierGiratoire(N('Rond-point du Stade', 'Coursan'), '');
verifier('7. hors agglo, nom + ville — un écart, cible complète', e.length, 1);
verifier('7. cible = sans nom ET sans ville', e[0].apres, '‹sans nom› / ‹sans ville›');

// ── Village rattache : LE defaut corrige en v2.11 ──────────────────────────
console.log('\n=== Village rattache : la ville attendue est « Village (Commune) » ===\n');
const ratt = { rattache: true, label: 'Gruissan-Les Ayguades' };
const simple = { rattache: false, label: 'Gruissan' };

verifier('8. polygone simple — la ville est la commune INSEE',
         api.villeAgglo(N('', 'Gruissan'), simple, 'Gruissan').ville, 'Gruissan');
// ⚠️ Cas REEL mesure a Gruissan : 22 giratoires portaient deja « Les Ayguades
// (Gruissan) » / « Gruissan-Plage (Gruissan) ». Le code exigeait « Gruissan » et
// aurait DEGRADE ces 22 nommages justes.
verifier('9. rattache, ville deja au format « Village (Commune) » — inchangee',
         api.villeAgglo(N('', 'Les Ayguades (Gruissan)'), ratt, 'Gruissan').ville,
         'Les Ayguades (Gruissan)');
verifier('10. rattache, ville « Village » seul — complétée',
         api.villeAgglo(N('', 'Les Ayguades'), ratt, 'Gruissan').ville,
         'Les Ayguades (Gruissan)');
verifier('11. rattache, village lisible sur un ALTERNATIF',
         api.villeAgglo(N('', '', [{ name: 'D332', cityName: 'Gruissan-Plage (Gruissan)' }]),
                        ratt, 'Gruissan').ville, 'Gruissan-Plage (Gruissan)');
const sansVille = api.villeAgglo(N('', ''), ratt, 'Gruissan');
verifier('12. rattache, AUCUNE ville — repli sur la commune', sansVille.ville, 'Gruissan');
verifier('12. et un doute est signalé (on ne devine pas le village)',
         /village rattaché/.test(sansVille.doute || ''), true);
lignes.push('  ~~    12. doute : « ' + (sansVille.doute || '') + ' »');

// ── Le verdict complet, giratoire d'un village rattache ────────────────────
console.log('\n=== Bout en bout : giratoire dans un village rattache ===\n');
const namRatt = N('', 'Les Ayguades (Gruissan)');
const villeAttendue = api.villeAgglo(namRatt, ratt, 'Gruissan').ville;
verifier('13. giratoire deja correct dans un rattache — AUCUN écart',
         api.verifierGiratoire(namRatt, villeAttendue).length, 0);
// et avec l'ancien comportement (commune en dur), il y aurait eu un faux ecart
verifier('14. l\'ancien comportement produisait un FAUX écart',
         api.verifierGiratoire(namRatt, 'Gruissan').length, 1);
// giratoire sans ville dans un rattache : l'ecart est LEGITIME (7 cas mesures)
verifier('15. giratoire sans ville dans un rattache — écart légitime',
         api.verifierGiratoire(N('', ''), villeAttendue).length, 1);

// ── Alternatifs : ce que le controle NE regarde pas (constat) ──────────────
e = api.verifierGiratoire(N('', 'Coursan', [{ name: 'D1118', cityName: '' }]), 'Coursan');
lignes.push('  ~~    16. giratoire portant « D1118 » en ALTERNATIF : ' + e.length +
            ' écart — le contrôle ne juge que le nom PRINCIPAL. À faire trancher : ' +
            'la norme dit-elle quelque chose des alternatifs sur un giratoire ?');

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
