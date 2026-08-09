/**
 * Tests du POIDS DES CONTOURS ET DE LEUR DECHARGEMENT — v2.35.00.
 *
 * ⭐ ORIGINE : audit de performance de Corentin48 (09/08/2026). Les deux
 * premiers griefs de son IA tombaient a la mesure, mais il en a ajoute un
 * troisieme qui, lui, tenait : la MEMOIRE. Mesure sur la base reelle de
 * l'auteur — 12 departements, 4 113 communes, 1 558 011 points, heap de
 * 181,8 a 278,8 Mo, soit 97 Mo MESURES dans Chrome, remontes a CHAQUE
 * demarrage par `restaurerContours`. Rien ne les liberait jamais.
 *
 * ⚠️⚠️ CE QUE CES TESTS PROTEGENT AVANT TOUT — LE PIEGE N°1 : retirer un
 * departement SANS vider `depsTentes` en ferait un aller sans retour dans la
 * session. `autoChargerDepartement` ne retente jamais un departement deja
 * tente (« une seule tentative », v2.09) : l'editeur qui revient sur sa zone
 * la trouverait vide, sans aucun moyen de la recharger. Le verrou n°9 est la
 * pour ca, et il ne doit jamais etre « simplifie ».
 *
 * ⚠️ TESTS DE VOLONTE (n°10 a 12) : trois choses ne se purgent JAMAIS — ce
 * qu'on regarde, la commune en cours, et les N derniers utilises. Ce ne sont
 * pas des optimisations, ce sont des refus. Le jour ou l'un tombe, c'est une
 * decision qu'on reprend.
 *
 * ⚠️ Fonctions EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-purge-contours.js
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
function relire(nom) {
  const m = src.match(new RegExp('const\\s+' + nom + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('constante introuvable : ' + nom);
  return 'const ' + nom + ' = ' + m[1] + ';';
}
/**
 * ⚠️ `relire` coupe au PREMIER point-virgule : elle ne sait pas lire une
 * flechee a corps en accolades comme `depDuCode`, dont le corps en contient un.
 * Celle-ci equilibre les accolades. (Defaut trouve en ecrivant ces tests : la
 * capture rendait « c => { const s = String(c || '') », qui ne compile pas.)
 */
function relireFlechee(nom) {
  const i = src.indexOf('const ' + nom + ' =');
  if (i < 0) throw new Error('constante introuvable : ' + nom);
  let j = src.indexOf('{', i), prof = 0;
  if (j < 0) throw new Error('corps introuvable : ' + nom);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, j + 1) + ';';
}
/** Corps d'une fonction, pour les verrous qui lisent la SOURCE. */
function corps(nom) { return extraire(nom); }

const api = new Function([
  relire('OCTETS_PAR_POINT'),
  relireFlechee('depDuCode'),
  relire('SEUIL_ALERTE_OCTETS'),
  extraire('pointsDeGeom'),
  extraire('pointsDeCommune'),
  extraire('direPoids'),
  extraire('departementsAPurger'),
  // `statsParDep` lit `communes` et `DEPARTEMENTS` : on les fournit en variables
  // de portee, comme le fait le script.
  'let communes = [];',
  'const DEPARTEMENTS = [{code:"30",nom:"Gard"},{code:"34",nom:"Herault"},{code:"62",nom:"Pas-de-Calais"}];',
  extraire('statsParDep'),
  'return { OCTETS_PAR_POINT, depDuCode, SEUIL_ALERTE_OCTETS, pointsDeGeom, pointsDeCommune, direPoids,',
  '         departementsAPurger, statsParDep, setCommunes: c => { communes = c; } };'
].join('\n'))();

let ok = 0, ko = 0;
const t = (nom, cond, detail) => {
  if (cond) { ok++; console.log('  ok   ' + nom); }
  else { ko++; console.log('  ECHEC ' + nom + (detail ? '  -> ' + detail : '')); }
};

// Un contour carre de 5 points (le dernier ferme l'anneau).
const carre = (x, y) => ({ type: 'Polygon',
  coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] });
const multi = { type: 'MultiPolygon', coordinates: [
  [[[0, 0], [1, 0], [1, 1], [0, 0]]],
  [[[5, 5], [6, 5], [6, 6], [5, 5]]] ] };

console.log('\n=== 1-4. Compter les points ===');
t('1. Polygon simple = 5 points', api.pointsDeGeom(carre(0, 0)) === 5, String(api.pointsDeGeom(carre(0, 0))));
t('2. MultiPolygon = somme des anneaux', api.pointsDeGeom(multi) === 8, String(api.pointsDeGeom(multi)));
t('3. geometrie absente = 0, sans lever', api.pointsDeGeom(null) === 0);
t('4. geometrie sans coordonnees = 0', api.pointsDeGeom({ type: 'Polygon' }) === 0);

console.log('\n=== 5-8. Mettre un poids en mots ===');
t('5. au-dela du Mo, une decimale a la francaise', api.direPoids(15.5 * 1048576) === '15,5 Mo', api.direPoids(15.5 * 1048576));
t('6. en dessous, des Ko entiers', api.direPoids(480 * 1024) === '480 Ko', api.direPoids(480 * 1024));
t('7. zero ne dit pas « 0,0 Mo »', api.direPoids(0) === '0 Ko', api.direPoids(0));
t('8. le seuil d alerte vaut 40 Mo', api.SEUIL_ALERTE_OCTETS === 40 * 1048576);

console.log('\n=== 9. VERROU — le piege n°1 : depsTentes doit etre vide ===');
const srcRetirer = corps('retirerDepartements');
t('9. retirerDepartements vide depsTentes des codes retires',
  /depsTentes\.delete/.test(srcRetirer),
  'SANS CA, un departement retire est IRRECUPERABLE dans la session');

console.log('\n=== 10-12. TESTS DE VOLONTE — ce qui ne se purge JAMAIS ===');
const enBase = ['30', '34', '62', '13', '84'];
t('10. ce qu on a SOUS LES YEUX ne part jamais',
  !api.departementsAPurger(enBase, ['62'], null, [], 0).includes('62'));
t('11. le departement de la COMMUNE EN COURS ne part jamais',
  !api.departementsAPurger(enBase, [], '13', [], 0).includes('13'));
t('12. les N derniers VUS ne partent jamais',
  (() => { const r = api.departementsAPurger(enBase, [], null, ['84', '30'], 2);
           return !r.includes('84') && !r.includes('30'); })());

console.log('\n=== 13-16. Ce que la purge emporte, elle ===');
t('13. le reste part bien',
  api.departementsAPurger(enBase, ['62'], '13', ['84'], 1).sort().join(',') === '30,34');
t('14. garde=0 ne protege que la vue et la commune en cours',
  api.departementsAPurger(enBase, ['62'], '13', ['84', '30'], 0).sort().join(',') === '30,34,84');
t('15. un doublon vue/commune/vus ne casse rien',
  api.departementsAPurger(enBase, ['30'], '30', ['30'], 3).includes('30') === false);
t('16. rien a purger quand tout est protege',
  api.departementsAPurger(['30'], ['30'], '30', ['30'], 3).length === 0);

console.log('\n=== 17-20. Regrouper par departement ===');
api.setCommunes([
  { code: '30001', nom: 'A', geom: carre(0, 0) },
  { code: '30002', nom: 'B', geom: carre(1, 1) },
  { code: '34001', nom: 'C', geom: multi },
  { code: '62001', nom: 'D', geom: carre(2, 2) }
]);
const st = api.statsParDep();
t('17. un groupe par departement', st.length === 3, String(st.length));
t('18. les communes sont comptees', (st.find(e => e.code === '30') || {}).communes === 2);
// ⚠️ Mon premier attendu ici etait FAUX, pas le code : le dep. 30 porte DEUX
// carres (10 points) contre 8 au MultiPolygon du 34. On verifie donc la
// propriete — poids decroissant — plutot qu'un ordre recopie a la main.
t('19. le plus LOURD vient en tete (c est lui qu on vise)',
  st.every((e, i) => i === 0 || st[i - 1].octets >= e.octets) && st[0].code === '30',
  st.map(e => e.code + ':' + e.octets).join(' '));
t('20. le nom du departement est resolu', (st.find(e => e.code === '62') || {}).nom === 'Pas-de-Calais');

console.log('\n=== 21-23. Le facteur de poids est MESURE, pas devine ===');
t('21. 70 octets par point (mesure 09/08 : 69,9 / 70,3 / 70,0 sur les dep. 78, 77, 62)',
  api.OCTETS_PAR_POINT === 70, String(api.OCTETS_PAR_POINT));
// Croisement : 1 558 011 points reels annoncaient 104 Mo pour 97 MESURES en live.
const ecart = Math.abs(1558011 * api.OCTETS_PAR_POINT / 1048576 - 97) / 97;
t('22. sur la base reelle, l ecart au heap mesure reste sous 10 %',
  ecart < 0.10, (100 * ecart).toFixed(1) + ' %');
t('23. l UI presente le chiffre comme une ESTIMATION (le signe approx.)',
  /agn-dep-approx/.test(src) && /Ordre de grandeur/.test(src));

console.log('\n=== 24-27. VERROUS de branchement ===');
const srcPurger = corps('purgerEloignes');
t('24. purgerEloignes ne fait RIEN si l option est decochee',
  /if\s*\(\s*!options\.purgeAuto\s*\)\s*return/.test(srcPurger));
t('25. la purge est DECOCHEE par defaut (le cumul reste le contrat affiche)',
  /purgeAuto:\s*false/.test(src));
t('26. la purge passe APRES le chargement, jamais avant (sinon elles se battent)',
  /autoChargerDepartement\(\)[\s\S]{0,200}\.then\(purgerEloignes\)/.test(src));
t('27. un dechargement se DIT a l ecran, pas seulement dans la console',
  /dernierePurge\s*=\s*\{/.test(srcPurger) && /agn-info/.test(src));

console.log('\n=== 31-33. Le comptage est RETENU (mesure : 47 ms sinon) ===');
// ⚡ Recompter les points a chaque rendu coutait 47 ms sur la base reelle
// (4 113 communes, 1 558 011 points) — presque trois frames. Mesure en live le
// 09/08 ; apres memoisation : 2,11 ms, soit x22. Ces trois tests empechent le
// retour en arriere.
const cRetenu = { code: '30001', nom: 'A', geom: carre(0, 0) };
t('31. le premier appel calcule et RETIENT sur la commune',
  api.pointsDeCommune(cRetenu) === 5 && cRetenu._pts === 5, JSON.stringify(cRetenu._pts));
t('32. un compte deja pose n est pas recalcule',
  (() => { const c = { code: '30002', geom: carre(0, 0), _pts: 999 };
           return api.pointsDeCommune(c) === 999; })(),
  'sinon le cache ne sert a rien');
t('33. le chargement pose _pts, pour que les demarrages suivants soient gratuits',
  /_pts:\s*pointsDeGeom\(f\.geometry\)/.test(src));
t('34. statsParDep et poidsContours passent par le compte RETENU',
  /e\.points\s*\+=\s*pointsDeCommune\(c\)/.test(src)
  && /poidsContours[\s\S]{0,120}pointsDeCommune\(c\)/.test(src),
  'un seul des deux suffirait a ramener les 47 ms');

console.log('\n=== 28-30. Ce que le retrait NE touche PAS ===');
t('28. les agglomerations tracees ne sont pas touchees',
  !/agglos\s*=\s*\{\}/.test(srcRetirer) && !/delete\s+agglos/.test(srcRetirer));
t('29. la commune en cours est lachee proprement si son departement part',
  /communeActive\s*=\s*null/.test(srcRetirer) && /communePerdue/.test(srcRetirer));
t('30. la base est reecrite apres retrait (sinon le retour de session la ressuscite)',
  /idbSet\('communes'/.test(srcRetirer) && /idbSet\('meta'/.test(srcRetirer));

console.log('\n' + (ko ? 'ECHECS : ' + ko : 'TOUT PASSE') + '  (' + ok + ' verifications)');
process.exit(ko ? 1 : 0);
