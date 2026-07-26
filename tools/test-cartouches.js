/**
 * Tests du CARTOUCHE SUR LE NOM PRINCIPAL — chantier fonctionnel de l'audit.
 *
 * Enjeu : le cartouche est porte par la STREET, qui est PARTAGEE entre tous les
 * segments de la voie. Le poser vaut donc pour la voie ENTIERE. D'ou la regle de
 * l'auteur : n'y toucher que si TOUS les segments de la voie portent le MEME
 * numero-avec-cartouche en alternatif — sinon le cartouche deborderait sur des
 * segments qui ne sont pas cette route.
 *
 * ⚠️ Les fonctions sont EXTRAITES du userscript, pas recopiees. `collecterCartouche`
 * et `cartouchesPrincipal` vivent dans la fermeture de `scan()` : on leur injecte
 * `cartInfo` et leurs dependances.
 *
 * Usage : node tools/test-cartouches.js
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
/** Relit une constante/lambda du source plutot que de la recopier. */
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

const PREAMBULE = [relire('RE_AUTOROUTE'), relire('RE_ROUTE'),
                   relire('estNumero'), relire('sansCartouche'), relire('fmt')].join('\n');

/**
 * Joue un jeu de segments a travers les VRAIES fonctions du script.
 * `segments` : [{ alts:[{name, signText, signType}], principalCartouche? }]
 */
function jouer(segments, opts) {
  opts = opts || {};
  const cartInfo = new Map();
  const code = PREAMBULE + '\n' + extraire('collecterCartouche') + '\n' +
               extraire('cartouchesPrincipal') + '\n' +
               'return { collecterCartouche, cartouchesPrincipal };';
  const api = new Function('cartInfo', code)(cartInfo);

  segments.forEach((s, i) => {
    const nam = {
      primary: { name: opts.nomVoie || 'Avenue Jean Jaurès', cityName: 'Coursan',
                 signText: s.principalCartouche ? s.principalCartouche : '',
                 signType: s.principalCartouche ? 1092 : null },
      primaryId: opts.streetId === undefined ? 100 : opts.streetId,
      alts: (s.alts || []).map(a => ({
        name: a.name, cityName: 'Coursan',
        signText: a.signText === undefined ? a.name : a.signText,
        signType: a.signType === undefined ? 1092 : a.signType }))
    };
    api.collecterCartouche({ id: 1000 + i, geometry: null }, nam,
                           { centre: null, editable: true });
  });
  const out = api.cartouchesPrincipal();
  return { out, cartInfo };
}

const D = n => ({ name: n });                                  // Dxxx avec cartouche
const sansShield = n => ({ name: n, signText: '', signType: null });   // numero SANS cartouche

console.log('\n=== Cartouche sur le nom principal : eligibilite par VOIE ===\n');

// 1. Tous les segments portent le meme Dxxx-cartouche => on propose.
let r = jouer([{ alts: [D('D1118')] }, { alts: [D('D1118')] }, { alts: [D('D1118')] }]);
verifier('1. tous le meme cartouche — 1 report', r.out.length, 1);
verifier('1. le bon cartouche', r.out[0] && r.out[0].cartouche.signText, 'D1118');
verifier('1. porte sur les 3 segments', r.out[0] && r.out[0].nb, 3);

// 2. UN SEUL segment sans le numero => la voie n'est que partiellement la route.
r = jouer([{ alts: [D('D1118')] }, { alts: [] }, { alts: [D('D1118')] }]);
verifier('2. un segment sans numero — AUCUN report', r.out.length, 0);

// 3. Deux numeros differents selon les segments => on s'abstient.
r = jouer([{ alts: [D('D1118')] }, { alts: [D('D6009')] }]);
verifier('3. cartouches differents — AUCUN report', r.out.length, 0);

// 4. Le principal porte DEJA un cartouche => rien a faire.
r = jouer([{ alts: [D('D1118')], principalCartouche: 'D1118' },
           { alts: [D('D1118')], principalCartouche: 'D1118' }]);
verifier('4. principal deja cartouche — AUCUN report', r.out.length, 0);

// 5. AUTOROUTE en alternatif : exclue (« ca vaut pour tout sauf les Axxx »).
//    Le segment se retrouve donc sans numero eligible => pas de report.
r = jouer([{ alts: [D('A61')] }, { alts: [D('A61')] }]);
verifier('5. autoroute A61 — exclue, AUCUN report', r.out.length, 0);

// 6. Numero de route SANS cartouche renseigne : il n'y a rien a recopier.
r = jouer([{ alts: [sansShield('D1118')] }, { alts: [sansShield('D1118')] }]);
verifier('6. numero sans cartouche — AUCUN report', r.out.length, 0);

// 7. Une voie d'UN SEUL segment est un cas legitime (mesure sur Coursan :
//    « Avenue Yvan Pelissier », 1 segment).
r = jouer([{ alts: [D('D1118')] }]);
verifier('7. voie d\'un seul segment — 1 report', r.out.length, 1);

// 8. Le meme cartouche present DEUX FOIS sur un segment ne doit pas passer pour
//    « plusieurs cartouches » (l'intersection est dedoublonnee par un Set).
r = jouer([{ alts: [D('D1118'), D('D1118')] }, { alts: [D('D1118')] }]);
verifier('8. cartouche en double sur un segment — 1 report', r.out.length, 1);

// 9. Un segment porte DEUX numeros dont un commun a tous : l'intersection
//    n'est pas unique cote premier segment, mais elle l'est apres croisement.
r = jouer([{ alts: [D('D1118'), D('D6009')] }, { alts: [D('D1118')] }]);
verifier('9. un commun apres croisement — 1 report', r.out.length, 1);
verifier('9. c\'est bien le commun qui est retenu',
         r.out[0] && r.out[0].cartouche.signText, 'D1118');

// 10. Deux numeros communs a TOUS : ambigu, on s'abstient plutot que de choisir.
r = jouer([{ alts: [D('D1118'), D('D6009')] }, { alts: [D('D1118'), D('D6009')] }]);
verifier('10. deux communs — ambigu, AUCUN report', r.out.length, 0);

// 11. Le principal EST un numero de route (pas un nom de rue) => hors sujet.
r = jouer([{ alts: [D('D1118')] }], { nomVoie: 'D1118' });
verifier('11. principal = numero de route — non recense', r.cartInfo.size, 0);

// 12. Pas d'identifiant de Street : on ne peut rien ecrire, donc rien recenser.
r = jouer([{ alts: [D('D1118')] }], { streetId: null });
verifier('12. sans streetId — non recense', r.cartInfo.size, 0);

// 13. Le report DIT que la correction porte sur toute la voie (l'editeur doit le
//     savoir avant de cliquer : la Street est partagee).
r = jouer([{ alts: [D('D1118')] }, { alts: [D('D1118')] }]);
const doute = (r.out[0] && r.out[0].doute) || '';
lignes.push('  ~~    13. avertissement : « ' + doute + ' »');
verifier('13. avertit que ca vaut pour toute la voie',
         /toute la voie/i.test(doute), true);

// ── Reconnaissance des numeros de route ────────────────────────────────────
// Une erreur ici se propage partout : un nom pris pour un numero (ou l'inverse)
// fausse l'eligibilite ET le nommage attendu.
console.log('\n=== Reconnaissance des numeros de route (RE_ROUTE) ===\n');
const estNum = new Function(PREAMBULE + '\nreturn estNumero;')();
const numeros = ['D1118', 'D 1118', 'N113', 'A61', 'A 61', 'M6009', 'E15', 'T2',
                 'C3', 'CR12', 'CV5', 'D6009', 'D62E', 'D31a'];
for (const n of numeros) verifier('« ' + n + " » est un numéro", estNum({ name: n }), true);
const nonNumeros = ['Avenue Jean Jaurès', 'Route de Cuxac', 'Chemin des Chartreux',
                    'Rue de la Poste', 'Boulevard Gambetta', 'Impasse des Lilas',
                    'Allée du Stade', 'Place de la Mairie'];
for (const n of nonNumeros) verifier('« ' + n + " » n'est PAS un numéro", estNum({ name: n }), false);
// ⚠️ Cas limites reels, a CONSTATER : des noms de voie qui commencent comme un
// numero de route. S'ils passaient pour des numeros, le nommage serait fausse.
for (const n of ['Domaine de Cazaux', 'Camp Redon', 'Route Nationale', 'Chemin Neuf',
                 'Traverse des Vignes', 'Avenue de Narbonne']) {
  const v = estNum({ name: n });
  if (v) lignes.push('  ~~    ⚠️ « ' + n + ' » est pris pour un NUMÉRO de route');
  else verifier('« ' + n + " » n'est pas confondu avec un numéro", v, false);
}

// ── ⚠️⚠️ LA REGLE OFFICIELLE (rappelee par l'auteur le 26/07) ───────────────
// « En agglo, on ne met AUCUN cartouche sur le nom de rue en principal, peu
// importe qu'il existe ou non en Alt. » Le recensement ne doit donc plus voir
// les segments en agglomeration : c'est le SEUL garde-fou, puisque
// `cartouchesPrincipal()` proposerait sinon exactement ce que la regle interdit.
console.log('\n=== La règle officielle : rien en agglomération ===\n');
const appel = src.match(/if \(!enAgglo\) collecterCartouche\(seg, nam, base\);/);
verifier('23. le recensement est conditionné à « hors agglomération »', !!appel, true);
// Verrou de non-regression : que l'ancien appel inconditionnel ne revienne pas.
const inconditionnel = /\n\s*collecterCartouche\(seg, nam, base\);/.test(src);
verifier('24. plus aucun appel inconditionnel', inconditionnel, false);
// Et `verifierCartouches` ne doit RIEN reclamer sur un nom de rue.
const vc = new Function(PREAMBULE + '\n' + extraire('verifierCartouches') +
                        '\nreturn verifierCartouches;')();
const namRue = { primary: { name: 'Avenue Jean Jaurès', cityName: 'Coursan', signText: '', signType: null },
                 alts: [{ name: 'D1118', cityName: '', signText: 'D1118', signType: 1092 }] };
verifier('25. nom de rue en principal + Dxxx cartouché en alt — AUCUN écart',
         vc(namRue).length, 0);
// Ce qui reste juste : un NUMERO en principal sans son cartouche.
const namNum = { primary: { name: 'D1118', cityName: '', signText: '', signType: null }, alts: [] };
verifier('26. numéro en principal sans cartouche — toujours signalé', vc(namNum).length, 1);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
