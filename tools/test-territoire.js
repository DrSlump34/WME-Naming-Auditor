/**
 * Tests du GARDE-FOU TERRITORIAL (v2.03, corrige en 2.19.04).
 *
 * Ce que ces tests protegent, dans les deux sens :
 *  - le script ne doit JAMAIS appliquer des regles francaises hors de France
 *    (c'est tout l'objet du garde-fou) ;
 *  - mais il ne doit PAS NON PLUS se bloquer devant une commune francaise
 *    parfaitement identifiee. C'est ce qui est arrive a GRUISSAN le 27/07 :
 *    apres le cadrage, le centre du canvas tombait EN MER (hors contour) et le
 *    zoom etait trop faible pour que WME charge un segment — les deux preuves
 *    muettes, donc « territoire indetermine » sur une commune selectionnee.
 *    Arbitrage de l'auteur : « Gruissan est en France. Point barre. »
 *
 * ⚠️ Fonctions et constantes EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-territoire.js
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

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else { ko++; lignes.push('  ECHEC ' + titre +
    '\n          attendu ' + JSON.stringify(attendu) + '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
function titre(t) { lignes.push('\n' + t); }

/**
 * Monte `detecterPays` avec un faux SDK. `etat` decrit la situation :
 *   centre    — centre de la carte rendu par le SDK
 *   extent    — emprise de la vue
 *   communes  — contours INSEE charges
 *   active    — commune selectionnee dans la liste
 *   segments  — segments charges, avec leur pays
 */
function monter(etat) {
  const sdk = {
    Map: {
      getMapCenter: () => etat.centre,
      getMapExtent: () => etat.extent
    },
    DataModel: {
      Segments: {
        getAll: () => (etat.segments || []).map((s, i) => ({ id: i, geometry: s.geometry })),
        getAddress: ({ segmentId }) => ({ country: (etat.segments || [])[segmentId].pays })
      }
    }
  };
  const code = [
    relire('bboxIntersecte'),
    extraire('pointInRing'), extraire('pointInRings'), extraire('pointInGeom'),
    extraire('communeDuPoint'), extraire('detecterPays'),
    'return detecterPays;'
  ].join('\n');
  // ⚠️ `REF` (le referentiel actif) est desormais une dependance de
  //    `detecterPays` : sur commune active, c'est LUI qui dit le pays, au lieu
  //    du « France » qui y etait ecrit en dur. Par defaut la France, comme le
  //    script au demarrage.
  return new Function('sdk', 'communes', 'communeActive', 'REF', code)
    .call(null, sdk, etat.communes || [], etat.active || null,
          etat.ref || { nom: 'France', code: 'FR' });
}

// Gruissan, tel qu'il est en base : un contour cotier. La mer est a l'EST.
const carre = (x0, y0, x1, y1) => ({ type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const GRUISSAN = { code: '11170', nom: 'Gruissan',
  geom: carre(3.05, 43.08, 3.12, 43.15), bbox: [3.05, 43.08, 3.12, 43.15] };
const EN_MER = { lon: 3.30, lat: 43.11 };          // a l'est du contour
const SUR_TERRE = { lon: 3.08, lat: 43.11 };       // dans le contour
const VUE_LARGE = [3.00, 43.00, 3.60, 43.25];      // englobe la commune ET la mer

titre('Le cas GRUISSAN — une commune choisie est francaise, point barre');
verifier('1. commune sélectionnée, centre EN MER, aucun segment chargé ⇒ France',
  monter({ centre: EN_MER, extent: VUE_LARGE, communes: [GRUISSAN], active: GRUISSAN, segments: [] })(),
  { nom: 'France', code: 'FR' });
verifier('2. … même sans emprise lisible (SDK muet)',
  monter({ centre: EN_MER, extent: null, communes: [GRUISSAN], active: GRUISSAN, segments: [] })(),
  { nom: 'France', code: 'FR' });
verifier('3. … et même si la carte est partie ailleurs : l\'analyse porte sur le CONTOUR',
  monter({ centre: { lon: 2.17, lat: 41.38 }, extent: [2.1, 41.3, 2.3, 41.5],
           communes: [GRUISSAN], active: GRUISSAN, segments: [] })(),
  { nom: 'France', code: 'FR' });

titre('La preuve historique (v2.03) reste intacte');
verifier('4. pas de commune choisie, mais le centre tombe dans un contour ⇒ France',
  monter({ centre: SUR_TERRE, extent: VUE_LARGE, communes: [GRUISSAN], active: null, segments: [] })(),
  { nom: 'France', code: 'FR' });
verifier('5. ⚠️ pas de commune choisie, centre EN MER, rien de chargé ⇒ INDÉTERMINÉ',
  monter({ centre: EN_MER, extent: VUE_LARGE, communes: [GRUISSAN], active: null, segments: [] })(),
  null);

titre('⚠️ VERROU : hors de France, rien ne doit passer');
const SEG_ES = { geometry: { type: 'LineString', coordinates: [[2.17, 41.38], [2.18, 41.39]] },
                 pays: { name: 'Spain', abbr: 'SP' } };
verifier('6. Barcelone, aucune commune choisie ⇒ Spain (le blocage joue)',
  monter({ centre: { lon: 2.17, lat: 41.38 }, extent: [2.1, 41.3, 2.3, 41.5],
           communes: [GRUISSAN], active: null, segments: [SEG_ES] })(),
  { nom: 'Spain', code: 'SP' });
verifier('7. ⚠️ des contours FR chargés ne suffisent PAS à se croire en France',
  monter({ centre: { lon: 2.17, lat: 41.38 }, extent: [2.1, 41.3, 2.3, 41.5],
           communes: [GRUISSAN], active: null, segments: [] })(),
  null);
verifier('8. aucun contour, aucun segment ⇒ indéterminé (et non « France » par défaut)',
  monter({ centre: SUR_TERRE, extent: VUE_LARGE, communes: [], active: null, segments: [] })(),
  null);

titre('Le pays MAJORITAIRE des segments de la vue');
const SEG_FR = { geometry: { type: 'LineString', coordinates: [[3.08, 43.11], [3.09, 43.12]] },
                 pays: { name: 'France', abbr: 'FR' } };
verifier('9. deux segments FR contre un ES ⇒ France',
  monter({ centre: EN_MER, extent: VUE_LARGE, communes: [], active: null,
           segments: [SEG_FR, { ...SEG_ES,
             geometry: { type: 'LineString', coordinates: [[3.10, 43.10], [3.11, 43.11]] } }, SEG_FR] })(),
  { nom: 'France', code: 'FR' });
verifier('10. ⚠️ un segment hors de la vue ne compte pas (rémanence après un saut)',
  monter({ centre: EN_MER, extent: [3.00, 43.00, 3.20, 43.20], communes: [], active: null,
           segments: [SEG_ES] })(),        // Barcelone, hors emprise
  null);

titre('⚠️ LA COMMUNE ACTIVE SUIT LE REFERENTIEL, plus « France » en dur');
// Le defaut corrige en v2.40 : ce retour valait { France, FR } quoi qu il
// arrive. Des qu un second pays existe, un editeur italien ayant charge ses
// contours et selectionne une commune recevait « France » — donc les regles
// FRANCAISES appliquees en Italie, sans le moindre signalement.
const COMUNE_IT = { code: '016024', nom: 'Bergamo',
  geom: carre(9.63, 45.67, 9.72, 45.72), bbox: [9.63, 45.67, 9.72, 45.72] };
verifier('27. commune italienne + référentiel IT ⇒ Italie (et NON France)',
  monter({ centre: { lon: 9.90, lat: 45.70 }, extent: [9.5, 45.6, 10.0, 45.8],
           communes: [COMUNE_IT], active: COMUNE_IT,
           ref: { nom: 'Italie', code: 'IT' } })(),
  { nom: 'Italie', code: 'IT' });
verifier('28. … et la France reste la France quand c\'est elle qui sert',
  monter({ centre: EN_MER, extent: VUE_LARGE, communes: [GRUISSAN], active: GRUISSAN,
           ref: { nom: 'France', code: 'FR' } })(),
  { nom: 'France', code: 'FR' });

// ═══════════════════════════════════════════════════════════════════════════
// LA DECISION : ce territoire est-il SERVI ?
//
// ⚠️⚠️ CETTE SECTION MANQUAIT, et son absence rendait le fichier MENTEUR.
// Les 10 verifications ci-dessus n'eprouvent que `detecterPays` — « quel pays
// est sous les yeux ». Aucune ne touchait la fonction qui DECIDE si ce pays
// est servi, alors que le titre du fichier annonce « hors de France, rien ne
// doit passer ».
//
// ⚡ MESURE DU 08/09 : en forcant `estTerritoireFrancais` a rendre `true` en
// toutes circonstances, les 10 verifications restaient VERTES — « Barcelone,
// le blocage joue » compris. Le verrou n'etait pas eprouve, il etait suppose.
// C'est le meme schema que le harnais de `test-cadrage` (26/08).
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ ON EPROUVE `referentielPour`, PAS `estTerritoireFrancais`. Depuis que
// l'Italie existe, la question n'est plus « est-ce la France ? » mais « QUEL
// referentiel sert ce territoire ? ». Un test qui interrogerait encore la
// seule reconnaissance francaise repondrait « Italy ⇒ refuse » — et passerait
// au vert en affirmant le contraire de ce que fait le script.
function monterDecision() {
  const code = [
    relire('normSansAccent'),
    relire('FR_CODES'), relire('FR_NOMS'),
    relire('IT_CODES'), relire('IT_NOMS'),
    extraire('estTerritoireFrancais'), extraire('estTerritoireItalien'),
    // Un REFERENTIELS reduit a ce que `referentielPour` lit : son identite et
    // sa reconnaissance. Les `correspond` sont les VRAIES fonctions extraites.
    'const REFERENTIELS = {' +
    '  FR: { nom: "France", correspond: estTerritoireFrancais },' +
    '  IT: { nom: "Italie", correspond: estTerritoireItalien } };',
    extraire('referentielPour'),
    'return referentielPour;'
  ].join('\n');
  return new Function(code)();
}
const decide = monterDecision();
const sert = v => { const r = decide(v, null); return r && r.nom; };

titre('LA DECISION — quel referentiel sert ce territoire ?');
[['France', 'le nom nu', 'France'], ['FR', 'le code', 'France'],
 ['france', 'la casse', 'France'],
 ['Guadeloupe', 'l\'outre-mer par le nom', 'France'],
 ['GP', 'l\'outre-mer par le code', 'France'],
 ['La Reunion', 'sans accent', 'France'],
 ['Nouvelle-Caledonie', 'le Pacifique', 'France'],
 ['Corse', 'l\'ile', 'France'],
 ['Italy', '⭐ l\'Italie, telle que WME la nomme', 'Italie'],
 ['Italia', 'son nom local', 'Italie'],
 ['Italie', 'son nom francais', 'Italie'],
 ['IT', 'son code', 'Italie']
].forEach(([v, quoi, attendu], i) =>
  verifier((11 + i) + '. ' + quoi + ' : « ' + v + ' » ⇒ ' + attendu, sert(v), attendu));

titre('LA DECISION — tout le reste est refuse');
[['Spain', 'le voisin du sud'], ['ES', 'son code'],
 ['Belgique', 'le voisin du nord'], ['Suisse', 'francophone, mais pas la France'],
 ['San Marino', '⚠️ enclave, mais PAYS distinct chez Waze'],
 ['Vatican City', '⚠️ idem'],
 ['', 'la chaine vide'], [null, 'l\'absence de reponse']
].forEach(([v, quoi], i) =>
  verifier((23 + i) + '. ' + quoi + ' : « ' + v + ' » ⇒ REFUSE', sert(v), null));

titre('⚠️ Le NOM et le CODE sont essayes tous les deux');
verifier('31. nom illisible mais code su ⇒ le referentiel est trouvé',
  (decide(null, 'IT') || {}).nom, 'Italie');
verifier('32. code illisible mais nom su ⇒ de même',
  (decide('France', null) || {}).nom, 'France');

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(60));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
