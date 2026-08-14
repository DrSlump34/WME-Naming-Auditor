/**
 * Tests de la CIBLE HORS AGGLOMERATION — les cas H5 a H9 du logigramme FR.
 *
 * ⚠️⚠️ POURQUOI CE FICHIER EXISTE (v2.27.02) : ces cinq cas decident du nommage
 * de TOUS les segments hors agglomeration, et ils n'avaient AUCUN test. C'est
 * un retour d'utilisateur, pas une relecture, qui a trouve le trou — Glenan56,
 * 27/07/2026 : « quand on a une Dxxx hors ville avec nom de rue en alt, il ne
 * m'a pas propose de corriger en rajoutant le Dxxx + Ville en alt. Un nom de
 * rue en alt semble donc le perturber. »
 *
 * ⭐ CE QU'IL AVAIT VU, ET QUE PERSONNE N'AVAIT VU : une incoherence INTERNE.
 * H6 (numero seul) reclame « Dxxx + commune » en alternatif ; H8 (voie
 * communale) reclame les DEUX ; seul H9 laissait tomber le numero des qu'un nom
 * de rue apparaissait. Or le principal hors agglomeration ne porte JAMAIS de
 * ville : le numero n'etait donc rattache a aucune commune.
 *
 * ⚠️ Ces tests figent une REGLE DE NOMMAGE, pas une preference d'implementation.
 * Les modifier demande l'accord de l'auteur (CC FR) — le script applique la
 * norme, il ne la cree pas.
 *
 * ⚠️ Fonctions EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-hors-agglo.js
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

const api = new Function([
  relire('RE_ROUTE'), relire('RE_COMMUNALE'), relire('RE_AUTOROUTE'),
  relire('RE_NOM_COMPOSITE'), relire('isRoute'), relire('isCommunale'),
  relire('fmt'), relire('key'),
  'const options = { altEnTrop: false };',
  extraire('villeAgglo'), extraire('expectedNaming'), extraire('diffNaming'),
  'return { expectedNaming, diffNaming };'
].join('\n'))();

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else {
    ko++;
    lignes.push('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) +
                '\n          obtenu  ' + JSON.stringify(attendu === undefined ? obtenu : obtenu));
  }
}

const COMMUNE = 'Caraman';
/** Un nommage lu sur un segment. `p` = principal, `a` = alternatifs. */
function nam(p, a) {
  const e = x => ({ name: x[0] || '', cityName: x[1] || '',
                    signText: x[2] || '', signType: x[2] ? 1092 : null });
  return { primary: e(p), primaryId: 100, alts: (a || []).map(e) };
}
/** La cible hors agglomeration (pas de polygone d'agglo). */
const cible = n => api.expectedNaming(n, null, COMMUNE);
/** Les alternatifs vises, en « nom / ville ». */
const alts = r => r.alts.map(a => a.name + ' / ' + a.cityName);
const principal = r => r.primary.name + ' / ' + r.primary.cityName;

console.log('\n=== Cible HORS AGGLOMERATION (H5 a H9) ===\n');

// ---------------------------------------------------------------------------
// H5 — ni nom de rue, ni numero : rien, et surtout PAS de ville.
// ---------------------------------------------------------------------------
{
  const r = cible(nam(['', '']));
  verifier('H5. sans nom ni numero — le cas', r.cas, 'H5');
  verifier('H5. principal vide, SANS ville', principal(r), ' / ');
  verifier('H5. aucun alternatif', alts(r), []);
}
{
  // ⭐ Le cas signale par Glenan56 : un segment hors ville SANS NOM mais qui
  // porte la ville en principal. La cible est bien « sans nom / sans ville »,
  // donc l'ecart doit sortir.
  const n = nam(['', COMMUNE]);
  const r = cible(n);
  verifier('H5. sans nom MAIS avec la ville en principal — cible inchangee',
    principal(r), ' / ');
  const d = api.diffNaming(n, r);
  verifier('H5. la ville en trop est bien signalee comme un ecart', d.length, 1);
  verifier('H5. et c\'est le principal qui est en cause', d[0] && d[0].champ, 'principal');
}

// ---------------------------------------------------------------------------
// H6 — un numero seul : il passe en principal SANS ville, et repart en
// alternatif AVEC la commune (c'est ce qui rattache la voie a la commune).
// ---------------------------------------------------------------------------
{
  const r = cible(nam(['D18', '', 'D18']));
  verifier('H6. numero seul — le cas', r.cas, 'H6');
  verifier('H6. le numero en principal, sans ville', principal(r), 'D18 / ');
  verifier('H6. le numero + la commune en alternatif', alts(r), ['D18 / ' + COMMUNE]);
}

// ---------------------------------------------------------------------------
// H7 — un nom de rue seul.
// ---------------------------------------------------------------------------
{
  const r = cible(nam(['Route de Saint-Anatoly', '']));
  verifier('H7. nom de rue seul — le cas', r.cas, 'H7');
  verifier('H7. le nom en principal, sans ville', principal(r), 'Route de Saint-Anatoly / ');
  verifier('H7. le nom + la commune en alternatif', alts(r),
    ['Route de Saint-Anatoly / ' + COMMUNE]);
}

// ---------------------------------------------------------------------------
// H8 — voie COMMUNALE (C/VC/CR…) + nom de rue : le NOM prime en principal, et
// les deux repartent en alternatif avec la commune.
// ---------------------------------------------------------------------------
{
  const r = cible(nam(['VC3', '', 'VC3'], [['Chemin des Poulets', '']]));
  verifier('H8. voie communale + nom — le cas', r.cas, 'H8');
  verifier('H8. c\'est le NOM DE RUE qui prend le principal',
    principal(r), 'Chemin des Poulets / ');
  verifier('H8. les DEUX en alternatif, avec la commune', alts(r),
    ['VC3 / ' + COMMUNE, 'Chemin des Poulets / ' + COMMUNE]);
}

// ---------------------------------------------------------------------------
// H9 — LE CAS DE GLENAN56 : une Dxxx + un nom de rue.
// ⚠️⚠️ C'est ici que le numero se perdait. Ne pas defaire sans l'auteur.
// ---------------------------------------------------------------------------
{
  const r = cible(nam(['D59', '', 'D59'], [['Route de Saint-Anatoly', COMMUNE]]));
  verifier('H9. Dxxx + nom de rue — le cas', r.cas, 'H9');
  verifier('H9. le NUMERO prend le principal, sans ville', principal(r), 'D59 / ');
  verifier('H9. ⭐ le numero + la commune est RECLAME en alternatif',
    alts(r).includes('D59 / ' + COMMUNE), true);
  verifier('H9. le nom de rue + la commune l\'est aussi',
    alts(r).includes('Route de Saint-Anatoly / ' + COMMUNE), true);
  verifier('H9. et rien d\'autre', alts(r).length, 2);
}
{
  // Le segment exact de sa capture : le nom de rue porte deja la commune, le
  // numero non. C'est le « Dxxx + Ville » manquant qui doit sortir, LUI SEUL.
  const n = nam(['D59', 'Hors ville', 'D59'],
                [['Route de Saint-Anatoly', COMMUNE], ['Avenue Flandres Dunkerque', COMMUNE]]);
  const d = api.diffNaming(n, cible(n));
  const manquants = d.filter(e => e.champ === 'alt manquant').map(e => e.apres);
  verifier('H9. sur son cas reel, « D59 / Caraman » est bien reclame',
    manquants.includes('D59 / ' + COMMUNE), true);
  verifier('H9. et le nom de rue deja present n\'est PAS redemande',
    manquants.some(m => /Saint-Anatoly/.test(m)), false);
}
{
  // ⚠️ Pas de doublon : si le segment porte DEJA « D59 + commune », plus rien.
  const n = nam(['D59', '', 'D59'],
                [['D59', COMMUNE], ['Route de Saint-Anatoly', COMMUNE]]);
  const d = api.diffNaming(n, cible(n));
  verifier('H9. tout est deja en place — AUCUN ecart', d.length, 0);
}

// ---------------------------------------------------------------------------
// Ce que le changement NE doit PAS avoir casse
// ---------------------------------------------------------------------------
{
  // L'autoroute reste hors de tout ca : aucune ville, nulle part.
  const r = cible(nam(['A61', '', 'A61'], [['Route de Toulouse', COMMUNE]]));
  verifier('A. autoroute — le cas', r.cas, 'A');
  verifier('A. aucune ville en principal', r.primary.cityName, '');
  verifier('A. aucune ville en alternatif', r.alts.every(a => !a.cityName), true);
}
{
  // Le nom COMPOSITE interdit reste ramene a son nom seul, sans reclamer
  // qu'on le recree.
  const r = cible(nam(['D59', '', 'D59'], [['D59 - Route de Saint-Anatoly', COMMUNE]]));
  verifier('composite. il n\'est jamais reclame en alternatif',
    alts(r).some(a => /D59 - /.test(a)), false);
  verifier('composite. c\'est le nom PROPRE qui est vise',
    alts(r).includes('Route de Saint-Anatoly / ' + COMMUNE), true);
}

// ---------------------------------------------------------------------------
// H-VP — VOIE PRIVEE / PARKING HORS AGGLO : LE NOM EST IGNORE, PAS LA VILLE.
//
// ⭐ ORIGINE, ET C'EST UNE MESURE : Glenan56, le 14/08/2026 — « Road Selector me
// trouve encore des segments nommes en ville alors qu'ils sont hors ville,
// Naming Editor est passe a cote ». Le segment de son permalien (266373094) est
// « Sans nom, Caraman, Haute-Garonne », de type VOIE PRIVEE : le `continue` de
// l'exclusion par type tombait AVANT le calcul de zone, donc aucun report ne
// pouvait naitre. Sur son secteur, 59 des 246 segments a ville (24 %) sont de
// type 17 ou 20.
//
// ⚠️ CE SONT DES TESTS DE VOLONTE autant que de calcul : l'exclusion par type
// reste voulue pour le NOM (une absence de nom n'est pas une anomalie sur un
// parking). Ne pas les « corriger » en elargissant l'audit de ces voies.
// ---------------------------------------------------------------------------
{
  const api2 = new Function([
    relire('normSansAccent'),
    extraire('ecartsCertainsEnZoneGrise'),
    'return { ecartsCertainsEnZoneGrise };'
  ].join('\n'))();
  const eczg = api2.ecartsCertainsEnZoneGrise;

  const sansNomAvecVille = { primary: { name: '', cityName: COMMUNE }, alts: [] };
  const e = eczg(sansNomAvecVille, false, COMMUNE);
  verifier('H-VP. sans nom + ville hors agglo — un ecart, un seul', e.length, 1);
  verifier('H-VP. et il porte le champ « ville en trop »',
    e[0] && e[0].champ, 'ville en trop (hors agglomération)');
  verifier('H-VP. la cible retire la ville sans inventer de nom',
    e[0] && e[0].apres, '‹sans nom› / ‹sans ville›');

  // Une voie privee NOMMEE hors agglo porte aussi une ville en trop.
  verifier('H-VP. nommee + ville hors agglo — signalee aussi',
    eczg({ primary: { name: 'Les Acacias', cityName: COMMUNE }, alts: [] }, false, COMMUNE).length, 1);

  // ⚠️ LES TROIS REFUS, et ils comptent autant que le report.
  verifier('H-VP. EN agglo, on ne dit rien (la ville y est normale)',
    eczg(sansNomAvecVille, true, COMMUNE).length, 0);
  verifier('H-VP. sans ville du tout, on ne dit rien',
    eczg({ primary: { name: '', cityName: '' }, alts: [] }, false, COMMUNE).length, 0);
  verifier('H-VP. ville VOISINE : on se taît (son agglo ne nous est pas connue)',
    eczg({ primary: { name: '', cityName: 'Auriac-sur-Vendinelle' }, alts: [] }, false, COMMUNE).length, 0);
}

// --- Verrous d'ASSEMBLAGE : le calcul juste doit etre appele au bon endroit ---
// ⭐ LECON DU 09/08 (v2.35.02) : un calcul juste appele au mauvais moment reste
// un resultat FAUX, et aucun test de calcul ne peut le voir. Ici l'ordre EST le
// correctif : si la garde de type retombe avant `localiser`, tout le reste est
// mort sans qu'une seule verification de calcul ne bronche.
{
  const iLoc = src.indexOf('const loc = localiser(coords, listeAgglos);');
  const iGarde = src.indexOf('if (!options.sansAdresse && REF.typesSansAdresse.has(seg.roadType))');
  verifier('assemblage. `localiser` est bien lu AVANT la garde par type',
    iLoc > 0 && iGarde > 0 && iLoc < iGarde, true);

  // Le corps de la garde, isole par comptage d'accolades.
  let bloc = '';
  if (iGarde > 0) {
    let prof = 0, j = src.indexOf('{', iGarde);
    for (let k = j; k < src.length; k++) {
      if (src[k] === '{') prof++;
      else if (src[k] === '}') { prof--; if (!prof) { bloc = src.slice(j, k + 1); break; } }
    }
  }
  verifier('assemblage. la garde par type appelle `ecartsCertainsEnZoneGrise`',
    /ecartsCertainsEnZoneGrise/.test(bloc), true);
  verifier('assemblage. elle pousse un report au cas H-VP',
    /cas: 'H-VP'/.test(bloc), true);
  verifier('assemblage. elle compte ce qu\'elle signale (`villeSansAdressage`)',
    /villeSansAdressage\+\+/.test(bloc), true);
  verifier('assemblage. elle respecte encore la garde « chez la voisine »',
    /loc\.partCommune >= bas/.test(bloc), true);
  verifier('assemblage. elle reste soumise au controle `nommageZone`',
    /c\.nommageZone/.test(bloc), true);
  verifier('assemblage. et elle sort toujours par un `continue`',
    /continue;/.test(bloc), true);
  // ⚠️ Test de VOLONTE : l'exclusion par type NE DOIT PAS disparaitre.
  verifier('assemblage. l\'exclusion par type est toujours en place',
    /skipped\.sansAdresse\+\+/.test(bloc), true);
}

// --- L'aide et l'infobulle DISENT le nouveau comportement -------------------
// ⭐ LECON DU 14/08 : l'infobulle promettait « des ecarts de redaction sur leur
// nom » et ne parlait pas des villes — l'editeur ne pouvait pas savoir ce qu'il
// ratait. Un changement de comportement se cherche AUSSI dans les textes.
verifier('textes. l\'aide annonce le cas H-VP', /H-VP<\/b>/.test(src), true);
verifier('textes. l\'infobulle de la case parle de la ville en trop',
  /ville en trop hors agglomération est signalée quand même/.test(src), true);
verifier('textes. le bandeau distingue les ignores des signales',
  /signalé\(s\) pour une ville en trop/.test(src), true);

// ---------------------------------------------------------------------------
// Verrou de CONTRAT — l'extracteur lit-il encore quelque chose ?
// (lecon de la v2.26 : un harnais qui n'extrait plus rien rend un verdict
//  qui ment ; on eprouve donc le harnais lui-meme)
// ---------------------------------------------------------------------------
verifier('contrat. les 5 cas hors agglo sont bien tous produits',
  ['H5', 'H6', 'H7', 'H8', 'H9'].every(c => new RegExp("cas: '" + c + "'").test(src)), true);
verifier('contrat. l\'extracteur a bien lu expectedNaming',
  /H9/.test(extraire('expectedNaming')), true);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
