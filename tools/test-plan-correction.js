/**
 * LE PLAN DE CORRECTION — ce que le ⚡ va ECRIRE, branche par branche.
 *
 * ⚠️ ORIGINE : audit du 25/09/2026. Les branches « ville interdite » et « giratoire » de
 * `planDeCorrection` n'avaient AUCUN banc : leurs mutations passaient les 34 bancs au vert. Or
 * c'est cette fonction qui decide de ce qui part dans l'editeur.
 *
 * La fonction est EXTRAITE du userscript (jamais recopiee) et evaluee telle quelle. Chaque cas
 * dit ce que le plan DOIT contenir — et, pour les branches sensibles, un TEMOIN : la meme
 * fonction, branche retiree, doit faire echouer le cas.
 *
 * Usage : node tools/test-plan-correction.js [fichier.user.js]
 */
'use strict';
const fs = require('fs');

const SRC_PAR_DEFAUT = 'WME-Naming-Auditor.user.js';
function extraire(src, nom) {
  const i = src.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let prof = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, j + 1);
}
const charger = src => new Function(extraire(src, 'planDeCorrection') + '\nreturn planDeCorrection;')();

const src = fs.readFileSync(process.argv[2] || SRC_PAR_DEFAUT, 'utf8');
const plan = charger(src);

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
  if (a === b) { ok++; console.log('  ok   ' + titre); }
  else { ko++; console.log('  ECHEC ' + titre + '\n         attendu ' + b + '\n         obtenu  ' + a); }
}
const sansCandidats = ops => ops && ops.map(o => { const c = Object.assign({}, o); if (c.candidats === null) delete c.candidats; return c; });

// ── Les cas ──────────────────────────────────────────────────────────────────
const CAS = {
  villeInterdite: { cible: { primary: { name: 'A7', cityName: '' } }, libelle: 'A7 / Bollène',
                    ecarts: [{ champ: 'ville interdite (principal)', avant: 'A7 / Bollène', apres: 'A7 / ‹sans ville›' }] },
  giratoire: { cas: 'GIR', cible: { primary: { name: '', cityName: 'Bollène' } }, libelle: 'Rond-point du Moulin / Bollène',
               ecarts: [{ champ: 'giratoire nommé', avant: 'Rond-point du Moulin', apres: '‹sans nom›' }] },
  principalEtAlt: { cible: { primary: { name: 'D26', cityName: '' } }, libelle: 'Route de Bagnols / Bollène',
                    ecarts: [{ champ: 'principal', avant: 'Route de Bagnols / Bollène', apres: 'D26 / ‹sans ville›' },
                             { champ: 'alt manquant', avant: '', apres: 'Route de Bagnols / Bollène' }] },
  redaction: { cible: { primary: { name: 'Rue des écoles', cityName: 'Bollène' } }, libelle: 'Rue des ecoles / Bollène',
               villeActuelle: 'Bollène',
               ecarts: [{ champ: 'rédaction (dictionnaire FR)', avant: 'Rue des ecoles', apres: 'Rue des Écoles' }] },
  redactionCapitales: { cible: { primary: { name: 'x', cityName: '' } }, libelle: 'RUE DES ECOLES',
                        ecarts: [{ champ: 'rédaction (dictionnaire FR)', avant: 'RUE DES ECOLES', apres: 'RUE DES ÉcolES', sansProposition: true }] },
};

console.log('\n=== 1. Branches qui n\'avaient aucun banc ===');
verifier('ville interdite : le principal est repointe SANS ville',
         sansCandidats(plan(CAS.villeInterdite)), [{ type: 'principal', nom: 'A7', ville: '' }]);
verifier('giratoire : le principal devient « sans nom », la ville reste',
         sansCandidats(plan(CAS.giratoire)), [{ type: 'principal', nom: '', ville: 'Bollène' }]);

console.log('\n=== 2. Branches courantes ===');
verifier('principal + alternatif manquant : deux ecritures, dans cet ordre',
         sansCandidats(plan(CAS.principalEtAlt)),
         [{ type: 'principal', nom: 'D26', ville: '' }, { type: 'alt', nom: 'Route de Bagnols', ville: 'Bollène' }]);
verifier('redaction : le nom redresse, la ville reprise telle quelle',
         sansCandidats(plan(CAS.redaction)), [{ type: 'principal', nom: 'Rue des Écoles', ville: 'Bollène' }]);
verifier('redaction sans proposition (capitales) : rien', plan(CAS.redactionCapitales), null);

console.log('\n=== 3. Ce qui ne doit JAMAIS ecrire ===');
verifier('deja traite : rien', plan(Object.assign({}, CAS.villeInterdite, { traite: true })), null);
verifier('une MESURE (HN-RTE) : rien', plan({ adresse: true, mesure: true, sousType: 'hn', rueCible: 'x', hns: [1] }), null);
verifier('conversion HN sur segment non editable : rien', plan({ adresse: true, sousType: 'hn', rueCible: 'x', hns: [1], editable: false }), null);
verifier('cartouche sur une voie entierement verrouillee : rien',
         plan({ cartouche: { streetId: 1, signText: 'D26', signType: 5 }, verrouilles: 3, nb: 3 }), null);
verifier('sans cible : rien', plan({ ecarts: [{ champ: 'principal' }] }), null);

// ── Temoins : la branche retiree, le cas doit echouer ──────────────────────────
console.log('\n=== 4. Temoins (le banc sait-il voir la branche disparaitre ?) ===');
function temoin(titre, motif, cas, attendu) {
  const i = src.indexOf(motif);
  if (i < 0) { ko++; console.log('  ECHEC temoin « ' + titre + ' » : motif introuvable dans le script'); return; }
  const p2 = charger(src.slice(0, i) + 'if (false) ' + src.slice(i));
  const mord = JSON.stringify(sansCandidats(p2(cas))) !== JSON.stringify(attendu);
  if (mord) { ok++; console.log('  ok   temoin : sans la branche « ' + titre + ' », le cas echoue'); }
  else { ko++; console.log('  ECHEC temoin : la branche « ' + titre + ' » retiree, le cas passe encore'); }
}
temoin('ville interdite', "if (cur.some(e => /^ville interdite \\(principal\\)/.test(e.champ))",
       CAS.villeInterdite, [{ type: 'principal', nom: 'A7', ville: '' }]);
temoin('giratoire', "if (f.cas === 'GIR'", CAS.giratoire, [{ type: 'principal', nom: '', ville: 'Bollène' }]);

console.log('\n%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
