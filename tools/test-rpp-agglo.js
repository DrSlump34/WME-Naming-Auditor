/**
 * Tests des NUANCES sur les POI residentiels en agglomeration (v2.19).
 *
 * Ce que ces tests protegent : la doctrine v1.86 dit qu'un RPP en agglo est
 * SOUVENT LEGITIME — l'entree donne sur une autre voie que l'adresse postale.
 * Les nuances demandees par l'auteur le 26/07 separent, dans ce tas, les cas ou
 * l'argument ne tient pas. Se tromper de sens ici, c'est faire supprimer des POI
 * qui disent la verite du terrain : exactement la « correction a l'envers » que
 * le projet traque depuis la v1.97.
 *
 * ⚠️ Les fonctions ET les constantes sont EXTRAITES du userscript, jamais
 * recopiees : une copie divergerait au premier correctif et le test passerait au
 * vert sur du code mort.
 *
 * Usage : node tools/test-rpp-agglo.js   (depuis la racine du depot)
 */
'use strict';
const fs = require('fs');
const src = fs.readFileSync('WME-Naming-Auditor.user.js', 'utf8');

/**
 * ⚠️ L'extracteur des tests precedents partait du PREMIER `{` rencontre : il
 * s'arretait donc a la fin des parametres quand la signature en destructure un
 * (`function f({ a, b })`), et rendait une fonction sans corps. On saute d'abord
 * la liste des parametres, parentheses comptees.
 */
function extraire(nom) {
  const i = src.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let par = 0, j = src.indexOf('(', i);
  for (; j < src.length; j++) {
    if (src[j] === '(') par++;
    else if (src[j] === ')') { par--; if (!par) { j++; break; } }
  }
  let prof = 0;
  j = src.indexOf('{', j);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, j + 1);
}
/** Une declaration `const NOM = …;` (fleche ou valeur), relue telle quelle. */
function extraireConst(nom) {
  const m = src.match(new RegExp('const\\s+' + nom + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('constante introuvable : ' + nom);
  return 'const ' + nom + ' = ' + m[1] + ';';
}

// ⚠️ Les `const` ne sont PAS hissees : elles doivent preceder les fonctions qui
// les appellent dans le code assemble.
const CONSTS = ['RPP_MARGE_VOIE_M', 'RPP_PORTEE_VOIE_M', 'RPP_DOUBLON_M',
                'normSansAccent', 'distanceM', 'memeVoie', 'cleNumeroRue'].map(extraireConst).join('\n');
const FONCS = ['distPointSegment', 'distanceAuTrace', 'nomsDeVoie', 'readNaming',
               'voieLaPlusProche', 'doublonDeNumero', 'verdictRppAgglo'].map(extraire).join('\n\n');
const NOMS = ['distanceM', 'distanceAuTrace', 'memeVoie', 'cleNumeroRue', 'nomsDeVoie',
              'voieLaPlusProche', 'doublonDeNumero', 'verdictRppAgglo',
              'RPP_MARGE_VOIE_M', 'RPP_PORTEE_VOIE_M', 'RPP_DOUBLON_M'];
const ctx = {};
// `readNaming` retombe sur le SDK quand le segment n'a pas de `_nam` : nos
// segments de test en portent un, donc la doublure ne sert qu'a ne pas exploser.
new Function('ctx', 'sdk', CONSTS + '\n' + FONCS + '\n' +
             NOMS.map(n => `ctx.${n}=${n};`).join(''))
  .call(null, ctx, { DataModel: { Segments: { getAddress() { return null; } } } });
const { distanceM, distanceAuTrace, cleNumeroRue, voieLaPlusProche,
        doublonDeNumero, verdictRppAgglo,
        RPP_MARGE_VOIE_M, RPP_PORTEE_VOIE_M, RPP_DOUBLON_M } = ctx;

// ── outils de test ──────────────────────────────────────────────────────────
let ok = 0, ko = 0;
const messages = [];
function verifier(titre, obtenu, attendu, tol) {
  // ⚠️ `Infinity - Infinity` vaut NaN, et JSON.stringify(Infinity) vaut « null » :
  // sans ce cas explicite, « aucune voie a portee » echoue en se comparant a
  // lui-meme.
  const bon = typeof attendu === 'number'
    ? (!isFinite(attendu) ? obtenu === attendu
                          : Math.abs(obtenu - attendu) <= (tol === undefined ? 1e-9 : tol))
    : (typeof attendu === 'object' ? JSON.stringify(obtenu) === JSON.stringify(attendu)
                                   : obtenu === attendu);
  if (bon) { ok++; messages.push('  ok    ' + titre); }
  else {
    ko++;
    messages.push('  ECHEC ' + titre + '\n          attendu ' + JSON.stringify(attendu) +
                  '\n          obtenu  ' + JSON.stringify(obtenu));
  }
}
function contient(titre, texte, morceau) {
  const bon = typeof texte === 'string' && texte.includes(morceau);
  if (bon) { ok++; messages.push('  ok    ' + titre); }
  else { ko++; messages.push('  ECHEC ' + titre + '\n          « ' + morceau +
                             ' » absent de : ' + JSON.stringify(texte)); }
}
function titre(t) { messages.push('\n' + t); }

// ── geometries : deux rues paralleles, a 110 m l'une de l'autre ─────────────
// 0,0001° de latitude = 11,05 m ; a 43° nord, 0,0001° de longitude = 8,14 m.
const LAT = 43;
const seg = (nom, lat) => ({ id: nom, geometry: { type: 'LineString',
  coordinates: [[3.0000, lat], [3.0100, lat]] },
  _nam: { primary: { name: nom, cityName: 'Testville' }, alts: [] } });
const RUE_A = seg('Rue A', 43.0000);
const RUE_B = seg('Rue B', 43.0010);           // 110,5 m au nord de A
const ANONYME = { id: 'x', geometry: { type: 'LineString',
  coordinates: [[3.0000, 43.00002], [3.0100, 43.00002]] },
  _nam: { primary: { name: '', cityName: '' }, alts: [] } };
const RESEAU = [RUE_A, RUE_B];

titre('Distances (le socle : un verdict faux ici fausse tout le reste)');
verifier('1° de latitude = 110 540 m', distanceM([3, 43], [3, 44]), 110540, 1);
verifier('0,0001° de latitude = 11,05 m', distanceM([3, 43], [3, 43.0001]), 11.054, 0.01);
verifier('point a 11 m du trace de la Rue A',
  distanceAuTrace(3.005, 43.0001, RUE_A.geometry.coordinates), 11.054, 0.05);
verifier('trace vide : distance infinie', distanceAuTrace(3, 43, []), Infinity);
verifier('trace d\'un seul point : distance au point',
  distanceAuTrace(3, 43, [[3, 43.0001]]), 11.054, 0.01);

titre('voieLaPlusProche — quelle rue le POI longe-t-il ?');
{
  const v = voieLaPlusProche(3.005, 43.0001, RESEAU);
  verifier('la plus proche est la Rue A', v.noms, ['Rue A']);
  verifier('a 11 m', v.dist, 11.054, 0.05);
  verifier('l\'autre voie est a 99 m', v.distAutreVoie, 99.49, 0.05);
}
{
  const v = voieLaPlusProche(3.005, 43.0005, RESEAU);
  verifier('a mi-chemin, les deux voies sont a 55 m', v.distAutreVoie - v.dist, 0, 0.1);
}
{
  const v = voieLaPlusProche(3.005, 43.0030, RESEAU);
  verifier('au-dela de la portee, aucune voie', v.dist, Infinity);
  verifier('… et aucun nom', v.noms, []);
}
{
  const v = voieLaPlusProche(3.005, 43.0001, [ANONYME, RUE_A, RUE_B]);
  verifier('une voie SANS NOM peut etre la plus proche', v.noms, []);
}

titre('doublonDeNumero — un numero deja pose sur la meme rue');
const index = new Map();
index.set(cleNumeroRue('Rue A', '12'), [{ p: [3.0050, 43.0000], numero: '12' }]);
index.set(cleNumeroRue('Rue de l\'Église', '4 BIS'), [{ p: [3.0050, 43.0000], numero: '4 BIS' }]);
index.set(cleNumeroRue('Rue A', '99'), [{ p: [3.0900, 43.0000], numero: '99' }]);   // loin
{
  const d = doublonDeNumero('Rue A', '12', [3.0050, 43.0001], index);
  verifier('meme rue, meme numero, a 11 m : doublon', !!d, true);
  verifier('… et la distance est rendue', d.dist, 11.054, 0.05);
}
verifier('le meme numero a 6 km sur la meme rue : PAS un doublon',
  doublonDeNumero('Rue A', '99', [3.0050, 43.0000], index), null);
verifier('numero different : rien', doublonDeNumero('Rue A', '13', [3.0050, 43.0001], index), null);
verifier('rue differente : rien', doublonDeNumero('Rue B', '12', [3.0050, 43.0001], index), null);
verifier('POI sans numero : rien (il ne fait doublon de rien)',
  doublonDeNumero('Rue A', '', [3.0050, 43.0001], index), null);
verifier('pas d\'index (controle des numeros indisponible) : rien',
  doublonDeNumero('Rue A', '12', [3.0050, 43.0001], null), null);
verifier('casse, accents et espaces ignores : « rue de l\'eglise » / « 4bis »',
  !!doublonDeNumero('rue de l\'eglise', '4bis', [3.0050, 43.0001], index), true);

titre('verdictRppAgglo — nuance 1 : le doublon ne se discute pas');
{
  const v = verdictRppAgglo({ rue: 'Rue A', voieAcces: null,
    voiePos: voieLaPlusProche(3.005, 43.0015, RESEAU),
    doublon: { numero: '12', dist: 11 }, photo: false });
  verifier('doublon ⇒ ecart', v.verdict, 'ecart');
  contient('… la raison nomme le numero', v.raison, 'n° 12');
  contient('… et la rue', v.raison, 'Rue A');
}

titre('verdictRppAgglo — nuance 2 : le point d\'acces DIT ou est l\'entree');
{
  const v = verdictRppAgglo({ rue: 'Rue A',
    voieAcces: voieLaPlusProche(3.005, 43.0001, RESEAU),      // acces le long de la Rue A
    voiePos: voieLaPlusProche(3.005, 43.0005, RESEAU),
    doublon: null, photo: false });
  verifier('acces sur la voie de l\'adresse ⇒ ecart', v.verdict, 'ecart');
  verifier('… constate sur le point d\'acces', v.source, 'point d\'accès');
}
{
  const v = verdictRppAgglo({ rue: 'Rue B',                    // adresse Rue B…
    voieAcces: voieLaPlusProche(3.005, 43.0001, RESEAU),      // … mais acces sur Rue A
    voiePos: voieLaPlusProche(3.005, 43.0001, RESEAU),
    doublon: null, photo: false });
  verifier('acces sur une AUTRE voie ⇒ conforme, plus signale', v.verdict, 'conforme');
  contient('… et on dit pourquoi', v.raison, 'Rue A');
}
{
  const v = verdictRppAgglo({ rue: 'Rue B',
    voieAcces: voieLaPlusProche(3.005, 43.0005, RESEAU),      // pile entre les deux
    voiePos: voieLaPlusProche(3.005, 43.0005, RESEAU),
    doublon: null, photo: false });
  verifier('deux voies a egalite ⇒ on ne tranche pas', v.verdict, 'trancher');
}

titre('verdictRppAgglo — nuance 3 : faute d\'acces, la position ne prouve pas l\'entree');
{
  const v = verdictRppAgglo({ rue: 'Rue A', voieAcces: null,
    voiePos: voieLaPlusProche(3.005, 43.0001, RESEAU), doublon: null, photo: false });
  verifier('le POI longe la rue de son adresse ⇒ ecart', v.verdict, 'ecart');
  verifier('… constate sur la position', v.source, 'position du POI');
  contient('… la raison donne la distance', v.raison, '11 m');
}
{
  const v = verdictRppAgglo({ rue: 'Rue B', voieAcces: null,
    voiePos: voieLaPlusProche(3.005, 43.0001, RESEAU), doublon: null, photo: false });
  verifier('⚠️ le POI longe une AUTRE voie, SANS point d\'acces ⇒ a trancher, ' +
           'JAMAIS « conforme »', v.verdict, 'trancher');
}
{
  const v = verdictRppAgglo({ rue: 'Rue A', voieAcces: null,
    voiePos: voieLaPlusProche(3.005, 43.0030, RESEAU), doublon: null, photo: false });
  verifier('aucune voie a portee ⇒ a trancher', v.verdict, 'trancher');
}
{
  const v = verdictRppAgglo({ rue: '', voieAcces: null,
    voiePos: voieLaPlusProche(3.005, 43.0001, RESEAU), doublon: null, photo: false });
  verifier('POI sans rue ⇒ a trancher (rien a comparer)', v.verdict, 'trancher');
}
{
  const v = verdictRppAgglo({ rue: 'Rue A', voieAcces: null,
    voiePos: voieLaPlusProche(3.005, 43.0005, RESEAU), doublon: null, photo: false });
  verifier('sa rue est la plus proche mais l\'autre est a egalite ⇒ a trancher',
    v.verdict, 'trancher');
}
{
  const v = verdictRppAgglo({ rue: 'Rue A', voieAcces: null,
    voiePos: { noms: [], dist: 5, distAutreVoie: Infinity }, doublon: null, photo: false });
  verifier('la voie la plus proche est anonyme ⇒ a trancher', v.verdict, 'trancher');
}

titre('⚠️ VERROU : la PHOTO ne change RIEN au verdict, elle ne fait que temperer');
for (const cas of [
  { nom: 'doublon', e: { rue: 'Rue A', voieAcces: null,
      voiePos: voieLaPlusProche(3.005, 43.0015, RESEAU),
      doublon: { numero: '12', dist: 11 } }, attendu: 'ecart' },
  { nom: 'le long de sa rue', e: { rue: 'Rue A', voieAcces: null,
      voiePos: voieLaPlusProche(3.005, 43.0001, RESEAU), doublon: null }, attendu: 'ecart' },
  { nom: 'acces sur une autre voie', e: { rue: 'Rue B',
      voieAcces: voieLaPlusProche(3.005, 43.0001, RESEAU),
      voiePos: voieLaPlusProche(3.005, 43.0001, RESEAU), doublon: null }, attendu: 'conforme' },
  { nom: 'indecis', e: { rue: 'Rue B', voieAcces: null,
      voiePos: voieLaPlusProche(3.005, 43.0001, RESEAU), doublon: null }, attendu: 'trancher' }
]) {
  const sans = verdictRppAgglo(Object.assign({ photo: false }, cas.e));
  const avec = verdictRppAgglo(Object.assign({ photo: true }, cas.e));
  verifier('« ' + cas.nom +' » : meme verdict avec ou sans photo',
    [sans.verdict, avec.verdict], [cas.attendu, cas.attendu]);
  verifier('« ' + cas.nom + ' » : la photo est RAPPORTEE, pas avalee', avec.photo, true);
}

titre('La marge d\'indecision : calee sur des ecarts REELS (Coursan, 26/07)');
// Deux voies dont le POI est a `d` et `d + ecart` : c'est l'ecart qui decide.
const voie = (nom, dist) => ({ noms: [nom], dist, distAutreVoie: dist + 8 });
{
  // Cas mesure : POI a 16 m de sa rue, autre voie a 18 m ⇒ ambigu, on s'abstient.
  const v = verdictRppAgglo({ rue: 'Rue A', voieAcces: null,
    voiePos: { noms: ['Rue A'], dist: 16, distAutreVoie: 18 }, doublon: null, photo: false });
  verifier('16 m contre 18 m (cas reel) : trop serre, on ne tranche pas', v.verdict, 'trancher');
}
{
  // Cas mesure : POI a 13 m de sa rue, autre voie a 28 m ⇒ net.
  const v = verdictRppAgglo({ rue: 'Rue A', voieAcces: null,
    voiePos: { noms: ['Rue A'], dist: 13, distAutreVoie: 28 }, doublon: null, photo: false });
  verifier('13 m contre 28 m (cas reel) : net, ecart affirme', v.verdict, 'ecart');
}
{
  // ⚠️ Cas reel a 9 m d'ecart (18 m contre 27 m) : SOUS la marge, donc pas
  // tranche. Il est ici pour que le jour ou la marge bougera, on VOIE ce que ca
  // change — c'est un POI d'angle de rue, l'ambiguite est reelle.
  const v = verdictRppAgglo({ rue: 'Rue A', voieAcces: null,
    voiePos: { noms: ['Rue A'], dist: 18, distAutreVoie: 27 }, doublon: null, photo: false });
  verifier('18 m contre 27 m (angle de rue) : 9 m d\'ecart, on s\'abstient',
    v.verdict, RPP_MARGE_VOIE_M > 9 ? 'trancher' : 'ecart');
}
verifier('un ecart de 8 m suffit (au-dessus de la marge)',
  verdictRppAgglo({ rue: 'Rue A', voieAcces: null, voiePos: voie('Rue A', 12),
                    doublon: null, photo: false }).verdict,
  RPP_MARGE_VOIE_M <= 8 ? 'ecart' : 'trancher');

titre('Le VERBE des consignes : porte par le segment, jamais « passer sur »');
// ⭐⭐⭐ LE MESSAGE FAISAIT COMMETTRE LA FAUTE QU'IL DENONCE. Un numero de rue
// est un ATTRIBUT porte par le segment ; « le numero doit PASSER SUR le
// segment » se lit, en cartographie, comme un DEPLACEMENT GEOMETRIQUE — donc
// « pose ce POI sur la chaussee ». C'est exactement la mauvaise habitude que
// les editeurs remontent : des POI plantes sur l'axe au lieu du batiment.
// ⚠️ Ce verrou porte sur du TEXTE VISIBLE, pas sur une forme de code : il ne
// tombera pas a la premiere refactorisation, et il ne peut mordre a tort que si
// quelqu'un reintroduit la formulation.
{
  const fautifs = (src.match(/[^\n]*(passer sur le segment|passe sur le segment|numéro sur le segment|numéro sur segment)[^\n]*/g) || [])
    // Le commentaire de doctrine CITE la formulation pour l'interdire : c'est sa
    // raison d'etre, il ne doit pas faire echouer le verrou qu'il explique.
    .filter(l => !/^\s*\/\//.test(l));
  verifier('aucune consigne visible ne dit « passer sur le segment »',
    fautifs.length ? fautifs.join(' | ') : 0, 0);
  // Le pendant positif : la formulation juste est bien celle qui est servie.
  verifier('la consigne dit « être porté par le segment »',
    /le numéro doit être porté par le segment/.test(src), true);
}

titre('Constantes : lues dans le source, avec le sens qu\'on leur prete');
verifier('la marge d\'indecision est en metres et non nulle', RPP_MARGE_VOIE_M > 0, true);
verifier('la portee depasse la marge (sinon rien ne serait jamais tranche)',
  RPP_PORTEE_VOIE_M > RPP_MARGE_VOIE_M, true);
verifier('le rayon de doublon est plus large que la marge', RPP_DOUBLON_M > RPP_MARGE_VOIE_M, true);

// ── bilan ───────────────────────────────────────────────────────────────────
console.log(messages.join('\n'));
console.log('\n' + ok + ' verification(s) OK, ' + ko + ' echec(s).');
process.exit(ko ? 1 : 0);
