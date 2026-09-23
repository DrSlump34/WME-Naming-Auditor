/**
 * Tests de la FUSION DES PREFERENCES entre onglets (v2.26.04).
 *
 * ⚠️⚠️ CE QUE CES TESTS PROTEGENT : le travail de zonage de l'editeur.
 *
 * Defaut trouve le 27/07 (l'auteur avait deux onglets WME ouverts) : chaque
 * onglet chargeait les preferences UNE FOIS au demarrage, gardait sa copie en
 * memoire, puis reecrivait l'objet ENTIER a la sauvegarde. Le dernier onglet a
 * sauvegarder effacait donc en silence tout ce que l'autre avait fait depuis —
 * un polygone trace dans l'onglet A disparaissait des que l'onglet B cochait une
 * ligne. Aucun message, aucune trace : le polygone n'existait simplement plus.
 *
 * La regle, cle par cle :
 *   - une cle que cet onglet ne connait pas est CONSERVEE depuis le stockage ;
 *   - une cle presente en memoire FAIT FOI (c'est le geste qu'on vient de faire).
 *
 * ⚠️ D'ou la contrepartie, elle aussi eprouvee ici : une commune videe garde sa
 * cle (tableau vide) au lieu d'etre supprimee. Sans cette trace, « je viens de
 * tout effacer » serait indistinguable de « je n'ai jamais vu cette commune », et
 * la fusion RESSUSCITERAIT le polygone supprime.
 *
 * ⚠️ Fonction extraite du userscript, jamais recopiee.
 *
 * Usage : node tools/test-fusion-prefs.js
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

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else { ko++; lignes.push('  ECHEC ' + titre + '\n          attendu ' +
    JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
function titre(t) { lignes.push('\n' + t); }

const fusionner = new Function('distant', 'local',
  extraire('fusionnerPrefs') + '\nreturn fusionnerPrefs(distant, local);');

const POLY = r => ({ id: 'a1', label: 'Bourg', rattache: false, ring: r || [] });

console.log('\n=== Fusion des preferences entre onglets ===');

titre('⚠️⚠️ LE CAS VECU : deux onglets, et le travail de l\'autre survit');
{
  // Onglet A a demarre avec Saint-Laurent en memoire. Onglet B a, depuis, trace
  // Saint-Geniès — c'est dans le stockage, pas dans la memoire de A. A sauve.
  const stockage = { agglos: { '30278': [POLY()], '30254': [POLY()] }, sansAgglo: {}, traites: {} };
  const memoireA = { agglos: { '30278': [POLY()] }, sansAgglo: {}, traites: {} };
  const r = fusionner(stockage, memoireA);
  verifier('1. ⭐ le polygone trace dans l\'AUTRE onglet survit a la sauvegarde',
    Object.keys(r.agglos).sort(), ['30254', '30278']);
  verifier('1. … et celui de l\'onglet qui ecrit aussi', r.agglos['30278'].length, 1);
}

titre('⭐ La memoire fait foi pour SES cles : les gestes d\'ici ne sont pas annules');
{
  // L'editeur vient d'AJOUTER un second polygone a une commune deja zonee.
  const stockage = { agglos: { '30254': [POLY([1])] } };
  const memoire = { agglos: { '30254': [POLY([1]), POLY([2])] } };
  verifier('2. l\'ajout local l\'emporte sur la version du stockage',
    fusionner(stockage, memoire).agglos['30254'].length, 2);

  // ⚠️⚠️ LA SUPPRESSION. C'est le cas qui a impose de garder la cle vide.
  const videe = { agglos: { '30254': [] } };
  verifier('3. ⚠️⚠️ une commune VIDEE reste vide — le polygone ne ressuscite pas',
    fusionner(stockage, videe).agglos['30254'], []);
  // Et la preuve par l'absurde : sans la trace, on ne peut pas distinguer.
  verifier('3. … alors qu\'une cle ABSENTE laisse le stockage intact (c\'est voulu)',
    fusionner(stockage, { agglos: {} }).agglos['30254'].length, 1);
}

titre('« Sans agglomeration » : cocher ET decocher doivent tenir');
{
  verifier('4. une declaration d\'un autre onglet est conservee',
    fusionner({ sansAgglo: { '30254': true } }, { sansAgglo: {} }).sansAgglo, { '30254': true });
  verifier('5. ⚠️ une case DECOCHEE ici (false) n\'est pas recochee par le stockage',
    fusionner({ sansAgglo: { '30254': true } }, { sansAgglo: { '30254': false } }).sansAgglo,
    { '30254': false });
  verifier('6. et la declaration locale l\'emporte quand le stockage ne sait rien',
    fusionner({ sansAgglo: {} }, { sansAgglo: { '30254': true } }).sansAgglo, { '30254': true });
}

titre('Les coches « traite » : union par commune');
{
  const stockage = { traites: { '11106': { 'a|1': true }, '30254': { 'x|1': true } } };
  const memoire = { traites: { '30254': { 'x|1': true, 'y|2': true } } };
  const r = fusionner(stockage, memoire);
  verifier('7. la commune traitee dans l\'autre onglet est conservee',
    Object.keys(r.traites).sort(), ['11106', '30254']);
  verifier('8. et la vue locale fait foi pour SA commune (decochages compris)',
    Object.keys(r.traites['30254']).sort(), ['x|1', 'y|2']);
  verifier('9. ⚠️ tout decocher (objet vide) ne remet pas les anciennes coches',
    fusionner(stockage, { traites: { '30254': {} } }).traites['30254'], {});
}

titre('Robustesse : on ne casse jamais la sauvegarde');
{
  verifier('10. stockage illisible (null) ⇒ on ecrit ce qu\'on a',
    fusionner(null, { agglos: { '30254': [POLY()] }, sansAgglo: {}, traites: {} }).agglos['30254'].length, 1);
  verifier('11. memoire vide ⇒ le stockage est intact (jamais d\'effacement)',
    fusionner({ agglos: { '30254': [POLY()] } }, null).agglos['30254'].length, 1);
  // v2.49 : quatrieme section, les secteurs declares hameau (schema 2, wiki v52).
  verifier('12. les deux vides ⇒ quatre sections presentes, jamais `undefined`',
    Object.keys(fusionner({}, {})).sort(), ['agglos', 'hameaux', 'sansAgglo', 'traites']);
  const r = fusionner({}, {});
  verifier('12. … et bien des objets',
    [typeof r.agglos, typeof r.sansAgglo, typeof r.traites, typeof r.hameaux],
    ['object', 'object', 'object', 'object']);
  // ⚠️ Un hameau declare dans un AUTRE onglet ne doit pas etre perdu a la
  // sauvegarde de celui-ci — c'est tout l'objet de la fusion.
  const h = fusionner({ hameaux: { '56162': [{ lon: -3.5, lat: 47.7 }] } },
                      { agglos: {}, sansAgglo: {}, traites: {}, hameaux: { '29103': [] } });
  verifier('12b. ⭐ hameau declare ailleurs + commune videe ici ⇒ les deux gardes',
    [h.hameaux['56162'].length, h.hameaux['29103'].length], [1, 0]);
}

titre('⭐ Verrous sur le SOURCE — ce qui rend la fusion possible');
{
  // Si un `delete` revient sur ces trois etats, la fusion redevient incapable de
  // distinguer un effacement d'une absence : le defaut reviendrait en silence.
  verifier('13. ⚠️⚠️ une commune videe garde sa cle (pas de `delete agglos[...]`)',
    /delete agglos\[/.test(src), false);
  verifier('14. ⚠️ une case decochee garde sa cle (pas de `delete sansAgglo[...]`)',
    /delete sansAgglo\[/.test(src), false);
  verifier('15. ⚠️ une commune sans coche garde sa cle (pas de `delete traites[...]`)',
    /delete traites\[/.test(src), false);
  // La relecture AVANT ecriture : c'est elle qui rend la fusion utile.
  const corps = extraire('sauverPrefs');
  verifier('16. ⭐ `sauverPrefs` RELIT le stockage avant d\'ecrire',
    /prefs\.load\(\)/.test(corps), true);
  verifier('17. ⭐ … et passe par la fusion, jamais par un remplacement direct',
    /fusionnerPrefs\(/.test(corps) && !/prefs\.save\(\{\s*agglos/.test(corps), true);
  verifier('18. ⚠️ les ecritures sont serialisees (deux clics rapides ne se doublent pas)',
    /chaineSauvegarde/.test(corps), true);
  // L'ecoute des autres onglets.
  const ec = extraire('ecouterAutresOnglets');
  verifier('19. l\'onglet ecoute les ecritures des autres (evenement `storage`)',
    /addEventListener\('storage'/.test(ec), true);
  verifier('20. ⚠️⚠️ mais ne se rafraichit PAS pendant une edition de polygone',
    /if \(edition\) return;/.test(ec), true);
  verifier('21. ⚠️ et seulement pour NOTRE cle de stockage',
    /e\.key !== prefs\.cle/.test(ec), true);
  // Le partage : un `false` exporte ne doit pas devenir une declaration chez l'autre.
  const fus = extraire('fusionnerPartage');
  verifier('22. ⚠️ a l\'import d\'un partage, une case decochee (false) est ignoree',
    /if \(!p\.sansAgglo\[insee\]\) continue;/.test(fus), true);
}

titre('⭐ v2.49.03 — les hameaux declares voyagent dans le partage');
{
  verifier('23. l\'export emporte les hameaux (CLES_PARTAGE)',
    /const CLES_PARTAGE = \['agglos', 'sansAgglo', 'hameaux'\];/.test(src), true);
  // La VRAIE fonction d'import, extraite, sur un etat local donne.
  const monterImport = (local) => new Function('prefs', 'codeCommuneValide', 'polygoneImporteValide',
    'agglos', 'sansAgglo', 'hameaux', 'saveAgglos', 'saveSansAgglo',
    extraire('pointHameauValide') + '\n' + extraire('fusionnerPartage') + '\nreturn fusionnerPartage;')(
    { inspect: t => ({ ok: true, payload: JSON.parse(t) }) }, c => /^\d{5}$/.test(c), () => true,
    {}, {}, local, () => {}, () => {});
  const local = { '29103': [] };           // commune ou l'on a TOUT annule
  const imp = monterImport(local);
  const r = imp(JSON.stringify({ hameaux: {
    '56162': [{ lon: -3.43, lat: 47.70 }, { lon: NaN, lat: 47 }],
    '29103': [{ lon: -4.1, lat: 48.2 }],
    '22113': [],
    'XX': [{ lon: 1, lat: 1 }]
  } }));
  verifier('24. ⭐ commune ABSENTE : ses hameaux valides sont ajoutés', local['56162'], [{ lon: -3.43, lat: 47.70 }]);
  verifier('25. ⚠️ commune déjà tranchée ici (même tout annulé) : INTOUCHÉE', local['29103'], []);
  verifier('26. une liste vide importée n\'ajoute rien', '22113' in local, false);
  verifier('27. ⚠️ point invalide (NaN) et code faux : écartés ET comptés, jamais en silence',
    [r.ajoutHameaux, r.rejetes], [1, 2]);
}

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
