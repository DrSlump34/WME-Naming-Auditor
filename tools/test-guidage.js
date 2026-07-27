/**
 * Tests du GUIDAGE PAS A PAS (v2.21) et du parcours « agglomeration » (v2.22).
 *
 * Ce que ces tests protegent : le guidage doit montrer LE geste suivant, et un
 * seul. Une etape franchie doit s'eteindre — sinon l'animation devient un bruit
 * de fond. Et l'ordre doit suivre le parcours reel : relever les panneaux, en
 * tirer un trace, l'affiner, puis analyser.
 *
 * ⚠️ Defaut vecu (v2.21.00) : `majGuidage()` etait a la seule FIN de
 * `renderAgglos`, qui sort par plusieurs chemins — le guidage restait donc muet
 * exactement la ou il sert le plus, quand aucune commune n'est choisie.
 *
 * ⚠️ Fonctions extraites du userscript, jamais recopiees.
 *
 * Usage : node tools/test-guidage.js
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

/**
 * Monte `etapeCourante` avec un etat complet. Tout est injecte : c'est une
 * fonction de DECISION, elle ne doit dependre de rien d'autre que de l'etat.
 */
function etape(etat) {
  const e = Object.assign({
    guidage: true, paysEtat: 'fr', communes: [{}], communeActive: null,
    edition: null, agglos: {}, sansAgglo: {}, panneaux: [],
    bilanPreTrace: null, sondage: null, lastScan: null,
    // v2.23 : les secteurs d'entrees non couverts retiennent le parcours — une
    // agglomeration oubliee fausse toute l'analyse.
    secteurs: [], couverts: [],
    // v2.24.02 : « le releve a-t-il ete FAIT » ≠ « il y a des panneaux ».
    releveFait: false, voletOuvert: false,
    // v2.26.02 : la commune SOUS LE CENTRE de la carte. `null` = on ne sait pas
    // (hors contours charges, mer) ⇒ le guidage se tait. Par defaut on la fait
    // coincider avec la commune suivie : le decalage est l'exception, pas la regle.
    sousLeCentre: undefined
  }, etat);
  // Par commodite : renseigner `panneaux` implique que le releve a eu lieu.
  if (e.panneaux.length) e.releveFait = true;
  if (e.sousLeCentre === undefined) e.sousLeCentre = e.communeActive;
  const fn = new Function(
    'options', 'pays', 'communes', 'communeActive', 'edition', 'agglos', 'sansAgglo',
    'panneaux', 'bilanPreTrace', 'sondageCourant', 'lastScan',
    'secteursCourants', 'secteurCouvert', 'releveFait', 'ui',
    'guidageDecale', 'communeSousLeCentre',
    extraire('etapeCourante') + '\nreturn etapeCourante();');
  return fn({ guidage: e.guidage }, { etat: e.paysEtat }, e.communes, e.communeActive,
            e.edition, e.agglos, e.sansAgglo, e.panneaux, e.bilanPreTrace,
            () => e.sondage, e.lastScan,
            e.secteurs, g => e.couverts.includes(g), e.releveFait,
            { volet: { classList: { contains: () => e.voletOuvert } } },
            // ⚠️ La VRAIE fonction du userscript, extraite : un test qui reecrirait
            // la comparaison ne prouverait que lui-meme.
            new Function('a', 'b', extraire('guidageDecale') + '\nreturn guidageDecale(a, b);'),
            () => e.sousLeCentre);
}

const COMMUNE = { code: '83119', nom: 'Saint-Tropez' };

titre('Le parcours, dans l\'ordre');
verifier('1. aucun contour ⇒ amener la carte sur la commune',
  etape({ communes: [] }), 'contours');
verifier('2. des contours, pas de commune choisie ⇒ la choisir',
  etape({}), 'commune');
verifier('3. commune choisie, panneaux non relevés ⇒ les relever',
  etape({ communeActive: COMMUNE, sondage: { etat: 'des', nb: 7 } }), 'agglo-panneaux');
verifier('4. panneaux relevés et exploitables ⇒ proposer un tracé',
  etape({ communeActive: COMMUNE, sondage: { etat: 'des', nb: 7 },
          panneaux: [1, 2, 3], bilanPreTrace: { tracables: 1, rubans: 0, isoles: 0 } }),
  'agglo-proposer');
// ⚠️⚠️ TEST RETOURNE EN 2.25.01, ET C'EST VOULU. La 2.24.01 figeait l'inverse
// (« les panneaux d'abord, MEME si un polygone existe ») : l'auteur l'a essayee
// sur une commune deja zonee et a tranche — « on s'en fout, y'a deja une agglo
// tracee ». Renvoyer au releve, c'est faire refaire un geste dont l'editeur n'a
// plus besoin, avec un bandeau qui lui parle du « point de depart du trace »
// alors que le trace est fait. Le garde-fou d'exhaustivite n'est pas perdu : il
// est porte par le panneau de vigilance de fin de zonage (tests 24-25).
verifier('5. ⭐ un polygone existe, panneaux PAS relevés ⇒ on ne renvoie PAS au relevé',
  etape({ communeActive: COMMUNE, agglos: { '83119': [{ ring: [] }] } }), 'analyse');
verifier('5. … et le volet ouvert mène au bilan de couverture, pas aux panneaux',
  etape({ communeActive: COMMUNE, agglos: { '83119': [{ ring: [] }] }, voletOuvert: true }),
  'volet-terminer');
verifier('5. … idem quand les panneaux ONT été relevés',
  etape({ communeActive: COMMUNE, agglos: { '83119': [{ ring: [] }] },
          panneaux: [1, 2], bilanPreTrace: { tracables: 1 } }), 'analyse');
verifier('5. ⚠️ mais SANS polygone, le relevé reste bien le point de départ',
  etape({ communeActive: COMMUNE }), 'agglo-panneaux');
verifier('6. analyse faite ⇒ plus rien a guider (et pas de retour en boucle)',
  etape({ communeActive: COMMUNE, agglos: { '83119': [{ ring: [] }] }, lastScan: {} }), null);
verifier('6. … même sans panneaux relevés', etape({ communeActive: COMMUNE, lastScan: {} }), null);

titre('⚠️ Quand les panneaux ne servent a rien, on envoie au trace manuel');
verifier('7. ⭐ aucun panneau sur la commune (cas Gruissan) ⇒ tracer a la main',
  etape({ communeActive: COMMUNE, sondage: { etat: 'aucun', nb: 0 } }), 'agglo-tracer');
verifier('8. ⭐ panneaux relevés mais AUCUN tracé possible (cas Lattes) ⇒ tracer a la main',
  etape({ communeActive: COMMUNE, sondage: { etat: 'des', nb: 5 },
          panneaux: [1, 2, 3, 4, 5], bilanPreTrace: { tracables: 0, rubans: 1, isoles: 1 } }),
  'agglo-tracer');
verifier('9. sondage incertain (source muette, reseau) ⇒ on n\'empeche rien',
  etape({ communeActive: COMMUNE, sondage: { etat: 'incertain', nb: 0 } }), 'agglo-panneaux');

titre('⚠️ Le sondage n\'a pas encore repondu : on ne designe RIEN (v2.25.01)');
// Sans ce garde, le halo se posait sur « Panneaux » puis SAUTAIT sur « Tracer »
// une seconde plus tard, quand la source repondait « aucun ». Un guidage qui se
// dedit sous les yeux de l'editeur vaut moins qu'un guidage qui attend.
verifier('9 bis. sondage en cours ⇒ etape d\'attente, sans cible',
  etape({ communeActive: COMMUNE, sondage: { etat: 'encours', nb: 0 } }), 'agglo-sondage');
verifier('9 bis. … et surtout PAS le bouton qu\'on s\'apprete peut-etre a griser',
  etape({ communeActive: COMMUNE, sondage: { etat: 'encours', nb: 0 } }) !== 'agglo-panneaux', true);
verifier('9 bis. … le sondage repond « aucun » ⇒ le halo va au trace manuel',
  etape({ communeActive: COMMUNE, sondage: { etat: 'aucun', nb: 0 } }), 'agglo-tracer');
verifier('9 bis. ⚠️ un polygone existe deja ⇒ l\'attente ne retient plus personne',
  etape({ communeActive: COMMUNE, sondage: { etat: 'encours', nb: 0 },
          agglos: { '83119': [{ ring: [] }] } }), 'analyse');
verifier('9 bis. ⚠️ releve deja fait ⇒ pas d\'attente non plus',
  etape({ communeActive: COMMUNE, sondage: { etat: 'encours', nb: 0 },
          releveFait: true, panneaux: [] }), 'agglo-tracer');
verifier('9 bis. « sans agglomeration » cochee ⇒ rien a attendre',
  etape({ communeActive: COMMUNE, sondage: { etat: 'encours', nb: 0 },
          sansAgglo: { '83119': true }, voletOuvert: true }), 'volet-terminer');

titre('Affiner puis enregistrer le trace propose');
// ⚠️ Un polygone issu du PRE-TRACE implique que les panneaux ont ete releves :
// l'etat « aAffiner sans panneaux » ne peut pas exister dans la vraie vie.
const RELEVE = [1, 2, 3];
verifier('10. un polygone issu du pre-trace ⇒ inviter a l\'affiner',
  etape({ communeActive: COMMUNE, panneaux: RELEVE,
          agglos: { '83119': [{ ring: [], aAffiner: true }] } }), 'affiner');
verifier('11. ⚠️ une edition ouverte passe AVANT tout : rien n\'est enregistre tant qu\'elle dure',
  etape({ communeActive: COMMUNE, panneaux: RELEVE,
          agglos: { '83119': [{ ring: [], aAffiner: true }] },
          edition: { agglo: {} } }), 'terminer');
verifier('12. trace affine (drapeau retire) ⇒ on passe a l\'analyse',
  etape({ communeActive: COMMUNE, panneaux: RELEVE,
          agglos: { '83119': [{ ring: [] }] } }), 'analyse');

titre('⚠️ EXHAUSTIVITE : une agglomeration oubliee fausse toute l\'analyse');
{
  // Deux secteurs releves, un seul couvert par un polygone : il reste du travail,
  // et le guidage doit le dire AVANT de laisser passer a l'analyse.
  const s1 = { g: { centre: { lon: 0, lat: 0 }, portes: 4 } };
  const s2 = { g: { centre: { lon: 1, lat: 1 }, portes: 2 } };
  // Des secteurs connus supposent un releve : `panneaux` est donc renseigne.
  verifier('17. ⭐ un secteur non couvert ⇒ inviter a tracer la suite',
    etape({ communeActive: COMMUNE, panneaux: RELEVE, agglos: { '83119': [{ ring: [] }] },
            secteurs: [s1, s2], couverts: [s1.g] }), 'agglo-encore');
  verifier('18. tous les secteurs couverts ⇒ on passe a l\'analyse',
    etape({ communeActive: COMMUNE, panneaux: RELEVE, agglos: { '83119': [{ ring: [] }] },
            secteurs: [s1, s2], couverts: [s1.g, s2.g] }), 'analyse');
  verifier('19. ⚠️ le trace a affiner passe AVANT le rappel d\'exhaustivite',
    etape({ communeActive: COMMUNE, panneaux: RELEVE,
            agglos: { '83119': [{ ring: [], aAffiner: true }] },
            secteurs: [s1, s2], couverts: [] }), 'affiner');
  verifier('20. aucun secteur connu ⇒ pas de faux rappel (on ne sait rien)',
    etape({ communeActive: COMMUNE, panneaux: RELEVE, agglos: { '83119': [{ ring: [] }] },
            secteurs: [], couverts: [] }), 'analyse');
}

titre('⚠️ LE CAS LIRAC : un relevé qui ne rend RIEN');
{
  // 980 ha, 0 panneau dans le contour. Le sondage avait repondu « incertain »
  // (cellule pleine pres d'Avignon), donc le bouton restait actif.
  verifier('21. ⭐ relevé FAIT mais aucun panneau ⇒ tracer a la main',
    etape({ communeActive: COMMUNE, releveFait: true, panneaux: [],
            sondage: { etat: 'incertain', nb: 0 } }), 'agglo-tracer');
  verifier('22. ⚠️ et surtout PAS un retour sur le bouton qu\'on vient de cliquer',
    etape({ communeActive: COMMUNE, releveFait: true, panneaux: [] }) !== 'agglo-panneaux', true);
  verifier('23. relevé PAS ENCORE fait ⇒ la, on y envoie',
    etape({ communeActive: COMMUNE, releveFait: false, panneaux: [] }), 'agglo-panneaux');
}

titre('Le zonage est fait : refermer le volet, PUIS analyser');
{
  const pret = { communeActive: COMMUNE, panneaux: [1], agglos: { '83119': [{ ring: [] }] } };
  verifier('24. ⭐ volet OUVERT ⇒ inviter a le refermer (il recouvre le bouton d\'analyse)',
    etape(Object.assign({ voletOuvert: true }, pret)), 'volet-terminer');
  verifier('25. volet ferme ⇒ lancer l\'analyse',
    etape(Object.assign({ voletOuvert: false }, pret)), 'analyse');
  verifier('26. ⚠️ mais un secteur decouvert passe AVANT de proposer de terminer',
    etape(Object.assign({ voletOuvert: true,
      secteurs: [{ g: { centre: { lon: 0, lat: 0 }, portes: 2 } }], couverts: [] }, pret)),
    'agglo-encore');
}

titre('⚠️⚠️ LE CAS SAINT-GENIES : la carte et le script ne regardent pas la meme commune');
{
  // CE QUI S'EST PASSE (auteur, 27/07). L'editeur cadre Saint-Genies-de-Comolas,
  // commune VIERGE. Saint-Laurent-des-Arbres, ZONEE, est a 3,7 km : elle reste
  // dans la vue, donc `rafraichirCommunesDeLaVue` garde le script dessus — c'est
  // VOULU (on ne perd pas son travail en faisant glisser la carte). Le bandeau
  // affichait alors « Le zonage est fait », parfaitement exact… pour une commune
  // dont il ne prononcait pas le nom. Quatre hypotheses sont tombees devant la
  // mesure avant qu'on trouve, et 8 640 combinaisons d'etat ont prouve qu'aucune
  // ne rend « volet-terminer » sans polygone : le defaut n'etait pas dans le
  // calcul, il etait dans le SILENCE du libelle.
  const SUIVIE = { code: '30278', nom: 'Saint-Laurent-des-Arbres' };   // zonee
  const CADREE = { code: '30254', nom: 'Saint-Geniès-de-Comolas' };    // vierge
  const zonee = { communeActive: SUIVIE, agglos: { '30278': [{ ring: [] }] }, voletOuvert: true };

  verifier('27. ⭐ le script suit une commune, la carte en montre une autre ⇒ on le DIT',
    etape(Object.assign({ sousLeCentre: CADREE }, zonee)), 'commune-decalee');
  verifier('27. ⚠️⚠️ et surtout : plus jamais « le zonage est fait » dans ce cas',
    etape(Object.assign({ sousLeCentre: CADREE }, zonee)) !== 'volet-terminer', true);
  verifier('28. les deux coincident ⇒ le parcours normal reprend, inchange',
    etape(Object.assign({ sousLeCentre: SUIVIE }, zonee)), 'volet-terminer');
  verifier('29. ⚠️ centre hors des contours charges (mer, autre departement) ⇒ SILENCE',
    etape(Object.assign({ sousLeCentre: null }, zonee)), 'volet-terminer');

  // ⚠️ Le decalage ne doit pas devenir un nouveau bruit de fond : deux etats le
  // priment, et pour des raisons opposees.
  verifier('30. ⚠️ une edition en cours PRIME : on ne renvoie pas a la liste avec un tracé ouvert',
    etape(Object.assign({ sousLeCentre: CADREE, edition: { agglo: {} } }, zonee)), 'terminer');
  verifier('31. ⭐ APRES l\'analyse, le guidage se tait : l\'editeur navigue d\'un ecart a l\'autre',
    etape(Object.assign({ sousLeCentre: CADREE, lastScan: {} }, zonee)), null);

  // La fonction de comparaison elle-meme, extraite du userscript.
  const dec = new Function('a', 'b', extraire('guidageDecale') + '\nreturn guidageDecale(a, b);');
  verifier('32. `guidageDecale` : meme commune ⇒ null', dec(SUIVIE, SUIVIE), null);
  verifier('32. … communes differentes ⇒ celle qu\'on regarde', dec(SUIVIE, CADREE), CADREE);
  verifier('32. … aucune commune suivie ⇒ null (rien a comparer)', dec(null, CADREE), null);
  verifier('32. … centre inconnu ⇒ null (on ne prend pas le silence pour un desaccord)',
    dec(SUIVIE, null), null);

  // ⭐ LA REGLE QUI SORT DE CETTE SESSION : une etape qui AFFIRME nomme sa commune.
  const tG = src.slice(src.indexOf('const GUIDAGE = {'));
  const tableGuidage = tG.slice(0, tG.indexOf('\n  };'));
  // ⚠️ Decoupage EXACT par entree : une fenetre de N caracteres debordait sur
  // l'entree suivante — le test aurait valide `volet-terminer` grace au
  // `nomSuivi()` de `analyse`. Un extracteur approximatif rend un test qui ment.
  const entrees = {};
  {
    const re = /\n {4}(?:'([a-z-]+)'|([a-z-]+)): \{/g;
    let m, cle = null, debut = 0;
    while ((m = re.exec(tableGuidage))) {
      if (cle) entrees[cle] = tableGuidage.slice(debut, m.index);
      cle = m[1] || m[2]; debut = m.index;
    }
    if (cle) entrees[cle] = tableGuidage.slice(debut);
  }
  verifier('33. … et le harnais decoupe bien la table (garde-fou du test lui-meme)',
    Object.keys(entrees).length >= 10, true);
  const affirme = ['volet-terminer', 'analyse', 'agglo-tracer'];
  verifier('33. ⭐ toute etape qui affirme un etat NOMME sa commune',
    affirme.filter(id => !/nomSuivi\(\)/.test(entrees[id] || '')), []);
}

titre('Les cas ou le guidage doit se TAIRE');
verifier('13. guidage decoche ⇒ rien, jamais', etape({ guidage: false }), null);
verifier('14. ⚠️ hors de France : le garde-fou parle deja, on ne le double pas',
  etape({ paysEtat: 'hors', communeActive: COMMUNE }), null);
verifier('15. territoire indetermine ⇒ silence aussi', etape({ paysEtat: 'inconnu' }), null);
verifier('16. commune declaree « sans agglomeration » ⇒ on ne reclame pas de polygone',
  etape({ communeActive: COMMUNE, sansAgglo: { '83119': true } }), 'analyse');

titre('Verrous sur le SOURCE');
{
  const rA = src.slice(src.indexOf('function renderAgglos'));
  const corps = rA.slice(0, rA.indexOf('\n  function ', 10));
  const appels = (corps.match(/majGuidage\(\)/g) || []).length;
  verifier('17. ⚠️ `renderAgglos` rafraichit le guidage sur CHACUNE de ses sorties',
    appels >= 3, true);
  const ordre = src.indexOf('id="agn-panneaux"');
  verifier('18. l\'ordre des boutons suit la progression : panneaux → proposer → tracer',
    ordre < src.indexOf('id="agn-pretrace"') &&
    src.indexOf('id="agn-pretrace"') < src.indexOf('id="agn-tracer"'), true);

  // ⚠️⚠️ LE CONTRAT QUI MANQUAIT. `etapeCourante` rend un identifiant, `GUIDAGE`
  // le traduit en bandeau : une etape ajoutee d'un cote et oubliee de l'autre
  // fait `g.n` sur `undefined` — le bandeau meurt, et avec lui tout le guidage.
  // C'est la meme famille de defaut que le ⚡ des POI (v2.19) : le calcul etait
  // juste, le RENDU ne suivait pas, et aucun test unitaire ne le voyait.
  const corpsEtape = extraire('etapeCourante');
  const rendues = [...new Set([...corpsEtape.matchAll(/return '([a-z-]+)'/g)].map(m => m[1]))];
  const tableG = src.slice(src.indexOf('const GUIDAGE = {'));
  const declarees = tableG.slice(0, tableG.indexOf('\n  };'));
  const orphelines = rendues.filter(id =>
    !declarees.includes('\n    ' + id + ':') && !declarees.includes('\'' + id + '\':'));
  verifier('19. ⭐ toute etape rendue par `etapeCourante` a son entree dans `GUIDAGE`',
    orphelines, []);
  verifier('19. … et le harnais voit bien toutes les etapes (garde-fou du test lui-meme)',
    rendues.length >= 9, true);

  // ⚠️ v2.25.02 : le bandeau de guidage vit dans la FENETRE de travail. Un
  // « ce volet » / « cette section » y designe donc un element qui n'est pas le
  // sien — c'est la regle « ne jamais guider vers un element qu'on ne montre
  // pas », appliquee aux MOTS. On nomme par la place, pas par la proximite.
  // ⚠️ v2.26.02 : un libelle peut desormais etre une FONCTION (les etapes qui
  // affirment un etat nomment leur commune). L'ancien extracteur ne lisait que
  // `texte: '…'` et devenait AVEUGLE a ces libelles — son propre garde-fou l'a
  // dit. On lit donc TOUS les litteraux de la table, commentaires retires : ils
  // parlent justement de « ce volet » pour expliquer pourquoi on l'a banni.
  const sansCommentaires = declarees.split('\n')
    .filter(l => !l.trim().startsWith('//')).join('\n');
  const textesG = [...sansCommentaires.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'/g)]
    .map(m => m[1]).filter(t => /\s/.test(t));   // les libelles, pas les selecteurs CSS
  verifier('21. ⭐ aucun bandeau ne dit « ce volet » : il n\'y est pas',
    textesG.filter(t => /\bce volet\b|\bcette section\b/i.test(t)), []);
  verifier('21. … et le harnais lit bien les textes (garde-fou du test lui-meme)',
    textesG.length >= 20, true);

  // v2.25.01 : le bouton se ferme AUSSI pendant le sondage, sinon un clic rapide
  // lance un releve complet que la reponse legere va peut-etre rendre inutile.
  const rA2 = src.slice(src.indexOf('const sansPanneaux'));
  verifier('20. ⚠️ « 🪧 Panneaux » est ferme pendant le sondage, pas seulement apres',
    /sondageEnCours/.test(rA2.slice(0, 600)) &&
    /btnPanneaux\.disabled[^\n]*sondageEnCours/.test(rA2.slice(0, 600)), true);
}

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(60));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
