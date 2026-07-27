/**
 * Tests des ADRESSES DE COMMUNES VOISINES sur une voie qui longe la limite
 * (v2.27.06).
 *
 * ⚠️⚠️ SIGNALE PAR L'AUTEUR (27/07/2026, Rue de la Republique — 7 segments entre
 * Saint-Geniès-de-Comolas et Montfaucon) : « Ce segment est a cheval sur les 2
 * communes, donc dans un cas comme celui-ci il faudrait proposer de mettre
 * l'adresse pour Saint Genies en Alt EN PLUS de l'adresse deja renseignee pour
 * Montfaucon. »
 *
 * ⭐ CE QUI CLOCHAIT N'ETAIT PAS LE CALCUL, MAIS LA PERTE. La cible hors
 * agglomeration vide la ville du PRINCIPAL, et « Montfaucon » n'etait remis
 * nulle part. Or LE SCRIPT NE SAIT PAS RETIRER UN ALTERNATIF : une adresse
 * deplacee en alternatif reste rattrapable a la main, une adresse ecrasee sur le
 * principal est PERDUE — le script detruisait une donnee qu'il n'aurait pas su
 * reconstruire.
 *
 * ⚠️⚠️ DEUX SITUATIONS OPPOSEES, UN SEUL SYMPTOME, ET C'EST LA GEOMETRIE QUI
 * TRANCHE — pas le nom :
 *   - segment au MILIEU de la commune annonçant la voisine  ⇒ adresse FAUSSE,
 *     elle doit disparaitre (cas signale par l'auteur le 27/07, meme rue) ;
 *   - voie qui LONGE la limite                              ⇒ adresse JUSTE,
 *     elle est conservee en alternatif.
 * ⚠️ Ces tests figent cette frontiere. La deplacer, c'est soit detruire des
 * adresses legitimes, soit garder des adresses fausses.
 *
 * ⚠️ Fonctions EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-voie-mitoyenne.js
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
  relire('normSansAccent'), relire('key'), relire('fmt'),
  'const options = { altEnTrop: false };',
  extraire('conserverAdressesVoisines'), extraire('diffNaming'),
  'return { conserverAdressesVoisines, diffNaming };'
].join('\n'))();

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

const ICI = 'Saint-Geniès-de-Comolas', LA = 'Montfaucon';
const e = (n, v) => ({ name: n || '', cityName: v || '', signText: '', signType: null });
const nam = (p, a) => ({ primary: p, primaryId: 1, alts: a || [] });
const alts = r => (r.alts || []).map(a => a.name + ' / ' + a.cityName);

console.log('\n=== Voie qui longe la limite : l\'adresse d\'en face est conservee ===\n');

// ---------------------------------------------------------------------------
// 1. LE CAS EXACT DE L'AUTEUR — Rue de la Republique, cible H9
// ---------------------------------------------------------------------------
{
  // Ce que WME porte : « Rue de la Republique / Montfaucon » en principal.
  const porte = nam(e('Rue de la République', LA), [e('D101', '')]);
  // Ce que le logigramme H9 vise, AVANT conservation.
  const cibleH9 = { cas: 'H9', primary: e('D101', ''),
                    alts: [e('D101', ICI), e('Rue de la République', ICI)] };

  const avant = alts(cibleH9);
  const apres = api.conserverAdressesVoisines(porte, cibleH9, [LA]);

  verifier('1. la cible d\'origine JETAIT l\'adresse de Montfaucon',
    avant.some(a => /Montfaucon/.test(a)), false);
  verifier('2. ⭐ elle est desormais CONSERVEE en alternatif',
    alts(apres).includes('Rue de la République / ' + LA), true);
  verifier('3. sans rien perdre de ce qui etait vise',
    avant.every(a => alts(apres).includes(a)), true);
  verifier('4. et le principal n\'est PAS touche : hors agglo, pas de ville',
    apres.primary.name + ' / ' + apres.primary.cityName, 'D101 / ');
  verifier('5. l\'adresse conservee vient en DERNIER (les cibles d\'abord)',
    alts(apres)[alts(apres).length - 1], 'Rue de la République / ' + LA);

  // ⚠️ La cible d'origine ne doit pas etre modifiee au passage.
  verifier('6. la cible d\'origine n\'est pas mutee', alts(cibleH9), avant);
}

// ---------------------------------------------------------------------------
// 2. CE QUI NE DOIT RIEN AJOUTER
// ---------------------------------------------------------------------------
{
  const porte = nam(e('Rue de la République', LA), []);
  const cible = { primary: e('D101', ''), alts: [e('D101', ICI)] };
  verifier('7. aucune voisine annoncee : la cible ne bouge pas',
    alts(api.conserverAdressesVoisines(porte, cible, [])), alts(cible));
  verifier('8. liste absente : pas d\'exception',
    api.conserverAdressesVoisines(porte, cible, null), cible);
  verifier('9. nommage absent : pas d\'exception',
    api.conserverAdressesVoisines(null, cible, [LA]), cible);
}
{
  // ⚠️ Pas de DOUBLON : si la cible vise deja cette adresse, on n'ajoute rien.
  const porte = nam(e('Rue de la République', LA), []);
  const cible = { primary: e('D101', ''),
                  alts: [e('Rue de la République', LA), e('D101', ICI)] };
  verifier('10. adresse deja visee : aucun doublon',
    alts(api.conserverAdressesVoisines(porte, cible, [LA])).length, 2);
}
{
  // ⚠️ Une entree SANS ville n'est pas une adresse de voisine.
  const porte = nam(e('D101', ''), [e('Rue de la République', '')]);
  const cible = { primary: e('D101', ''), alts: [e('D101', ICI)] };
  verifier('11. entrees sans ville : rien a conserver',
    alts(api.conserverAdressesVoisines(porte, cible, [LA])), alts(cible));
}
{
  // Seules les communes de la LISTE comptent : une ville inconnue (hameau) non.
  const porte = nam(e('Rue du Moulin', 'Le Hameau'), []);
  const cible = { primary: e('Rue du Moulin', ''), alts: [] };
  verifier('12. une ville qui n\'est pas dans la liste des voisines est ignoree',
    alts(api.conserverAdressesVoisines(porte, cible, [LA])), []);
}

// ---------------------------------------------------------------------------
// 3. CAS REELS DE SAISIE
// ---------------------------------------------------------------------------
{
  // ⚠️ WME et l'INSEE ne s'accordent pas sur accents et casse.
  const porte = nam(e('Rue de la République', 'MONTFAUCON'), []);
  const cible = { primary: e('D101', ''), alts: [] };
  verifier('13. casse : « MONTFAUCON » est bien reconnu',
    alts(api.conserverAdressesVoisines(porte, cible, [LA])),
    ['Rue de la République / MONTFAUCON']);
}
{
  // L'adresse voisine peut deja etre en ALTERNATIF (pas en principal).
  const porte = nam(e('D101', ''), [e('Rue de la République', LA)]);
  const cible = { primary: e('D101', ''), alts: [e('D101', ICI)] };
  verifier('14. une adresse voisine deja en alternatif est conservee aussi',
    alts(api.conserverAdressesVoisines(porte, cible, [LA])).includes(
      'Rue de la République / ' + LA), true);
}
{
  // Deux communes voisines a la fois (carrefour de trois communes).
  const porte = nam(e('Route des Vignes', LA), [e('Route des Vignes', 'Lirac')]);
  const cible = { primary: e('Route des Vignes', ''), alts: [] };
  const r = alts(api.conserverAdressesVoisines(porte, cible, [LA, 'Lirac']));
  verifier('15. deux voisines : les deux sont conservees', r.length, 2);
}

// ---------------------------------------------------------------------------
// 4. L'EFFET SUR LES ECARTS — c'est ce que l'editeur voit
// ---------------------------------------------------------------------------
{
  const porte = nam(e('Rue de la République', LA), []);
  const cible = api.conserverAdressesVoisines(porte,
    { primary: e('D101', ''), alts: [e('D101', ICI), e('Rue de la République', ICI)] }, [LA]);
  const d = api.diffNaming(porte, cible);
  const manquants = d.filter(x => x.champ === 'alt manquant').map(x => x.apres);
  verifier('16. ⭐ « Rue de la République / Montfaucon » est RECLAME en alternatif',
    manquants.includes('Rue de la République / ' + LA), true);
  verifier('17. les deux adresses d\'ici le sont aussi', manquants.length, 3);
  verifier('18. et le principal reste a corriger (ville interdite hors agglo)',
    d.some(x => x.champ === 'principal'), true);
}

// ---------------------------------------------------------------------------
// 4 bis. ⭐ LA DOCTRINE DE L'AUTEUR, FIGEE (27/07)
//
// Question posee : « quand une voie mitoyenne est hors agglo des DEUX cotes,
// la cible reste-t-elle pas de ville en principal, les deux communes en
// alternatif ? » — Reponse : « Doctrine : pas de ville en main, les villes en
// Alt ».
//
// ⚠️ Son cas reel : segments 237389666, 63411311, 63412823, 63412355 (Rue de la
// Republique / Saint-Geniès-de-Comolas / Montfaucon), hors agglomeration sur
// les deux communes, avec des noms differents.
//
// ⚠️⚠️ CE TEST FIGE UNE REGLE DE NOMMAGE, PAS UNE IMPLEMENTATION. Le modifier
// demande l'accord de l'auteur (CC FR).
// ---------------------------------------------------------------------------
{
  // Ce que WME porte : le nom de rue, avec la commune VOISINE en principal.
  const porte = nam(e('Chemin des Vignes', LA), []);
  // Cible H7 (nom de rue seul, hors agglo) : principal SANS ville, nom + commune
  // d'ici en alternatif.
  const cibleH7 = { cas: 'H7', primary: e('Chemin des Vignes', ''),
                    alts: [e('Chemin des Vignes', ICI)] };
  const r = api.conserverAdressesVoisines(porte, cibleH7, [LA]);

  verifier('DOCTRINE. aucune ville en principal',
    r.primary.cityName, '');
  verifier('DOCTRINE. le nom de rue reste en principal',
    r.primary.name, 'Chemin des Vignes');
  verifier('DOCTRINE. ⭐ LES DEUX communes en alternatif', alts(r),
    ['Chemin des Vignes / ' + ICI, 'Chemin des Vignes / ' + LA]);

  // Et ce que l'editeur voit : les deux alternatifs sont reclames.
  const d = api.diffNaming(porte, r);
  const manquants = d.filter(x => x.champ === 'alt manquant').map(x => x.apres);
  verifier('DOCTRINE. les deux adresses sont proposees a l\'ajout',
    manquants.length, 2);
  verifier('DOCTRINE. et le principal est bien signale comme fautif',
    d.some(x => x.champ === 'principal'), true);
}

// ---------------------------------------------------------------------------
// 5. VERROUS DE CONTRAT — la geometrie tranche, pas le nom
// ---------------------------------------------------------------------------
verifier('19. ⚠️⚠️ la conservation est CONDITIONNEE a « longe la limite »',
  /if \(longeLaLimite\) \{[\s\S]{0,600}?conserverAdressesVoisines\(nam, exp, etrangeres\)/.test(src), true);
// ⚠️⚠️ « Tant qu'on sait pas, on fait comme si on savait pas » (auteur, 27/07) :
// sans le zonage de la voisine, on ne touche PAS au principal — mais les
// alternatifs restent proposes, eux sont surs.
verifier('19 bis. ⭐ zonage voisin inconnu ⇒ l\'ecart de PRINCIPAL est retire',
  /if \(mitoyenIndecis\) ecartsNom = ecartsNom\.filter\(e => e\.champ !== 'principal'\)/
    .test(src), true);
// ⚠️ Cible le SEUL filtre pose sur `ecartsNom` : chercher « alt manquant »
// dans tout le fichier tombait sur `planDeCorrection`, qui l'utilise
// legitimement — un test trop large rend un verdict qui ment.
verifier('19 ter. et SEUL le principal l\'est (les alternatifs restent)',
  (src.match(/ecartsNom = ecartsNom\.filter\([^)]*\)/g) || [])
    .every(f => /'principal'/.test(f) && !/alt/.test(f)), true);
verifier('19 quater. le zonage d\'une voisine JAMAIS tracee vaut « inconnu »',
  /return sansAgglo\[code\] \? 'hors' : 'inconnu'/.test(src), true);
verifier('19 quinquies. une agglo chez la voisine lui donne le principal',
  /if \(zonages\.some\(z => z === 'agglo'\)\) return 'voisine'/.test(src), true);
verifier('20. et « longe la limite » est MESURE, pas suppose',
  /partLeLongDeLaLimite\(coords, communeActive\) > 0/.test(src), true);
verifier('21. la note ne dit plus « alors que ce segment est dans X » a tort',
  /longeLaLimite\s*\n?\s*\? 'longe la limite avec/.test(src), true);
verifier('22. le cas « adresse fausse » (27/07) est TOUJOURS traite',
  /commune voisine'\s*\)\s*\+\s*\n?\s*', alors que ce segment est dans ' \+ communeActive\.nom/
    .test(src) || /alors que ce segment est dans/.test(src), true);
verifier('23. l\'extracteur a bien lu la fonction',
  /cityName/.test(extraire('conserverAdressesVoisines')), true);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
