#!/usr/bin/env node
/**
 * CONVERSION NUMÉRO → RPP : CONTRÔLE DES DOUBLONS, ET UN NUMÉRO PAR GESTE (2.52.00).
 *
 * Audit doctrine France (fiche 588554, axe 3) : la conversion créait le POI résidentiel sans
 * chercher si un RPP portait DÉJÀ cette adresse. Désormais, avant `addVenue` : un POI résidentiel
 * au même numéro et à la même rue (normalisation de `cleNumeroRue` : casse, accents, « 4 BIS » =
 * « 4bis ») à moins de RPP_EXISTANT_M ⇒ rien n'est créé, rien n'est retiré.
 * Arbitrage de l'auteur (11/10/2026) : la conversion reste admise, ADRESSE PAR ADRESSE — aucun
 * chemin ne convertit plusieurs numéros d'un geste.
 *
 * Fonctions EXTRAITES du userscript ; le SDK est doublé. ⭐ TÉMOINS : chaque garde est retiré du
 * source, et le banc exige alors l'ÉCHEC de l'assertion.
 *
 * Usage : node tools/test-rpp-doublon.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'WME-Naming-Auditor.user.js'), 'utf8');

let ok = 0, ko = 0;
const dit = (b, quoi, d) => { console.log('  ' + (b ? 'ok  ' : 'KO  ') + ' ' + quoi + (d !== undefined ? '   ' + d : '')); b ? ok++ : ko++; };
const temoin = (tientEncore, quoi) => dit(!tientEncore, 'TÉMOIN — ' + quoi + ' : l\'assertion ÉCHOUE sur le source muté');

function extraire(src, entete) {
  const i = src.indexOf(entete);
  if (i < 0) throw new Error('introuvable : ' + entete);
  let prof = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') prof++; else if (src[j] === '}') { prof--; if (!prof) break; } }
  return src.slice(i, j + 1);
}
function ligne(src, debut) {
  const i = src.indexOf(debut);
  if (i < 0) throw new Error('introuvable : ' + debut);
  let j = src.indexOf(';\n', i);
  // `cleNumeroRue` tient sur trois lignes : on va jusqu'au point-virgule de fin d'instruction.
  return src.slice(i, j + 1);
}

/**
 * Monte la conversion réelle. `pois` : les POI déjà dans le modèle de WME, { id, residential,
 * coords, num, rue }. Rend l'état de la carte simulée après le geste.
 */
function jouer(src, pois, f) {
  const carte = { crees: [], hns: new Set((f.hns || []).map(h => h.id)) };
  let seq = 0;
  const DM = {
    Venues: {
      getAll: () => pois.map(p => ({ id: p.id, isResidential: p.residential !== false,
                                     geometry: { type: 'Point', coordinates: p.coords } })),
      getAddress: ({ venueId }) => {
        const p = pois.find(x => String(x.id) === venueId);
        return p ? { houseNumber: p.num, street: { name: p.rue } } : null;
      },
      addVenue: () => { const id = --seq; carte.crees.push(String(id)); return id; },
      updateAddress: () => {},
      replaceNavigationPoints: () => {},
      deleteVenue: ({ venueId }) => { carte.crees = carte.crees.filter(x => x !== venueId); }
    },
    HouseNumbers: { deleteHouseNumber: ({ houseNumberId }) => carte.hns.delete(houseNumberId) }
  };
  const code = [
    ligne(src, 'const normSansAccent = '), ligne(src, 'const cleNumeroRue = '),
    ligne(src, 'const distanceM = '), extraire(src, 'function centreGeom('),
    ligne(src, 'const RPP_EXISTANT_M = '), extraire(src, 'function rppExistant('),
    extraire(src, 'function convertirHnEnPoi('), 'return convertirHnEnPoi;'
  ].join('\n');
  const tr = x => x, trf = (x, v) => x.replace(/\{(\w+)\}/g, (m, k) => v && v[k] != null ? String(v[k]) : m);
  const fn = new Function('sdk', 'REF', 'contexteAdresse', 'communeDuPoint', 'hnsManipulables', 'crees', 'tr', 'trf', code)(
    { DataModel: DM }, { adressage: { categoriePoi: 'RESIDENTIAL' } }, () => ({ stateId: 7, countryId: 73 }),
    () => ({ nom: 'Uzès', code: '30334' }), x => x.hns, [], tr, trf);
  let res = null, leve = null;
  try { res = fn(f, null); } catch (e) { leve = e.message; }
  return { res, leve, crees: carte.crees.length, hnRestants: carte.hns.size };
}

// Le numéro 12 du chemin des Chartreux, à Uzès.
const P0 = [4.4200, 44.0120];
const decale = m => [P0[0] + m / (111320 * Math.cos(P0[1] * Math.PI / 180)), P0[1]];
const F1 = { segId: 1, rueCible: { nom: 'Chemin des Chartreux', ville: 'Uzès' },
             hns: [{ id: 'h12', number: '12', geometry: { type: 'Point', coordinates: P0 } }] };

console.log('\n=== Doublon : un RPP porte déjà l\'adresse ===\n');
{
  const r = jouer(SRC, [], F1);
  dit(r.res && r.res.faits === 1 && r.crees === 1 && r.hnRestants === 0, 'aucun RPP voisin : conversion faite (POI créé, numéro retiré)');
  dit(r.res && r.res.editions.map(e => e.o).join(',') === 'v,h', 'elle coûte deux éditions au quota (RPP créé, numéro retiré)');
}
const DBL = [{ id: 'v1', coords: decale(20), num: '12', rue: 'Chemin des Chartreux' }];
{
  const r = jouer(SRC, DBL, F1);
  dit(r.res && r.res.faits === 0 && r.crees === 0 && r.hnRestants === 1,
    'RPP « 12 Chemin des Chartreux » à 20 m : RIEN créé, numéro GARDÉ', JSON.stringify({ c: r.crees, hn: r.hnRestants }));
  dit(r.res && /existe déjà à 20 m — rien n'a été créé ni retiré/.test(r.res.echecs[0] || ''), 'le motif le dit, distance comprise', r.res && r.res.echecs[0]);
  dit(r.res && r.res.editions.length === 0, 'rien n\'est compté au quota');
}
{
  const r = jouer(SRC, [{ id: 'v1', coords: decale(15), num: '12 BIS', rue: 'CHEMIN DES CHARTREUX' }],
    Object.assign({}, F1, { hns: [{ id: 'h12', number: '12bis', geometry: { type: 'Point', coordinates: P0 } }] }));
  dit(r.crees === 0 && r.hnRestants === 1, 'casse et « 12 BIS » / « 12bis » : même adresse, rien créé');
}
{
  const r = jouer(SRC, [{ id: 'v1', coords: decale(10), num: '12', rue: 'Chemin des Chartréux' }], F1);
  dit(r.crees === 0, 'accent en plus sur la rue : même adresse, rien créé');
}
{
  const r = jouer(SRC, [{ id: 'v1', coords: decale(80), num: '12', rue: 'Chemin des Chartreux' }], F1);
  dit(r.crees === 1 && r.hnRestants === 0, 'même adresse mais à 80 m (au-delà de 50 m) : conversion faite');
}
{
  const r = jouer(SRC, [{ id: 'v1', coords: decale(5), num: '14', rue: 'Chemin des Chartreux' }], F1);
  dit(r.crees === 1, 'numéro voisin (14) tout près : pas un doublon, conversion faite');
}
{
  const r = jouer(SRC, [{ id: 'v1', coords: decale(5), num: '12', rue: 'Route d\'Alès' }], F1);
  dit(r.crees === 1, 'même numéro sur une AUTRE rue : pas un doublon');
}
{
  const r = jouer(SRC, [{ id: 'v1', coords: decale(5), num: '12', rue: 'Chemin des Chartreux', residential: false }], F1);
  dit(r.crees === 1, 'un lieu NON résidentiel au même numéro : pas un RPP, conversion faite');
}
dit(/const RPP_EXISTANT_M = 50;/.test(SRC), 'rayon du doublon : 50 m (« quelques dizaines de mètres »)');
// Le contrôle passe AVANT addVenue, dans la boucle.
{
  const c = extraire(SRC, 'function convertirHnEnPoi(');
  dit(c.indexOf('rppExistant(') > 0 && c.indexOf('rppExistant(') < c.indexOf('addVenue('), 'le contrôle précède `addVenue`');
}
// TÉMOIN : sans le garde, le doublon serait créé et le numéro supprimé.
{
  const mut = SRC.replace('      if (dbl) {', '      if (false) {');
  dit(mut !== SRC, 'mutation du garde trouvée');
  const r = jouer(mut, DBL, F1);
  temoin(r.crees === 0 && r.hnRestants === 1, 'garde de doublon retiré');
}

console.log('\n=== Un numéro par geste ===\n');
const F2 = Object.assign({}, F1, { hns: [F1.hns[0], { id: 'h14', number: '14', geometry: { type: 'Point', coordinates: decale(30) } }] });
{
  const r = jouer(SRC, [], F2);
  dit(r.leve && /un seul numéro à la fois/.test(r.leve) && r.crees === 0 && r.hnRestants === 2,
    'report à DEUX numéros : refus, rien créé, rien retiré', r.leve);
  const mut = SRC.replace("if ((f.hns || []).length !== 1) throw new Error(tr('conversion refusée", "if (false) throw new Error(tr('conversion refusée");
  dit(mut !== SRC, 'mutation du garde « un numéro » trouvée');
  const m = jouer(mut, [], F2);
  temoin(m.crees === 0, 'garde « un numéro » retiré (2 conversions d\'un geste)');
}
{
  // Le ⚡ de groupe n'accepte jamais une adresse ni un POI, quelle que soit la famille.
  const grp = new Function('planDeCorrection', extraire(SRC, 'function corrigeableEnGroupe(') + '\nreturn corrigeableEnGroupe;')(() => [{ type: 'hn2poi' }]);
  dit(grp({ adresse: true, sousType: 'hn' }) === false, '⚡ de groupe : une conversion de numéro n\'y entre jamais');
  dit(grp({ poi: true }) === false, '⚡ de groupe : l\'adresse d\'un POI non plus');
  dit(grp({ cible: {} }) === true, 'TÉMOIN positif : un renommage de segment y entre');
  const mut = SRC.replace('if (f.adresse || f.poi) return false;', '');
  const g2 = new Function('planDeCorrection', extraire(mut, 'function corrigeableEnGroupe(') + '\nreturn corrigeableEnGroupe;')(() => [{ type: 'hn2poi' }]);
  temoin(g2({ adresse: true, sousType: 'hn' }) === false, 'exclusion des adresses retirée de corrigeableEnGroupe');
  // Et `corriger` refuse toute série qui contiendrait une adresse.
  dit(/if \(liste\.length > 1 && liste\.some\(f => f\.adresse \|\| f\.poi\)\) \{[\s\S]{0,160}return;/.test(extraire(SRC, 'async function corriger(')),
    'une série de plusieurs reports contenant une adresse est refusée entière');
}

console.log('\n' + (ko ? '❌ ' + ko + ' ECHEC(S)' : '✅ TOUT PASSE') + '   (' + ok + ' assertions)\n');
process.exit(ko ? 1 : 0);
