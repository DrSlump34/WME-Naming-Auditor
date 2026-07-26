/**
 * Tests de la conversion HN -> RPP — chantier fonctionnel de l'audit.
 *
 * C'est l'operation qui ECRIT le plus dans la carte, et la regle est TOUT OU
 * RIEN : creer le POI sans retirer le numero laisse une adresse EN DOUBLE, pire
 * que l'ecart de depart (vecu, cf. memoire du projet).
 *
 * ⚠️ La fonction est EXTRAITE du userscript, pas recopiee. Ses dependances (SDK,
 * referentiel, contours) sont remplacees par des doublures qui echouent LA OU ON
 * VEUT : c'est le seul moyen d'eprouver le rattrapage d'erreur sans toucher a la
 * carte reelle.
 *
 * Usage : node tools/test-hn-rpp.js
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

/**
 * Monte un environnement de conversion. `pannes` dit quelle etape doit echouer.
 * Rend l'etat de la carte simulee apres l'operation.
 */
function jouer(pannes, options) {
  options = options || {};
  const carte = { pois: new Map(), hns: new Map([['h1', { id: 'h1', number: 12 }]]) };
  let seq = 0;
  const DM = {
    Venues: {
      addVenue() {
        if (pannes.addVenue) throw new Error('addVenue refuse');
        const id = ++seq;                        // ⚠️ un NOMBRE, comme le vrai SDK
        carte.pois.set(String(id), { adresse: null });
        return id;
      },
      updateAddress({ venueId, addressData }) {
        if (pannes.updateAddress) throw new Error('stateId is required for raw address updates');
        if (!carte.pois.has(venueId)) throw new Error('venue inconnu : ' + venueId);
        carte.pois.get(venueId).adresse = addressData;
      },
      deleteVenue({ venueId }) {
        if (pannes.deleteVenue) throw new Error('deleteVenue refuse');
        carte.pois.delete(venueId);
      }
    },
    HouseNumbers: {
      deleteHouseNumber({ houseNumberId }) {
        if (pannes.deleteHouseNumber) throw new Error('not found in data model');
        carte.hns.delete(houseNumberId);
      }
    }
  };

  const ctx = {
    sdk: { DataModel: DM },
    REF: { adressage: { categoriePoi: 'RESIDENTIAL' } },
    contexteAdresse: () => ({ stateId: 7, countryId: 73 }),
    // `communeDuPoint` rend null quand le point ne tombe dans AUCUN contour
    // charge — cas reel : contours du departement voisin absents de la base.
    communeDuPoint: () => options.horsContours
      ? null : { nom: 'Saint-Michel-d\'Euzet', code: '30287' },
    hnsManipulables: f => f.hns,
    crees: []
  };
  const code = extraire('convertirHnEnPoi');
  const fn = new Function('sdk', 'REF', 'contexteAdresse', 'communeDuPoint',
                          'hnsManipulables', 'crees',
                          code + '\nreturn convertirHnEnPoi;')(
    ctx.sdk, ctx.REF, ctx.contexteAdresse, ctx.communeDuPoint,
    ctx.hnsManipulables, ctx.crees);

  const f = {
    segId: 1,
    rueCible: { nom: 'Chemin des Chartreux',
                ville: options.villeCible === undefined
                  ? 'Saint-Michel-d\'Euzet' : options.villeCible },
    hns: [{ id: 'h1', number: 12, geometry: { type: 'Point', coordinates: [4.55, 44.21] } }]
  };
  let res, leve = null;
  try { res = fn(f, null); } catch (e) { leve = e.message; }
  return {
    res, leve, crees: ctx.crees.slice(),
    poisRestants: carte.pois.size,
    poisSansAdresse: [...carte.pois.values()].filter(p => !p.adresse).length,
    hnRestants: carte.hns.size
  };
}

console.log('\n=== Protocole TOUT OU RIEN de la conversion HN -> RPP ===\n');

// A. Tout se passe bien : un POI adresse, le numero retire.
let e = jouer({});
verifier('A. nominal — POI cree et adresse', [e.poisRestants, e.poisSansAdresse], [1, 0]);
verifier('A. nominal — numero retire', e.hnRestants, 0);
verifier('A. nominal — 1 conversion comptee', e.res.faits, 1);
verifier('A. nominal — POI memorise pour selection', e.crees.length, 1);

// B. Creation du POI refusee : on doit GARDER le numero (adresse jamais perdue).
e = jouer({ addVenue: true });
verifier('B. addVenue echoue — aucun POI', e.poisRestants, 0);
verifier('B. addVenue echoue — numero CONSERVE', e.hnRestants, 1);
verifier('B. addVenue echoue — signale', e.res.echecs.length, 1);

// C. Le POI est cree mais son adresse est refusee.
//    ⚠️ C'est le cas qui compte : `stateId is required` est une erreur REELLE du
//    SDK (cf. memoire). Un POI reste-t-il sur la carte, sans adresse ?
e = jouer({ updateAddress: true });
verifier('C. updateAddress echoue — numero CONSERVE', e.hnRestants, 1);
verifier('C. updateAddress echoue — signale', e.res.echecs.length, 1);
verifier('C. updateAddress echoue — AUCUN POI orphelin laisse sur la carte',
         { poisRestants: e.poisRestants, sansAdresse: e.poisSansAdresse },
         { poisRestants: 0, sansAdresse: 0 });

// D. Le numero resiste : le POI doit etre retire, sinon adresse en double.
e = jouer({ deleteHouseNumber: true });
verifier('D. HN non supprimable — POI annule (pas de doublon)', e.poisRestants, 0);
verifier('D. HN non supprimable — numero conserve', e.hnRestants, 1);
verifier('D. HN non supprimable — signale', e.res.echecs.length, 1);
verifier('D. HN non supprimable — non compte comme fait', e.res.faits, 0);

// E. Pire cas : le numero resiste ET l'annulation du POI echoue aussi.
//    La carte porte alors une adresse EN DOUBLE. L'editeur doit le savoir.
e = jouer({ deleteHouseNumber: true, deleteVenue: true });
verifier('E. double echec — le doublon existe bien (POI + HN)',
         { pois: e.poisRestants, hns: e.hnRestants }, { pois: 1, hns: 1 });
const messageE = (e.res && e.res.echecs && e.res.echecs[0]) || '';
verifier('E. double echec — signale a l\'editeur', e.res.echecs.length, 1);
lignes.push('  ~~    E. message rendu : « ' + messageE + ' »');
const ditLeDoublon = /double|doublon|deux fois|subsiste|reste/i.test(messageE);
verifier('E. double echec — le message AVERTIT du doublon', ditLeDoublon, true);

// F. Ni contour charge sous le numero, ni ville de repli : le POI serait cree
//    SANS VILLE. Une adresse sans commune n'est pas une adresse — et la doctrine
//    du projet est claire : la ville du POI EST la commune INSEE.
e = jouer({}, { horsContours: true, villeCible: '' });
lignes.push('  ~~    F. villes retenues : ' +
            JSON.stringify(e.res ? e.res.villes : null) +
            (e.leve ? ' / leve : ' + e.leve : ''));
verifier('F. aucune ville trouvable — conversion refusée, numéro conservé',
         { faits: e.res ? e.res.faits : null, hn: e.hnRestants, pois: e.poisRestants },
         { faits: 0, hn: 1, pois: 0 });

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
