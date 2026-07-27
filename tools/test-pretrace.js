/**
 * Tests du PRE-TRACE des agglomerations depuis les panneaux (v1.95→v2.20).
 *
 * Ce que ces tests protegent : le pre-trace ne doit JAMAIS fabriquer une surface
 * qu'il ne connait pas. Deux fautes vecues, deux garde-fous :
 *   - v1.98 : des « ronds bizarres » autour de panneaux isoles (Narbonne) —
 *     d'ou l'exigence d'une vraie surface (>= 3 portes, aire >= 15 % de la boite) ;
 *   - v2.20 : un RUBAN pris pour une agglomeration (Lattes, signale par
 *     l'auteur) — 5 panneaux pour 3 224 ha, et un « polygone » de 1 ha, 29 m de
 *     large, soit l'alignement des panneaux le long d'une voie rapide.
 *     La boite etant elle-meme etroite, le test d'aire relative ne voyait rien.
 *
 * ⚠️ Fonctions et constantes EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-pretrace.js
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

function extraire(nom) {
  const i = src.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let par = 0, j = src.indexOf('(', i);
  for (; j < src.length; j++) {
    if (src[j] === '(') par++;
    else if (src[j] === ')') { par--; if (!par) { j++; break; } }
  }
  let prof = 0; j = src.indexOf('{', j);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, j + 1);
}
/** `const NOM = …;` — gere les fleches multi-lignes (accolades comptees). */
function relire(nom) {
  const i = src.indexOf('const ' + nom + ' =');
  if (i < 0) throw new Error('constante introuvable : ' + nom);
  const fin = src.indexOf('\n', i), acc = src.indexOf('{', i);
  if (acc < 0 || acc > fin) {
    return 'const ' + nom + ' = ' + src.slice(i).match(/^const\s+\w+\s*=\s*([^;]+);/)[1] + ';';
  }
  let prof = 0, j = acc;
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++; else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, src.indexOf(';', j) + 1);
}

const api = new Function([
  src.match(/const BOMBAGE_PART[^\n]+/)[0],
  relire('R_TERRE'), relire('versM'), relire('dist2'),
  relire('PORTE_FUSION_M'), relire('CLUSTER_SEUIL_M'), relire('LARGEUR_MIN_AGGLO_M'),
  extraire('hullConvexe'), extraire('bomberCotes'), extraire('proposerPolygones'), extraire('nomDuGroupe'),
  'return { proposerPolygones, nomDuGroupe, LARGEUR_MIN_AGGLO_M, CLUSTER_SEUIL_M };'
].join('\n'))();
const ctx = api;
const { proposerPolygones, LARGEUR_MIN_AGGLO_M, CLUSTER_SEUIL_M } = api;

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else { ko++; lignes.push('  ECHEC ' + titre + '\n          attendu ' +
    JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
function titre(t) { lignes.push('\n' + t); }

// Reperes : a 43,5° nord, 0,001° de latitude ≈ 111 m, 0,001° de longitude ≈ 81 m.
const LAT = 43.5, LON = 3.9;
const M_LAT = 1 / 110540, M_LON = 1 / (111320 * Math.cos(LAT * Math.PI / 180));
/** Fabrique une porte a (dx, dy) metres du repere. */
const porte = (dx, dy) => ({ p: { latitude: LAT + dy * M_LAT, longitude: LON + dx * M_LON },
                             code: 'EB10', value: null });

titre('Une vraie agglomeration : un quadrilatere de 800 m de cote');
{
  const props = proposerPolygones([porte(0, 0), porte(800, 0), porte(800, 800), porte(0, 800)]);
  verifier('1. un seul groupe', props.length, 1);
  verifier('1. et il est TRACABLE', !!props[0].ring, true);
  verifier('1. 4 portes retenues', props[0].portes, 4);
  verifier('1. largeur mesuree bien au-dessus du seuil',
    props[0].largeur > LARGEUR_MIN_AGGLO_M * 2, true);
  verifier('1. pas signale comme ruban', props[0].ruban, false);
}

titre('⚠️ LE CAS LATTES : des panneaux alignes le long d\'une voie');
{
  // 4 portes sur 900 m de long, decalees de 25 m seulement en travers : c'est
  // une route, pas une agglomeration.
  const props = proposerPolygones([porte(0, 0), porte(300, 25), porte(600, 0), porte(900, 25)]);
  verifier('2. ⚠️ NON tracable : on ne fabrique pas une surface a partir d\'une ligne',
    !!props[0].ring, false);
  verifier('2. et c\'est dit : signale comme RUBAN', props[0].ruban, true);
  verifier('2. la largeur mesuree est bien sous le seuil',
    props[0].largeur < LARGEUR_MIN_AGGLO_M, true);
  verifier('2. les portes restent comptees (rien n\'est perdu)', props[0].portes, 4);
  verifier('2. et un centre reste disponible pour cadrer dessus',
    !!(props[0].centre && isFinite(props[0].centre.lat)), true);
}

titre('Les garde-fous de la v1.98 tiennent toujours');
{
  const props = proposerPolygones([porte(0, 0), porte(500, 0)]);
  verifier('3. deux portes seulement ⇒ aucune surface', !!props[0].ring, false);
  verifier('3. … et ce n\'est PAS un ruban (il n\'y a pas de forme du tout)',
    props[0].ruban, false);
}
{
  const props = proposerPolygones([porte(0, 0)]);
  verifier('4. une porte isolee ⇒ rien de trace', !!props[0].ring, false);
}
verifier('5. aucune porte ⇒ aucune proposition', proposerPolygones([]).length, 0);

titre('Le regroupement : deux agglomerations distinctes restent separees');
{
  // Deux carres de 600 m, distants de 5 km : au-dela du seuil de chainage.
  const loin = (dx) => [porte(dx, 0), porte(dx + 600, 0), porte(dx + 600, 600), porte(dx, 600)];
  const props = proposerPolygones([...loin(0), ...loin(5000)]);
  verifier('6. deux groupes distincts', props.length, 2);
  verifier('6. tous deux tracables', props.filter(p => p.ring).length, 2);
}
{
  // Les memes, distants de 1 km : SOUS le seuil, ils fusionnent — c'est voulu,
  // un bourg et son extension immediate ne font qu'une agglomeration.
  const pres = (dx) => [porte(dx, 0), porte(dx + 600, 0), porte(dx + 600, 600), porte(dx, 600)];
  const props = proposerPolygones([...pres(0), ...pres(1000)]);
  verifier('7. a 1 km, ils ne font qu\'un', props.length, 1);
}
verifier('8. le seuil de chainage est reste a 2 km (le rapprocher casse Coursan)',
  CLUSTER_SEUIL_M, 2000);

titre('Les mesures accompagnent la proposition');
{
  const props = proposerPolygones([porte(0, 0), porte(1000, 0), porte(1000, 1000), porte(0, 1000)]);
  const p = props[0];
  verifier('9. aire rendue, en m² et plausible (~1 km² bombe)',
    p.aire > 900000 && p.aire < 2500000, true);
  verifier('9. longueur rendue (diagonale ~1414 m, bombage compris)',
    p.longueur > 1200 && p.longueur < 2200, true);
  verifier('9. largeur = aire / longueur', Math.round(p.largeur), Math.round(p.aire / p.longueur));
}

titre('Le NOM porté par un panneau (suggestion de Glenan56, 27/07)');
{
  // ⚡ « Ton système prend les EB10 sans les LIRE » — il a raison, le panneau
  // porte le nom de l'agglomération. ⚠️ Mais la source est avare : mesure du
  // 27/07 — 19 panneaux sur 116 en portent un a Ploemeur, 1 sur 62 a Lattes,
  // 0 sur 53 a Coursan. On s'en sert quand il est la, jamais on ne compte dessus.
  const groupeAvec = nom => ({ membres: [{ membres: [{ f: { p: { panneau_value: nom } } }] }] });
  verifier('10. ⭐ le nom du panneau devient l\'étiquette du secteur',
    ctx.nomDuGroupe(groupeAvec('Le Courégant')), 'Le Courégant');
  verifier('11. ⚠️ « AGGLO » est GENERIQUE : ce n\'est pas un nom de lieu',
    ctx.nomDuGroupe(groupeAvec('AGGLO')), '');
  verifier('11. … quelle que soit la casse', ctx.nomDuGroupe(groupeAvec('agglo')), '');
  verifier('12. aucun nom ⇒ chaîne vide, jamais d\'erreur',
    ctx.nomDuGroupe(groupeAvec(null)), '');
  verifier('12. groupe sans membres ⇒ chaîne vide aussi', ctx.nomDuGroupe({}), '');
  // Un seul panneau nomme dans le groupe suffit a etiqueter le secteur.
  const melange = { membres: [
    { membres: [{ f: { p: { panneau_value: null } } }] },
    { membres: [{ f: { p: { panneau_value: 'Kerroch' } } }] }] };
  verifier('13. un seul panneau nommé suffit', ctx.nomDuGroupe(melange), 'Kerroch');
}

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(60));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
