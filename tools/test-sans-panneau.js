/**
 * Tests des voies SANS PANNEAU EB10 a cheval sur le polygone d'agglomeration (v2.50.09).
 *
 * ⚠️⚠️ REMONTEE D'ONRYOU (29/09/2026, fil Discord WNA) : « quand le polygone est trace, ca
 * demande de scinder des chemins de terre pour une partie en agglo ». Sa capture : chemin de
 * terre #66113398, sans nom ni ville, « 40 % dans l'agglomeration → a couper au panneau
 * d'entree d'agglomeration (EB10) ».
 *
 * ⭐ Diagnostic de l'auteur : il n'y a pas de panneau EB10 sur un chemin de terre. La « limite »
 * n'est que l'endroit ou le trait du polygone croise le chemin. Regle retenue (auteur, 29/09) :
 * ces voies suivent le cote MAJORITAIRE, jamais de coupe. Types : 5, 8, 10, 16, 17, 20.
 *
 * ⚠️ Fonctions EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-sans-panneau.js
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

const { zonageAgglo } = new Function([
  relire('ROADTYPE_SANS_PANNEAU_EB10'),
  extraire('zonageAgglo'),
  'return { zonageAgglo };'
].join('\n'))();

let ok = 0, ko = 0;
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; console.log('  ok    ' + titre); }
  else {
    ko++;
    console.log('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) +
                '\n          obtenu  ' + JSON.stringify(obtenu));
  }
}
const S = 0.8;   // seuil par defaut

console.log('\n=== Voies sans panneau EB10 a cheval sur le polygone ===\n');

// 1. Le cas d'onryou : chemin de terre, 40 % dans l'agglo.
verifier('1. chemin de terre 40 % — pas de coupe, hors agglo (temoin onryou #66113398)',
  zonageAgglo(0.4, 8, S), { enAgglo: false, aCouper: false, sansPanneau: true });
// 2. Le meme a 60 % : cote agglo.
verifier('2. chemin de terre 60 % — pas de coupe, en agglo',
  zonageAgglo(0.6, 8, S), { enAgglo: true, aCouper: false, sansPanneau: true });
verifier('3. chemin de terre 50 % pile — agglo',
  zonageAgglo(0.5, 8, S).enAgglo, true);
// 4. Hors zone grise : rien ne change, et le bilan ne le compte pas.
verifier('4. chemin de terre 90 % — agglo, non compte comme rattache',
  zonageAgglo(0.9, 8, S), { enAgglo: true, aCouper: false, sansPanneau: false });
verifier('5. chemin de terre 10 % — hors agglo, non compte',
  zonageAgglo(0.1, 8, S), { enAgglo: false, aCouper: false, sansPanneau: false });

// 6. Tous les types retenus par l'auteur.
for (const t of [5, 8, 10, 16, 17, 20]) {
  verifier('6. type ' + t + ' a 40 % — jamais a couper', zonageAgglo(0.4, t, S).aCouper, false);
}

// 7. CONTRE-CHAMP : une voie qui porte un EB10 reste a couper. Sans cette ligne, un
//    `aCouper: false` pose partout passerait tous les tests ci-dessus.
for (const t of [1, 2, 6, 7, 22]) {
  verifier('7. type ' + t + ' a 40 % — a couper au panneau',
    zonageAgglo(0.4, t, S), { enAgglo: false, aCouper: true, sansPanneau: false });
}
verifier('8. rue 85 % — agglo, pas de coupe', zonageAgglo(0.85, 1, S),
  { enAgglo: true, aCouper: false, sansPanneau: false });
verifier('9. rue 60 % — ni agglo ni hors : a couper (comportement anterieur conserve)',
  zonageAgglo(0.6, 1, S), { enAgglo: false, aCouper: true, sansPanneau: false });

// 10. Le report EB10 de la boucle passe bien par `zonageAgglo` (sinon la regle n'est pas branchee).
verifier('10. la branche EB10 est commandee par zon.aCouper',
  /if \(zon\.aCouper && !estAutoroute\) \{\s*zones\.cheval\+\+/.test(src), true);
verifier('11. plus aucun test « partAgglo < haut » en dur dans la boucle',
  /loc\.partAgglo\s*<\s*haut/.test(src), false);

// ---------------------------------------------------------------------------
// v2.50.10 — EN ZONE GRISE, LA VILLE EST LAISSEE A L'EDITEUR (auteur, 30/09/2026).
// Remontee d'onryou : chemin de terre #440224630, sans nom ni ville, a qui WNA
// proposait « ‹sans nom› / Ancey » (C3) parce qu'il etait majoritaire dans le
// polygone. Le wiki laisse juger l'editeur (« ne depasse pas trop du calque ») :
// on ne garde que les ecarts vrais DES DEUX COTES.
// ---------------------------------------------------------------------------
console.log('\n=== Zone grise : ecarts communs aux deux cotes (v2.50.10) ===\n');

const api = new Function([
  relire('RE_ROUTE'), relire('RE_COMMUNALE'), relire('RE_AUTOROUTE'),
  relire('RE_NOM_COMPOSITE'),
  'const REF = { reRoute: RE_ROUTE, reCommunale: RE_COMMUNALE,' +
  '  reAutoroute: RE_AUTOROUTE, reNomComposite: RE_NOM_COMPOSITE };',
  relire('isRoute'), relire('isCommunale'),
  relire('fmt'), relire('key'),
  'const options = { altEnTrop: false };',
  extraire('villeAgglo'), extraire('expectedNaming'), extraire('diffNaming'),
  extraire('ecartsCommuns'),
  'return { expectedNaming, diffNaming, ecartsCommuns };'
].join('\n'))();

const COMMUNE = 'Ancey';
const AGGLO = { rattache: false };
function nam(p, a) {
  const e = x => ({ name: x[0] || '', cityName: x[1] || '',
                    signText: x[2] || '', signType: x[2] ? 1092 : null });
  return { primary: e(p), primaryId: 100, alts: (a || []).map(e) };
}
/** Ce que la boucle retient pour une voie sans panneau en zone grise. */
function communs(n) {
  const dA = api.diffNaming(n, api.expectedNaming(n, AGGLO, COMMUNE));
  const dH = api.diffNaming(n, api.expectedNaming(n, null, COMMUNE));
  return { dA, dH, reste: api.ecartsCommuns(dA, dH) };
}

{
  // 12. Le cas d'onryou : sans nom, sans ville.
  const r = communs(nam(['', '']));
  verifier('12. temoin : cote agglo, C3 reclame la ville (sinon le test ne prouve rien)',
    r.dA.length > 0, true);
  verifier('12. cote hors agglo, H5 : rien a dire', r.dH.length, 0);
  verifier('12. onryou #440224630 — plus aucune ville proposee', r.reste, []);
}
{
  // 13. L'inverse : sans nom AVEC la ville. Hors agglo, H5 voudrait la retirer.
  const r = communs(nam(['', COMMUNE]));
  verifier('13. temoin : cote hors agglo, H5 retire la ville', r.dH.length > 0, true);
  verifier('13. sans nom + ville — ville conservee (rien propose)', r.reste, []);
}
{
  // 14. Pure : un ecart present des deux cotes SURVIT, un ecart d'un seul cote tombe.
  const e1 = { champ: 'alt manquant', avant: '—', apres: 'C5 / Ancey' };
  const e2 = { champ: 'principal', avant: 'x / ', apres: 'x / Ancey' };
  verifier('14. ecart commun garde, ecart d\'un seul cote ecarte',
    api.ecartsCommuns([e1, e2], [Object.assign({}, e1)]), [e1]);
  verifier('15. meme champ, apres different — ecarte',
    api.ecartsCommuns([e2], [{ champ: 'principal', avant: 'x / ', apres: 'x / ' }]), []);
}

// 16-18. Branchement dans la boucle : sans ces lignes, la fonction existerait sans servir.
verifier('16. la boucle intersecte les ecarts de nom en zone grise sans panneau',
  /if \(zon\.sansPanneau\) \{\s*ecartsNom = ecartsCommuns\(ecartsNom, ecartsNomDe\(cibleDuCote\(!enAgglo\)\)\);/.test(src), true);
verifier('17. ... et les ecarts de controles (cartouches, feux IT)',
  /ecartsCart = ecartsCommuns\(ecartsCart, ecartsCartDe\(!enAgglo\)\);/.test(src), true);
verifier('18. pas de recensement cartouche pour une voie sans cote',
  /if \(!enAgglo && !zon\.sansPanneau\) collecterCartouche/.test(src), true);

console.log('\n' + ok + ' ok, ' + ko + ' echec(s)\n');
process.exit(ko ? 1 : 0);
