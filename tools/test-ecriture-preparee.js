/**
 * ECRITURE PREPAREE : une correction de segment verifie TOUT avant sa premiere ecriture.
 *
 * ⚠️ ORIGINE : audit du 25/09/2026.
 *  - A5 / C1 : le principal s'ecrivait avant que l'alternatif ne decouvre une commune absente
 *    de Waze ; le bilan disait « Échec » avec une ecriture en attente. Et le principal, ecrit en
 *    clair, ne verifiait jamais que SA ville existe.
 *  - A8 : le cartouche de l'alternatif etait cherche dans les nommages RELUS apres la reecriture
 *    du principal — la source de l'ecusson venait d'etre effacee.
 *  - A10 : une correction de redaction reecrivait la ville LUE A L'ANALYSE.
 *
 * `appliquerCorrection` et `preparerEcriture` sont EXTRAITES du userscript ; le SDK est un faux
 * qui enregistre les ecritures. Chaque correctif a son temoin : la mutation qui le retire doit
 * faire echouer le controle correspondant.
 *
 * Usage : node tools/test-ecriture-preparee.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'WME-Naming-Auditor.user.js', 'utf8');

function extraire(s, entete) {
  const i = s.indexOf(entete);
  if (i < 0) throw new Error('fonction introuvable : ' + entete);
  let prof = 0, j = s.indexOf('{', s.indexOf(')', i));
  for (; j < s.length; j++) {
    if (s[j] === '{') prof++;
    else if (s[j] === '}') { prof--; if (!prof) break; }
  }
  return s.slice(i, j + 1);
}

/** Monte les deux fonctions reelles sur un monde simule. */
function monter(s, monde) {
  const code = [
    extraire(s, 'async function appliquerCorrection('),
    extraire(s, 'function preparerEcriture('),
    extraire(s, 'function resoudreStreet('),
    'return appliquerCorrection;'
  ].join('\n');
  return new Function('evaluerPays', 'pays', 'planDeCorrection', 'segmentsEditables', 'sdk',
    'readNaming', 'cartoucheAReprendre', 'cartoucheDeStreet', 'ecrireCartouche',
    'villeVide', 'log', 'progEnCours', 'cadrerSur', 'demanderNomPrincipal', code)(
    () => ({ etat: 'servi' }), {}, () => monde.plan, ids => ids.slice(), monde.sdk,
    seg => monde.nommage(seg.id), monde.cartoucheAReprendre, () => null,
    (id, t, ty) => { monde.cartouches.push([id, t, ty]); return true; },
    () => ({ id: 0, isEmpty: true }), () => {}, null, () => {}, async () => null);
}

/** Un monde : deux communes connues, un segment 1 portant « D26 » avec son ecusson. */
function monde(plan, opts) {
  opts = opts || {};
  const m = { plan, ecritures: [], cartouches: [] };
  const etat = { nom: 'D26', ville: opts.ville != null ? opts.ville : '', sign: 'D26' };
  m.nommage = () => ({ primary: { name: etat.nom, cityName: etat.ville,
                                  signText: etat.nom === 'D26' ? etat.sign : '', signType: 2 },
                       alts: [] });
  m.sdk = { DataModel: {
    Segments: {
      getAddress: () => ({ state: opts.sansEtat ? null : { id: 7 }, country: { id: 73 },
                           city: etat.ville ? { name: etat.ville, isEmpty: false } : { isEmpty: true } }),
      updateAddress: a => { m.ecritures.push(['principal', a.addressData]);
                            etat.nom = a.addressData.streetName; etat.ville = a.addressData.cityName; },
      addAlternateStreet: a => m.ecritures.push(['alt', a.streetId])
    },
    Cities: { getCity: ({ cityName }) => ['Coursan', 'Uzès'].includes(cityName) ? { id: cityName } : null },
    Streets: { getStreet: ({ streetName, cityId }) => ({ id: 'st:' + streetName + '|' + cityId }) }
  } };
  // La vraie recherche de source : un nom qui porte deja ce numero AVEC son ecusson.
  m.cartoucheAReprendre = new Function(extraire(src, 'function cartoucheAReprendre(') +
    '\nreturn cartoucheAReprendre;').call(null);
  return m;
}
// `cartoucheAReprendre` lit REF.reRoute : on le lui fournit.
global.REF = { reRoute: /^(?:A|N|D|M|E|T|CR|CV|CC|VC|RC|C)\s?\d+/ };

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
const F = { segIds: [1], libelle: 'x' };
async function jouer(s, plan, opts) {
  const m = monde(plan, opts);
  const r = await monter(s, m)(F);
  return { r, m };
}

const PLAN_A5 = [{ type: 'principal', nom: 'Rue de la Gare', ville: 'Coursan' },
                 { type: 'alt', nom: 'D26', ville: 'Absente' }];
const PLAN_C1 = [{ type: 'principal', nom: 'Rue de la Gare', ville: 'Absente' }];
const PLAN_A10 = [{ type: 'principal', nom: 'Rue du Château', ville: '', garderVille: true }];
const PLAN_A8 = [{ type: 'principal', nom: 'Rue de la Gare', ville: 'Coursan' },
                 { type: 'alt', nom: 'D26', ville: 'Coursan' }];

(async () => {
  console.log('\n=== A5 / C1 : rien ne s\'ecrit si une commune manque ===');
  let { r, m } = await jouer(src, PLAN_A5);
  verifier('A5. alternatif vers une commune absente : refus', r.ok, false);
  verifier('A5. … et AUCUNE ecriture, pas meme le principal', m.ecritures.length, 0);
  verifier('A5. … et le motif le dit', /rien n'a été écrit/.test(r.motif), true);
  ({ r, m } = await jouer(src, PLAN_C1));
  verifier('C1. principal vers une commune absente : refus sans ecriture', [r.ok, m.ecritures.length], [false, 0]);
  ({ r, m } = await jouer(src, PLAN_A8, { sansEtat: true }));
  verifier('contexte Etat introuvable : refus sans ecriture', [r.ok, m.ecritures.length], [false, 0]);

  console.log('\n=== A8 : l\'ecusson se cherche AVANT la reecriture du principal ===');
  ({ r, m } = await jouer(src, PLAN_A8));
  verifier('A8. correction passee', r.ok, true);
  verifier('A8. l\'ecusson D26 est reporte sur l\'alternatif', m.cartouches, [['st:D26|Coursan', 'D26', 2]]);

  console.log('\n=== A10 : la ville d\'une redaction est relue au moment d\'ecrire ===');
  ({ r, m } = await jouer(src, PLAN_A10, { ville: 'Uzès' }));
  verifier('A10. la ville actuelle du segment est gardee', m.ecritures[0] && m.ecritures[0][1].cityName, 'Uzès');

  console.log('\n=== Temoins ===');
  const t = async (titre, mutant, plan, opts, mesure, attendu) => {
    if (mutant === src) { ko++; console.log('  ECHEC temoin introuvable : ' + titre); return; }
    const x = await jouer(mutant, plan, opts);
    verifier('TEMOIN ' + titre, mesure(x), attendu);
  };
  await t('A5 : sans la verification des communes, le principal s\'ecrit',
    src.replace('if (!c) return { motif:', 'if (false) return { motif:'),
    PLAN_A5, null, x => x.m.ecritures.length, 1);
  // Filet : si une ecriture est malgre tout partie avant l'echec, le motif le DIT.
  await t('A5 : … et l\'echec annonce l\'ecriture restee en attente',
    src.replace('if (!c) return { motif:', 'if (false) return { motif:'),
    PLAN_A5, null, x => /1 écriture\(s\) déjà posée\(s\)/.test(x.r.motif), true);
  await t('A8 : relus apres coup, les nommages ont perdu l\'ecusson',
    src.replace('cartoucheAReprendre(op.nom, nomsAvant)',
                'cartoucheAReprendre(op.nom, ids.map(id => readNaming({ id: id })))'),
    PLAN_A8, null, x => x.m.cartouches.length, 0);
  await t('A10 : avec la ville de l\'analyse, elle est effacee',
    src.replace('op.garderVille ? a.ville : (op.ville || \'\')', '(op.ville || \'\')'),
    PLAN_A10, { ville: 'Uzès' }, x => x.m.ecritures[0][1].cityName, '');

  console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
  process.exit(ko ? 1 : 0);
})();
