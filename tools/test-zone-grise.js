/**
 * Tests de la ZONE GRISE sur la limite communale (v2.27.04).
 *
 * ⚠️⚠️ DEUX REMONTEES DE GLENAN56 (27/07/2026) QUI SONT LE MEME DEFAUT, VU DES
 * DEUX COTES :
 *   1. « le script ne detecte pas les segments hors ville sans nom mais qui ont
 *      la ville en principal. Il ne propose donc pas la correction en
 *      supprimant le nom de ville. »
 *   2. « A mon avis, inutile : il propose de couper des segments sans nom (et
 *      sans ville) pour coller aux limites communales […] surtout qu'ici c'est
 *      un chemin pieton. »
 *
 * ⭐ LA CAUSE COMMUNE : un segment a cheval partait en report « a couper » puis
 * `continue` — son NOM n'etait jamais audite. Sa capture le prouve : « limite
 * communale : 67 % dans Caraman », et 67 % tombe dans la zone grise (seuil 0,8).
 *
 * ⭐ ET LE `continue` N'ETAIT PAS UN OUBLI : « il faut couper avant de nommer,
 * le bon nommage depend de l'endroit de la coupe ». C'est vrai — mais pas de
 * TOUT. Hors agglomeration le principal ne porte JAMAIS de ville : cet ecart-la
 * est certain quoi qu'il advienne de l'autre moitie. Ces tests figent
 * exactement cette frontiere : ce qu'on affirme, et ce qu'on se garde de dire.
 *
 * ⚠️ Fonctions EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-zone-grise.js
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
  relire('normSansAccent'),
  extraire('coupeCommunaleUtile'), extraire('ecartsCertainsEnZoneGrise'),
  'return { coupeCommunaleUtile, ecartsCertainsEnZoneGrise };'
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

const e = (n, v) => ({ name: n || '', cityName: v || '', signText: '', signType: null });
const nam = (p, a) => ({ primary: p, primaryId: 1, alts: a || [] });

console.log('\n=== Zone grise sur la limite communale ===\n');

// ---------------------------------------------------------------------------
// 1. LA COUPE A-T-ELLE UN OBJET ?
// ---------------------------------------------------------------------------
verifier('1. ni nom ni ville — RIEN a couper (le sentier de Glenan)',
  api.coupeCommunaleUtile(nam(e('', ''))), false);
verifier('2. une ville en principal — il y a de quoi couper',
  api.coupeCommunaleUtile(nam(e('', 'Caraman'))), true);
verifier('3. un nom sans ville — il y a de quoi couper',
  api.coupeCommunaleUtile(nam(e('Chemin des Poulets', ''))), true);
verifier('4. rien en principal mais un ALTERNATIF nomme — on coupe quand meme',
  api.coupeCommunaleUtile(nam(e('', ''), [e('Chemin des Poulets', 'Caraman')])), true);
verifier('5. un alternatif VIDE ne fait pas une raison de couper',
  api.coupeCommunaleUtile(nam(e('', ''), [e('', '')])), false);
verifier('6. des espaces ne comptent pas comme un nom',
  api.coupeCommunaleUtile(nam(e('   ', '  '))), false);
verifier('7. nommage absent : on ne plante pas', api.coupeCommunaleUtile(null), false);

// ⚠️ Le TYPE de voie n'entre PAS dans le critere (arbitrage de l'auteur) :
// un sentier NOMME se coupe comme une rue.
verifier('8. le critere ne regarde pas le type de voie',
  /roadType/.test(extraire('coupeCommunaleUtile')), false);

// ---------------------------------------------------------------------------
// 2. CE QU'ON AFFIRME SANS SAVOIR OU LA COUPE TOMBERA
// ---------------------------------------------------------------------------
{
  // ⭐ LE CAS EXACT DE GLENAN : « Sans nom, Caraman » hors agglo, a cheval.
  const r = api.ecartsCertainsEnZoneGrise(nam(e('', 'Caraman')), false, 'Caraman');
  verifier('9. hors agglo + ville de la commune active — UN ecart certain', r.length, 1);
  verifier('10. et il vise le retrait de la ville', r[0] && r[0].apres, '‹sans nom› / ‹sans ville›');
  verifier('11. le champ nomme la raison', r[0] && r[0].champ, 'ville en trop (hors agglomération)');
}
{
  const r = api.ecartsCertainsEnZoneGrise(nam(e('Chemin des Poulets', 'Caraman')), false, 'Caraman');
  verifier('12. le nom de rue est conserve dans la cible',
    r[0] && r[0].apres, 'Chemin des Poulets / ‹sans ville›');
}

// ---------------------------------------------------------------------------
// 3. ⭐ CE QU'ON SE GARDE DE DIRE — la moitie des tests, et la plus importante
// ---------------------------------------------------------------------------
verifier('13. EN AGGLO : la ville est attendue, on n\'affirme rien',
  api.ecartsCertainsEnZoneGrise(nam(e('', 'Caraman')), true, 'Caraman'), []);
verifier('14. ⚠️ ville d\'une commune VOISINE : sa moitie est peut-etre en agglo la-bas',
  api.ecartsCertainsEnZoneGrise(nam(e('', 'Auriac-sur-Vendinelle')), false, 'Caraman'), []);
verifier('15. aucune ville portee : rien a retirer',
  api.ecartsCertainsEnZoneGrise(nam(e('Chemin des Poulets', '')), false, 'Caraman'), []);
verifier('16. une ville en ALTERNATIF n\'est pas jugee (elle peut etre voulue)',
  api.ecartsCertainsEnZoneGrise(nam(e('', ''), [e('Chemin', 'Caraman')]), false, 'Caraman'), []);
verifier('17. nommage absent : on ne plante pas',
  api.ecartsCertainsEnZoneGrise(null, false, 'Caraman'), []);

// ⚠️ WME et l'INSEE ne s'accordent pas sur les diacritiques ni la casse.
verifier('18. accents : « Saint-Genies » vaut « Saint-Geniès »',
  api.ecartsCertainsEnZoneGrise(nam(e('', 'Saint-Genies')), false, 'Saint-Geniès').length, 1);
verifier('19. casse : « CARAMAN » vaut « Caraman »',
  api.ecartsCertainsEnZoneGrise(nam(e('', 'CARAMAN')), false, 'Caraman').length, 1);

// ---------------------------------------------------------------------------
// 4. VERROUS DE CONTRAT — le branchement dans la boucle d'analyse
// ---------------------------------------------------------------------------
verifier('20. la coupe inutile est ecartee AVANT de pousser le report',
  /else if \(!coupeCommunaleUtile\(nam\)\)/.test(src), true);
verifier('21. ⭐ le report « a couper » porte les ecarts certains',
  /\.concat\(ecartsCertainsEnZoneGrise\(nam, enAgglo, communeActive\.nom\)\)/.test(src), true);
verifier('22. un segment ecarte est COMPTE, jamais tu (zones.limComRien)',
  /zones\.limComRien\+\+/.test(src), true);
verifier('23. et ce compteur existe dans le bilan',
  /limComRien: 0/.test(src) && /z\.limComRien/.test(src), true);
// L'extracteur lit-il encore quelque chose ? (lecon de la v2.26)
verifier('24. l\'extracteur a bien lu les deux fonctions',
  /cityName/.test(extraire('ecartsCertainsEnZoneGrise')) &&
  /alts/.test(extraire('coupeCommunaleUtile')), true);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
