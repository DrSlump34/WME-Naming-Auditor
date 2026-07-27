/**
 * Tests du GARDE-FOU « ville sans polygone » — chantier fonctionnel de l'audit.
 *
 * C'est le garde-fou le plus important du script : une ville portee par le NOM
 * PRINCIPAL veut dire « je suis en agglomeration ». Si aucun segment qui l'annonce
 * ne tombe dans un polygone, c'est qu'il en manque un — et sans alerte, le script
 * reclame le RETRAIT de la ville sur tous ces segments : des corrections A
 * L'ENVERS, exactement ce que tout le reste cherche a eviter.
 *
 * ⚠️ Fonctions EXTRAITES du userscript. `lastScan` et `options` sont injectes.
 *
 * Usage : node tools/test-ville-sans-polygone.js
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
 * Monte les fonctions avec un `lastScan` fabrique.
 *
 * ⚠️ v2.26.02 : `villesSansPolygone` distingue desormais les COMMUNES VOISINES
 * (une adresse fausse) des villes inconnues (un polygone manquant). Le harnais
 * fournit donc un repertoire de communes ; par defaut il est VIDE, donc aucun
 * nom n'est une commune — les tests d'origine gardent exactement leur sens.
 */
function monter(villes, interrompu, seuil, repertoire, active) {
  const lastScan = { interrompu: !!interrompu, zones: { villes: new Map(Object.entries(villes)) } };
  const options = { seuil: seuil === undefined ? 0.8 : seuil };
  const communes = repertoire || [];
  const communeActive = active || { code: '30254', nom: 'Saint-Geniès-de-Comolas' };
  // ⚠️ La constante est RELUE dans le source, pas recopiee : une valeur figee ici
  // testerait autre chose que ce qui tourne.
  const mc = src.match(/const\s+PART_MIN_EN_POLYGONE\s*=\s*([^;]+);/);
  if (!mc) throw new Error('constante PART_MIN_EN_POLYGONE introuvable');
  // ⚠️ `normSansAccent` est relue dans le source elle aussi : la comparaison de
  // noms de communes est le cœur du tri, la recopier testerait ma version a moi.
  const mn = src.match(/const\s+normSansAccent\s*=\s*([^;]+);/);
  if (!mn) throw new Error('normSansAccent introuvable');
  const code = 'const PART_MIN_EN_POLYGONE = ' + mc[1] + ';\n' +
               'const normSansAccent = ' + mn[1] + ';\n' +
               extraire('communeVoisineDeNom') + '\n' +
               extraire('villesSansPolygone') + '\n' +
               extraire('villesPolygoneManquant') + '\n' +
               extraire('villesCommuneVoisine') + '\n' +
               extraire('bandeauVillesSansPolygone') + '\n' +
               extraire('bandeauCommunesVoisines') +
               '\nreturn { villesSansPolygone, villesPolygoneManquant, villesCommuneVoisine,' +
               ' bandeauVillesSansPolygone, bandeauCommunesVoisines, communeVoisineDeNom };';
  // `esc` est appele par le bandeau : on fournit le vrai comportement attendu.
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return new Function('lastScan', 'options', 'esc', 'communes', 'communeActive', code)(
    lastScan, options, esc, communes, communeActive);
}

console.log('\n=== Garde-fou « ville sans polygone » ===\n');

// 1. Cas d'ecole, celui de la v1.97 (Les Ayguades retirees) : une ville portee
//    par 27 segments, aucun dans un polygone.
let api = monter({ 'Les Ayguades': { total: 27, dansPolygone: 0 } });
let r = api.villesSansPolygone();
verifier('1. aucun segment en polygone — signalee', r.length, 1);
verifier('1. degre « aucun »', r[0] && r[0].degre, 'aucun');
verifier('1. le compte est juste', r[0] && r[0].total, 27);
let b = api.bandeauVillesSansPolygone();
verifier('1. le bandeau AFFIRME qu\'il manque un polygone',
         /Il manque au moins un polygone/.test(b), true);
verifier('1. le bandeau avertit du sens des corrections',
         /mauvais sens/.test(b), true);

// 2. Ville entierement couverte : rien a signaler.
api = monter({ Coursan: { total: 40, dansPolygone: 40 } });
verifier('2. tout en polygone — aucune alerte', api.villesSansPolygone().length, 0);
verifier('2. bandeau vide', api.bandeauVillesSansPolygone(), '');

// 3. Majoritairement couverte (debord normal d'un polygone) : pas d'alerte.
api = monter({ Coursan: { total: 40, dansPolygone: 36 } });
verifier('3. 36/40 en polygone — aucune alerte', api.villesSansPolygone().length, 0);

// 4. ⚠️ LE CAS QUE L'ANCIEN TEST LAISSAIT PASSER : 1 segment sur 27 dans le
//    polygone. « aucun » etait faux, donc silence — et 26 segments recevaient
//    quand meme des corrections a l'envers.
api = monter({ 'Les Ayguades': { total: 27, dansPolygone: 1 } });
r = api.villesSansPolygone();
verifier('4. 1/27 en polygone — signalee quand meme', r.length, 1);
verifier('4. degre « presque » (polygone trop petit)', r[0] && r[0].degre, 'presque');
verifier('4. le bandeau dit « probablement trop petit »',
         /trop petit/.test(api.bandeauVillesSansPolygone()), true);

// 5. Le garde-fou a SON seuil (25 %), distinct de celui du rattachement.
//    ⚠️ Verrou de non-regression : `1 - options.seuil` avait ete branche la par
//    elegance, et il INVERSAIT la logique — un seuil de rattachement plus
//    exigeant (90 %) rendait l'alerte moins sensible (10 %). Ces trois tests le
//    figent : le verdict ne doit pas bouger avec le seuil de rattachement.
api = monter({ X: { total: 27, dansPolygone: 12 } }, false, 0.6);   // 44 % en polygone
verifier('5. 44 % en polygone — pas d\'alerte', api.villesSansPolygone().length, 0);
api = monter({ X: { total: 27, dansPolygone: 5 } }, false, 0.6);    // 18 % en polygone
verifier('5. 18 % en polygone — alerte', api.villesSansPolygone().length, 1);
const a60 = monter({ X: { total: 27, dansPolygone: 5 } }, false, 0.6).villesSansPolygone().length;
const a90 = monter({ X: { total: 27, dansPolygone: 5 } }, false, 0.9).villesSansPolygone().length;
verifier('5. insensible au seuil de rattachement (60 % vs 90 %)', [a60, a90], [1, 1]);

// 6. ⚠️⚠️ ANALYSE INTERROMPUE : le constat n'est pas fiable (les segments en
//    polygone peuvent etre justement ceux qui n'ont pas ete vus). Meme doctrine
//    que les cartouches, qui ne concluent pas sur un recensement partiel.
api = monter({ 'Les Ayguades': { total: 27, dansPolygone: 0 } }, true);
b = api.bandeauVillesSansPolygone();
verifier('6. interrompue — la liste reste utile', api.villesSansPolygone().length, 1);
verifier('6. interrompue — n\'AFFIRME plus qu\'il manque un polygone',
         /Il manque au moins un polygone/.test(b), false);
verifier('6. interrompue — dit que le constat n\'est pas fiable',
         /n&#39;est pas fiable|pas fiable/.test(b), true);
verifier('6. interrompue — invite a relancer en entier',
         /Relance l&#39;analyse en entier|Relance l'analyse en entier/.test(b), true);

// 7. Classement : la ville la plus portee d'abord (c'est la plus urgente).
api = monter({ Petite: { total: 3, dansPolygone: 0 },
               Grande: { total: 30, dansPolygone: 0 } });
verifier('7. triee par nombre de segments décroissant',
         api.villesSansPolygone().map(v => v.nom), ['Grande', 'Petite']);

// 8. Un nom de ville venu de Waze est ECHAPPE dans le bandeau (il vient de
//    l'exterieur : n'importe quel editeur peut nommer une ville).
api = monter({ '<img src=x onerror=alert(1)>': { total: 5, dansPolygone: 0 } });
b = api.bandeauVillesSansPolygone();
verifier('8. le nom de ville est echappe', /<img/.test(b), false);
verifier('8. et rendu lisible', /&lt;img/.test(b), true);

// ============================================================================
// 10. ⚠️⚠️ LE CAS SAINT-GENIES (auteur, 27/07) — UNE COMMUNE VOISINE N'EST PAS
//     UN POLYGONE MANQUANT.
//
// Vecu : sur Saint-Geniès-de-Comolas, « Montfaucon » (7 segments) et
// « Saint-Laurent-des-Arbres » (1) declenchaient « Il manque au moins un
// polygone » — donc « trace le polygone de la commune d'a cote ». Reponse de
// l'auteur : « Je suis sur Saint-Genies, j'ai pas envie de tracer les polygones
// des autres communes. » Pire, l'alerte affirmait que « les ecarts les
// concernant sont faux » alors que la correction proposee est JUSTE : hors
// agglomeration la cible met le cartouche a `nomCommune`, donc elle retablit
// deja Saint-Geniès.
// ============================================================================
const GARD = [
  { code: '30254', nom: 'Saint-Geniès-de-Comolas' },
  { code: '30278', nom: 'Saint-Laurent-des-Arbres' },
  { code: '30171', nom: 'Montfaucon' }
];
{
  api = monter({ Montfaucon: { total: 7, dansPolygone: 0 },
                 'Saint-Laurent-des-Arbres': { total: 1, dansPolygone: 0 },
                 'Le Bosquet': { total: 12, dansPolygone: 0 } }, false, undefined, GARD);
  verifier('10. les trois sont bien detectees comme mal couvertes',
           api.villesSansPolygone().length, 3);
  verifier('10. ⭐ seule la ville INCONNUE reclame un polygone',
           api.villesPolygoneManquant().map(v => v.nom), ['Le Bosquet']);
  verifier('10. ⭐ les deux communes voisines sont mises a part',
           api.villesCommuneVoisine().map(v => v.nom).sort(),
           ['Montfaucon', 'Saint-Laurent-des-Arbres']);

  b = api.bandeauVillesSansPolygone();
  verifier('10. ⚠️⚠️ l\'alerte de zonage ne parle PLUS de Montfaucon',
           /Montfaucon/.test(b), false);
  verifier('10. … mais parle toujours du hameau inconnu', /Le Bosquet/.test(b), true);

  const bv = api.bandeauCommunesVoisines();
  verifier('10. le constat nomme les communes et compte les segments',
           /Montfaucon<\/b> \(7\)/.test(bv), true);
  verifier('10. ⭐ et dit qu\'il n\'y a RIEN A TRACER', /Rien à tracer/.test(bv), true);
  verifier('10. ⚠️ il ne reprend PAS le « mauvais sens » de l\'alerte (les corrections sont justes)',
           /mauvais sens/.test(bv), false);
  verifier('10. il prend le ton neutre de l\'information, pas de l\'alerte',
           /agn-info-bloc/.test(bv), true);
}
{
  // ⚠️ Aucune commune voisine citee ⇒ le second bandeau se TAIT (pas de bloc vide).
  api = monter({ 'Le Bosquet': { total: 12, dansPolygone: 0 } }, false, undefined, GARD);
  verifier('11. aucune voisine ⇒ pas de bandeau de constat', api.bandeauCommunesVoisines(), '');
  verifier('11. … et l\'alerte de zonage fonctionne comme avant',
           /Il manque au moins un polygone/.test(api.bandeauVillesSansPolygone()), true);
  // ⚠️ Une ville TOTALEMENT couverte n'est signalee ni d'un cote ni de l'autre,
  // meme si elle porte le nom d'une commune voisine (cas d'une voie mitoyenne
  // correctement zonee) : le tri ne doit pas ressusciter des cas classes.
  api = monter({ Montfaucon: { total: 9, dansPolygone: 9 } }, false, undefined, GARD);
  verifier('11. une voisine entierement en polygone reste silencieuse',
           [api.villesPolygoneManquant().length, api.villesCommuneVoisine().length], [0, 0]);
}
{
  // ⭐ LA COMPARAISON DE NOMS, la ou tout se joue.
  const v = api.communeVoisineDeNom;
  verifier('12. ⚠️ accents et casse ignores (WME et l\'INSEE ne s\'accordent pas dessus)',
           !!v('MONTFAUCON', GARD, '30254'), true);
  verifier('12. … « Saint-Genies » sans accent reste LA commune active, pas une voisine',
           v('Saint-Genies-de-Comolas', GARD, '30254'), null);
  verifier('12. ⚠️⚠️ un village rattache « X (Commune) » n\'est PAS une commune voisine',
           v('Les Ayguades (Gruissan)', GARD, '30254'), null);
  verifier('12. un hameau inconnu au repertoire ⇒ null (c\'est lui qui vaut un polygone)',
           v('Le Bosquet', GARD, '30254'), null);
  verifier('12. vide ou absent ⇒ null', [v('', GARD, '30254'), v(null, GARD, '30254')], [null, null]);
  verifier('12. repertoire vide (contours pas charges) ⇒ null, jamais d\'exception',
           v('Montfaucon', [], '30254'), null);
}

{
  // ⭐ LA NOTE PORTEE PAR LE REPORT. C'est elle qui fait des 7 segments un cas
  // REPERABLE (« il faut qu'ils deviennent un cas a traiter », auteur 27/07) :
  // elle entre dans la cle de regroupement, donc ils ne sont plus fondus avec
  // les autres ecarts « Hors agglomération ».
  const mn2 = src.match(/const\s+normSansAccent\s*=\s*([^;]+);/);
  const etr = new Function('normSansAccent', 'nam', 'liste', 'code',
    extraire('communeVoisineDeNom') + '\n' + extraire('communesEtrangeresDuSegment') +
    '\nreturn communesEtrangeresDuSegment(nam, liste, code);');
  const norm = new Function('return ' + mn2[1] + ';')();
  const seg = (p, alts) => ({ primary: p, alts: alts || [] });

  verifier('13. ville etrangere sur le nom PRINCIPAL (segment en agglomeration)',
    etr(norm, seg({ name: 'Rue du Portail', cityName: 'Montfaucon' }), GARD, '30254'),
    ['Montfaucon']);
  verifier('13. ⚠️ … et sur un ALTERNATIF : hors agglo la commune vit dans le CARTOUCHE',
    etr(norm, seg({ name: 'D101', cityName: '' },
                  [{ name: 'D101', cityName: 'Montfaucon' }]), GARD, '30254'),
    ['Montfaucon']);
  verifier('13. la commune d\'ici ne se signale jamais elle-meme',
    etr(norm, seg({ name: 'Rue Neuve', cityName: 'Saint-Geniès-de-Comolas' }), GARD, '30254'),
    []);
  verifier('13. deux voisines citees ⇒ les deux, sans doublon',
    etr(norm, seg({ name: 'D26', cityName: 'Montfaucon' },
                  [{ name: 'D26', cityName: 'Saint-Laurent-des-Arbres' },
                   { name: 'D26bis', cityName: 'Montfaucon' }]), GARD, '30254'),
    ['Montfaucon', 'Saint-Laurent-des-Arbres']);
  verifier('13. segment sans aucune ville (cas normal hors agglo) ⇒ rien',
    etr(norm, seg({ name: 'D101', cityName: '' }), GARD, '30254'), []);
}

// 9. Aucun scan : pas d'alerte, pas d'erreur.
const vide = new Function('lastScan', 'options', 'esc',
  extraire('villesSansPolygone') + '\nreturn villesSansPolygone;')(null, { seuil: 0.8 }, String);
verifier('9. sans analyse — liste vide', vide(), []);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(66));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
