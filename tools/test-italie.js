/**
 * REFERENTIEL ITALIE — le logigramme rejoue contre les EXEMPLES DU WIKI.
 *
 * ⭐⭐ CE FICHIER EST UN ETALON, PAS UNE BATTERIE DE CAS INVENTES. Chaque
 * verification reprend un exemple ECRIT dans la Wazeopedia italienne, cite en
 * commentaire avec son numero de sujet Discuss. Si le portage est juste, le
 * moteur doit retrouver ces valeurs-la ; s'il derive, c'est le wiki qui le dit,
 * pas moi.
 *
 * Ce qu'il protege : la these de tout le portage — « le logigramme C/R/H vaut
 * tel quel pour l'Italie, seul le vocabulaire change ». Si un jour cette these
 * devient fausse, c'est ici que ca doit tomber.
 *
 * ⚠️ Les fonctions et les expressions sont EXTRAITES du userscript, jamais
 * recopiees : un test qui reecrirait la regle ne prouverait rien.
 *
 * Usage : node tools/test-italie.js
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
/**
 * Relit une constante dont la valeur est un OBJET.
 * ⚠️ `relire` coupe au premier `;` : sur un objet qui contient du code (comme
 * `DATE_ROMAINE_IT`, dont la methode `test` en compte plusieurs), il rend un
 * fragment tronque et le montage explose. On equilibre donc les accolades.
 */
function relireObjet(nom) {
  const i = src.indexOf('const ' + nom + ' = {');
  if (i < 0) throw new Error('objet introuvable : ' + nom);
  let prof = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (!prof) break; }
  }
  return src.slice(i, j + 1) + ';';
}

/** Monte le moteur avec le vocabulaire d'UN pays. */
function monter(suffixe) {
  const n = c => c + suffixe;               // '' => France, '_IT' => Italie
  return new Function([
    relire(n('RE_ROUTE')), relire(n('RE_COMMUNALE')), relire(n('RE_AUTOROUTE')),
    relire(n('RE_NOM_COMPOSITE')),
    'const REF = { reRoute: ' + n('RE_ROUTE') + ', reCommunale: ' + n('RE_COMMUNALE') +
    ', reAutoroute: ' + n('RE_AUTOROUTE') + ', reNomComposite: ' + n('RE_NOM_COMPOSITE') +
    // ⚠️ Le format du village rattaché est national : parenthèses en France,
    //    virgule + espace en Italie (« nomefrazione, nomecomune »).
    (suffixe === '_IT'
      ? ', reVillageDansVille: /^\\s*(.+?)\\s*,/, formatVillage: (v, c) => v + ", " + c'
      : ', reVillageDansVille: /^\\s*(.+?)\\s*\\(/, formatVillage: (v, c) => v + " (" + c + ")"') +
    ' };',
    relire('isRoute'), relire('isCommunale'), relire('fmt'), relire('key'),
    'const options = { altEnTrop: false };',
    extraire('villeAgglo'), extraire('expectedNaming'),
    'return { expectedNaming, isRoute: e => isRoute(e), REF };'
  ].join('\n'))();
}
const IT = monter('_IT');
const FR = monter('');

let ok = 0, ko = 0;
const lignes = [];
function verifier(titre, obtenu, attendu) {
  const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) { ok++; lignes.push('  ok    ' + titre); }
  else { ko++; lignes.push('  ECHEC ' + titre +
    '\n          attendu ' + JSON.stringify(attendu) +
    '\n          obtenu  ' + JSON.stringify(obtenu)); }
}
function titre(t) { lignes.push('\n' + t); }

const e = x => ({ name: x[0] || '', cityName: x[1] || '',
                  signText: x[2] || '', signType: x[2] ? 1092 : null });
const nam = (p, a) => ({ primary: e(p), primaryId: 100, alts: (a || []).map(e) });
const principal = r => r.primary.name + ' / ' + (r.primary.cityName || 'No city');
const alts = r => r.alts.map(a => a.name + ' / ' + (a.cityName || 'No city'));

// ═══════════════════════════════════════════════════════════════════════════
// 1. LE VOCABULAIRE — un numero de route italien doit etre RECONNU comme tel
// ═══════════════════════════════════════════════════════════════════════════
titre('Le vocabulaire routier italien (376292 : « in maiuscolo e senza spazi »)');
[['A1', true], ['A22', true], ['SS12', true], ['SR31', true], ['SP20bis', true],
 ['SS591var', true], ['SS20dir', true], ['NSA122', true], ['SC6', true],
 ['RA13', true], ['GRA1', true], ['SPexSS12', true]
].forEach(([v, att], i) =>
  verifier((i + 1) + '. « ' + v + ' » est un numéro de route', IT.isRoute(e([v])), att));

titre('⚠️ Ce qui ne doit PAS passer pour un numéro');
[['Via Nazionale', 'un nom de rue'], ['Piazza Garibaldi', 'une place'],
 ['Corso Italia', 'un cours'], ['SS', 'une sigle sans numéro']
].forEach(([v, quoi], i) =>
  verifier((13 + i) + '. ' + quoi + ' : « ' + v + ' »', IT.isRoute(e([v])), false));

titre('⚠️ L\'ESPACE est reconnu — pour être signalé, pas pour être accepté');
verifier('17. « SS 12 » est vu comme un numéro (sinon il passerait pour un nom de rue)',
  IT.isRoute(e(['SS 12'])), true);

titre('⚠️ Les deux vocabulaires sont bien DISJOINTS');
verifier('18. « SS12 » n\'est PAS un numéro pour le référentiel français',
  FR.isRoute(e(['SS12'])), false);
verifier('19. « D26 » n\'est PAS un numéro pour le référentiel italien',
  IT.isRoute(e(['D26'])), false);

// ═══════════════════════════════════════════════════════════════════════════
// 2. FUORI IL CENTRO ABITATO — les exemples ECRITS du wiki (376292)
// ═══════════════════════════════════════════════════════════════════════════
titre('FUORI il centro abitato — la table récapitulative de 376292');

{
  // Wiki, ligne « Strade » : PN « Via Giacomo Puccini / No city »
  //                          AN « Via Giacomo Puccini / San Giuliano Terme »
  const r = IT.expectedNaming(nam(['Via Giacomo Puccini', '']), null, 'San Giuliano Terme');
  verifier('20. rue seule : PN sans ville', principal(r), 'Via Giacomo Puccini / No city');
  verifier('21. ⭐ et la ville passe en ALTERNATIF (la règle italienne)',
    alts(r), ['Via Giacomo Puccini / San Giuliano Terme']);
}
{
  // Wiki, ligne « SS, SR, SPexSS, SP » : PN « SP13 / No city »
  const r = IT.expectedNaming(nam(['SP13', '']), null, 'San Severo');
  verifier('22. numéro seul : PN = la sigle, sans ville', principal(r), 'SP13 / No city');
  verifier('23. … et la commune en alternatif', alts(r), ['SP13 / San Severo']);
}
{
  // Une provinciale qui porte AUSSI un nom local, hors centro abitato :
  // le wiki demande la sigle en PN, et le nom communal en AN avec la commune.
  const r = IT.expectedNaming(nam(['SS42', '', 'SS42']), null, 'Edolo');
  verifier('24. numéro + nom : PN = la sigle', principal(r), 'SS42 / No city');
}
{
  // Wiki, ligne « A » : PN « A22 / No city », AN « A22 del Brennero / No city ».
  // ⭐ L'autoroute ne porte AUCUNE ville, nulle part — règle identique à la France.
  const r = IT.expectedNaming(nam(['A22', 'Trento']), null, 'Trento');
  verifier('25. ⭐ autoroute : aucune ville en principal', principal(r), 'A22 / No city');
  verifier('26. ⭐ autoroute : le cas strict', r.cas, 'A');
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. DENTRO IL CENTRO ABITATO
// ═══════════════════════════════════════════════════════════════════════════
titre('DENTRO il centro abitato — la seconde moitié de la table');
const ZONE = { rattache: false, ville: null };

{
  // Wiki : « esempio di strada locale in un capoluogo comunale :
  //          PN Street → Via Nazionale, City → Roma »
  const r = IT.expectedNaming(nam(['Via Nazionale', 'Roma']), ZONE, 'Roma');
  verifier('27. rue en zone bâtie : PN porte la ville', principal(r), 'Via Nazionale / Roma');
}
{
  // Wiki : « In caso di strada provinciale [...] all'interno di un centro
  //          abitato [...] si deve indicare in AN la sigla della stessa. »
  const r = IT.expectedNaming(nam(['Via Nazionale', 'Edolo'], [['SS42', 'Edolo', 'SS42']]),
                              ZONE, 'Edolo');
  verifier('28. ⭐ le NOM LOCAL en principal, la sigle en alternatif',
    principal(r), 'Via Nazionale / Edolo');
  verifier('29. … et l\'alternatif porte la ville lui aussi',
    alts(r), ['SS42 / Edolo']);
}
{
  // Wiki : « Nel caso la strada [...] non avesse il nome locale, nel PN si
  //          indica solamente la sigla » (PN Street: SS494, City: Corsico).
  const r = IT.expectedNaming(nam(['SS494', 'Corsico', 'SS494']), ZONE, 'Corsico');
  verifier('30. pas de nom local : la sigle en principal, AVEC la ville',
    principal(r), 'SS494 / Corsico');
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. LE NOM ETENDU EST LEGITIME — le piege du portage
// ═══════════════════════════════════════════════════════════════════════════
titre('🔴 Le nom composite est LÉGITIME en Italie (et interdit en France)');
{
  // ⚡ Le risque MESURÉ, pas supposé : l'expression française exige le tiret
  // juste après le numéro, donc « SS42 del Tonale… » lui échappe de toute
  // façon (SS n'est pas dans son vocabulaire). Ce qui tombe vraiment, ce sont
  // les sigles COMMUNES aux deux pays — A et E — suivies d'un tiret. Et le cas
  // n'est pas théorique : « A4 – Bergamo » est la forme officielle des Places
  // d'échangeur, écrite dans 376316.
  const nomEtendu = 'SS42 del Tonale e della Mendola';
  const r = IT.expectedNaming(nam([nomEtendu, 'Edolo']), ZONE, 'Edolo');
  verifier('31. ⭐ le nom étendu traverse le moteur INTACT',
    principal(r), nomEtendu + ' / Edolo');

  const rIt = IT.expectedNaming(nam(['A4 – Bergamo', 'Bergamo']), ZONE, 'Bergamo');
  verifier('32. ⭐ « A4 – Bergamo » (376316) reste INTACT en Italie',
    rIt.primary.name, 'A4 – Bergamo');

  const rFr = FR.expectedNaming(nam(['A4 – Bergamo', 'X']), ZONE, 'X');
  verifier('33. ⚠️ … là où la règle FR l\'ampute — le défaut évité',
    rFr.primary.name, 'Bergamo');

  const rFr2 = FR.expectedNaming(nam(['D980 - Route de Bagnols', 'X']), ZONE, 'X');
  verifier('34. … et la règle FR reste juste chez elle',
    rFr2.primary.name, 'Route de Bagnols');
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 bis. LA FRAZIONE — « nomefrazione, nomecomune » (376277)
// ═══════════════════════════════════════════════════════════════════════════
titre('🔴 Le village rattaché : virgule en Italie, parenthèses en France');
const RATTACHE = { rattache: true, ville: null };
{
  // Wiki 376277 : « Il nome della frazione deve essere indicato nella forma :
  // nomefrazione, nomecomune. » Et 376292 ajoute : « dopo la virgola c'è uno
  // spazio ». L'exemple du wiki est « Miramare, Rimini ».
  const r = IT.expectedNaming(nam(['Viale Regina Margherita', 'Miramare, Rimini']),
                              RATTACHE, 'Rimini');
  verifier('57. ⭐ la frazione s\'écrit « Miramare, Rimini »',
    r.primary.cityName, 'Miramare, Rimini');
}
{
  // ⚠️⚠️ LE DEFAUT EVITE : le format était écrit en dur au format français.
  // La RELECTURE cherchait une parenthèse dans « Miramare, Rimini », n'en
  // trouvait pas, prenait le libellé ENTIER pour le nom du village et
  // composait « Miramare, Rimini (Rimini) ». Une valeur DÉJÀ JUSTE devenait un
  // écart, et sa « correction » l'abîmait.
  const r = IT.expectedNaming(nam(['Viale Regina Margherita', 'Miramare, Rimini']),
                              RATTACHE, 'Rimini');
  verifier('58. ⭐⭐ et surtout PAS « Miramare, Rimini (Rimini) »',
    r.primary.cityName.indexOf('(') === -1, true);
}
{
  const r = FR.expectedNaming(nam(['Rue du Moulin', 'Le Bosquet (Gruissan)']),
                              RATTACHE, 'Gruissan');
  verifier('59. … et la France garde ses parenthèses',
    r.primary.cityName, 'Le Bosquet (Gruissan)');
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. LES FAUTES D'ECRITURE ITALIENNES (`formesInterdites`)
// ═══════════════════════════════════════════════════════════════════════════
function monterForme() {
  return new Function([
    // Le vocabulaire italien, extrait.
    ['RE_ABREV_IT', 'RE_ABREV_SANS_POINT_IT', 'RE_SAINT_IT', 'RE_FONCTION_IT',
     'RE_DIRECTION_IT', 'RE_NOM_COMPOSITE_IT', 'RE_VOIE_LONGUE_IT',
     'RE_BRET_DIRECTION_ROUTE_IT', 'RE_BRET_DOUBLE_NUMERO_IT', 'RE_BRET_FORME_IT',
     // ⚠️ MOIS_IT avant RE_DATE_ROMAINE_IT : la seconde le lit a la construction.
     'RE_SIGLE_ESPACE_IT', 'MOIS_IT', 'RE_DATE_ROMAINE_IT', 'PREFIXE_VOIE_IT',
     'RE_SUFFIXE_ROCADE_IT'].map(relire).join('\n'),
    extraire('romainVersArabe'), extraire('arabeVersRomain'),
    relireObjet('DATE_ROMAINE_IT'),
    extraire('initialeIsolee'), extraire('formatRocade'),
    'const dico = { regles: [] };',
    'function ecartDeRedaction() { return null; }',
    // Le descripteur reduit a ce que `verifierForme` lit.
    'const REF = { reAbrev: RE_ABREV_IT, reAbrevSansPoint: RE_ABREV_SANS_POINT_IT,',
    '  reSaint: RE_SAINT_IT, reFonction: RE_FONCTION_IT, reDirection: RE_DIRECTION_IT,',
    '  reNomComposite: RE_NOM_COMPOSITE_IT, reVoieLongue: RE_VOIE_LONGUE_IT,',
    '  reBretDirectionRoute: RE_BRET_DIRECTION_ROUTE_IT,',
    '  reBretDoubleNumero: RE_BRET_DOUBLE_NUMERO_IT, reBretForme: RE_BRET_FORME_IT,',
    '  prefixeVoie: PREFIXE_VOIE_IT, reSuffixeRocade: RE_SUFFIXE_ROCADE_IT,',
    '  exempleBretelle: "(exemple)",',
    '  formesInterdites: [',
    '    { cle: "sigleEspace", re: RE_SIGLE_ESPACE_IT,',
    '      message: "sans espace",',
    '      corriger: n => n.replace(RE_SIGLE_ESPACE_IT, "$1$2") },',
    '    { cle: "dateRomaine", re: DATE_ROMAINE_IT,',
    '      message: "chiffres arabes",',
    '      corriger: n => n.replace(RE_DATE_ROMAINE_IT, (t, r, mois) => {',
    '        const v = romainVersArabe(r);',
    '        return (v != null && v >= 1 && v <= 31) ? v + " " + mois : t; }) }',
    '  ] };',
    'const options = { controles: { abreviations: true, contractions: true,',
    '  majuscule: true, sigleEspace: true, dateRomaine: true } };',
    extraire('verifierForme'),
    'return verifierForme;'
  ].join('\n'))();
}
const forme = monterForme();
/** Les ecarts de forme d'un nom, en « champ : proposition ». */
const ecartsDe = n => forme(nam([n, 'Roma']), {})
  .map(x => x.champ + ' : ' + x.apres);

titre('Sigles sans espace (376292 : « in maiuscolo e senza spazi »)');
verifier('35. « SS 12 » est signalé ET corrigé',
  ecartsDe('SS 12'), ['sigleEspace : SS12']);
verifier('36. « SP 20bis » de même',
  ecartsDe('SP 20bis'), ['sigleEspace : SP20bis']);
verifier('37. « SS12 » bien écrit ⇒ rien', ecartsDe('SS12'), []);

titre('Dates en chiffres romains (« Via IV Novembre » ⇒ « Via 4 Novembre »)');
verifier('38. l\'exemple même du wiki',
  ecartsDe('Via IV Novembre'), ['dateRomaine : Via 4 Novembre']);
verifier('39. « Via XXV Aprile » ⇒ 25',
  ecartsDe('Via XXV Aprile'), ['dateRomaine : Via 25 Aprile']);
verifier('40. « Via XX Settembre » ⇒ 20',
  ecartsDe('Via XX Settembre'), ['dateRomaine : Via 20 Settembre']);
verifier('41. déjà en arabe ⇒ rien', ecartsDe('Via 4 Novembre'), []);
verifier('42. l\'exception « Via 1º Maggio » ⇒ rien', ecartsDe('Via 1º Maggio'), []);

titre('🔴 LES DEUX PIÈGES — ce qui ne doit SURTOUT pas être touché');
// Le wiki garde les chiffres romains des papes et des rois : seule
// l'apostrophe qu'on leur ajoutait est abrogée.
verifier('43. ⭐ « Viale Papa Giovanni XXIII » reste INTACT (pape, pas une date)',
  ecartsDe('Viale Papa Giovanni XXIII'), []);
verifier('44. ⭐ « Via Vittorio Emanuele II » reste INTACT (roi)',
  ecartsDe('Via Vittorio Emanuele II'), []);
// D et I sont des chiffres romains : une classe [IVXLCDM] naïve aurait lu
// « DI » comme 501 et proposé « Via 501 Maggio ». Un jour de mois tient dans
// I, V et X — d'où la classe restreinte, plus la plage vérifiée en clair.
verifier('45. ⭐⭐ « Via Di Maggio » (un patronyme) reste INTACT',
  ecartsDe('Via Di Maggio'), []);
verifier('46. ⭐ « Via Ivo Maggio » de même', ecartsDe('Via Ivo Maggio'), []);

titre('Les lettres pointées (376292 : « le lettere puntate non vanno scritte »)');
verifier('47. « Via G. Garibaldi » est signalé',
  ecartsDe('Via G. Garibaldi').length > 0, true);
verifier('48. ⭐ « Via Giuseppe Garibaldi » ⇒ rien',
  ecartsDe('Via Giuseppe Garibaldi'), []);
verifier('49. ⭐ « Via Cav. Rossi » ⇒ rien : « Cav. » est ADMISE par le TTS (376274)',
  ecartsDe('Via Cav. Rossi'), []);

titre('La conversion romaine, éprouvée seule');
const rva = new Function(extraire('arabeVersRomain') + '\n' +
                         extraire('romainVersArabe') + '\nreturn romainVersArabe;')();
[['IV', 4], ['XXV', 25], ['XX', 20], ['I', 1], ['XXXI', 31], ['IX', 9]
].forEach(([r, n], i) => verifier((50 + i) + '. « ' + r + ' » = ' + n, rva(r), n));
verifier('56. ⚠️ « IIII » est refusé : mal formé, on ne réécrit pas ce qu\'on lit mal',
  rva('IIII'), null);

// ═══════════════════════════════════════════════════════════════════════════
// 6. LE CODE DE COMMUNE — 5 chiffres en France, 6 en Italie
// ═══════════════════════════════════════════════════════════════════════════
titre('🔴 Le format du code de commune (partage communautaire)');
// Le contrôle valait /^(\d{5}|2[AB]\d{3})$/ pour tout le monde. Un code ISTAT
// en compte SIX. Tout polygone italien partagé aurait été rejeté — et en
// silence, la fonction ne consignant rien en cas de rejet.
// ⚠️ Les expressions sont RELUES dans le descripteur, pas réécrites ici :
//    un test qui recopierait la règle ne prouverait rien.
const blocFR = src.slice(src.indexOf('    FR: {'), src.indexOf('    IT: {'));
const blocIT = src.slice(src.indexOf('    IT: {'));
const reDe = bloc => {
  const m = bloc.match(/reCodeCommune:\s*(\/[^\n,]+\/)/);
  if (!m) throw new Error('reCodeCommune introuvable');
  return eval(m[1]);
};
const codeFR = reDe(blocFR), codeIT = reDe(blocIT);

verifier('60. ⭐ « 016024 » (Bergamo, ISTAT) est accepté en Italie',
  codeIT.test('016024'), true);
verifier('61. ⚠️ … et REFUSÉ par le format français — le défaut évité',
  codeFR.test('016024'), false);
verifier('62. « 11170 » (Gruissan, INSEE) est accepté en France',
  codeFR.test('11170'), true);
verifier('63. « 2A004 » (Corse) est accepté en France',
  codeFR.test('2A004'), true);
verifier('64. ⚠️ un code à 5 chiffres n\'est PAS un code ISTAT',
  codeIT.test('11170'), false);
verifier('65. les zéros de tête sont conservés (« 001272 » = Alessandria)',
  codeIT.test('001272'), true);

// ═══════════════════════════════════════════════════════════════════════════
// 7. « OBBLIGO ACCENSIONE DEI FARI » — la seule règle qui ne porte pas sur le nom
// ═══════════════════════════════════════════════════════════════════════════
titre('Les feux hors centro abitato (376292)');
const feux = new Function([
  relire('ROADTYPE_SANS_ADRESSE'), relire('ROADTYPE_SANS_ADRESSE_TOTALE'),
  'const REF = { typesSansAdresse: ROADTYPE_SANS_ADRESSE,' +
  '  typesSansAdresseTotale: ROADTYPE_SANS_ADRESSE_TOTALE };',
  extraire('verifierFeuxIT'),
  'return verifierFeuxIT;'
].join('\n'))();

// ⚡ La forme de `flagAttributes` est celle RELEVÉE dans WME le 08/09 :
//    un objet de booléens, tous présents, pas un masque de bits.
const segIT = (type, headlights) => ({
  seg: { id: 1, roadType: type, flagAttributes: {
    beacons: false, fwdLanesEnabled: false, fwdSpeedCamera: false,
    headlights: headlights, nearbyHOV: false, revLanesEnabled: false,
    revSpeedCamera: false, tunnel: false, unpaved: false } },
  enAgglo: false
});
const nbFeux = ctx => feux({ primary: {}, alts: [] }, ctx).length;

verifier('66. ⭐ route hors zone bâtie SANS les feux ⇒ signalé', nbFeux(segIT(1, false)), 1);
verifier('67. … AVEC les feux ⇒ rien', nbFeux(segIT(1, true)), 0);
verifier('68. ⭐ DANS le centro abitato ⇒ rien, la règle ne s\'y applique pas',
  nbFeux({ ...segIT(1, false), enAgglo: true }), 0);

titre('⚠️ Ce qui n\'est PAS une « strada extraurbana »');
verifier('69. parking (20) ⇒ rien', nbFeux(segIT(20, false)), 0);
verifier('70. voie privée (17) ⇒ rien', nbFeux(segIT(17, false)), 0);
verifier('71. voie ferrée (18) ⇒ rien', nbFeux(segIT(18, false)), 0);
verifier('72. ferry (15) ⇒ rien', nbFeux(segIT(15, false)), 0);
verifier('73. autoroute (3) ⇒ signalé : c\'est bien une route hors ville',
  nbFeux(segIT(3, false)), 1);

titre('🔴 ABSENT N\'EST PAS FAUX — le piège qui aurait signalé TOUTE la commune');
// `headlights` n'existe NI sur l'objet SDK, NI dans le modèle brut (où les
// drapeaux vivent dans un masque `flags`). Écrire `seg.headlights` aurait rendu
// `undefined` partout — donc « feux manquants » sur chaque segment, avec
// l'aplomb d'un contrôle qui marche.
verifier('74. ⭐⭐ pas de flagAttributes du tout ⇒ on ne conclut RIEN',
  nbFeux({ seg: { id: 1, roadType: 1 }, enAgglo: false }), 0);
verifier('75. ⭐ flagAttributes sans la clé headlights ⇒ rien non plus',
  nbFeux({ seg: { id: 1, roadType: 1, flagAttributes: { tunnel: false } }, enAgglo: false }), 0);
verifier('76. ⚠️ headlights non booléen (undefined) ⇒ rien',
  nbFeux({ seg: { id: 1, roadType: 1, flagAttributes: { headlights: undefined } },
           enAgglo: false }), 0);
verifier('77. aucun contexte ⇒ rien', feux({ primary: {}, alts: [] }, null).length, 0);

// ═══════════════════════════════════════════════════════════════════════════
// 8. LE CHANGEMENT DE PAYS DOIT SE JOUER, PAS SEULEMENT SE DÉCIDER
// ═══════════════════════════════════════════════════════════════════════════
titre('🔴 Basculer de pays initialise les contrôles du NOUVEAU référentiel');
// Mesuré en live à Bergamo le 08/09 : REF basculait bien sur l'Italie, mais
// les options des contrôles italiens n'étaient jamais initialisées — donc
// `undefined`, donc FALSY, donc AUCUN contrôle italien ne s'exécutait. Le
// référentiel était juste et l'interface mentait.
{
  const api = new Function([
    'const options = { controles: {} };',
    'let REF = { controles: [' +
      '{ cle: "nommageZone" }, { cle: "fari" }, { cle: "sigleEspace" },' +
      '{ cle: "dateRomaine" }, { cle: "poiNumero", defaut: false },' +
      '{ cle: "avecFonction", defaut: () => false } ] };',
    extraire('initOptionsControles'),
    'return { options, initOptionsControles };'
  ].join('\n'))();
  api.initOptionsControles();
  verifier('78. ⭐⭐ un contrôle du nouveau pays est ACTIVÉ, pas laissé undefined',
    api.options.controles.fari, true);
  verifier('79. … et les autres aussi',
    [api.options.controles.sigleEspace, api.options.controles.dateRomaine], [true, true]);
  verifier('80. ⚠️ un `defaut: false` reste décoché', api.options.controles.poiNumero, false);
  verifier('81. ⚠️ un `defaut` FONCTION est évalué', api.options.controles.avecFonction, false);
  // Le choix déjà fait par l'éditeur ne doit pas être écrasé au changement de pays.
  api.options.controles.fari = false;
  api.initOptionsControles();
  verifier('82. ⭐ un choix DÉJÀ fait par l\'éditeur survit au rejeu',
    api.options.controles.fari, false);
}

titre('⚠️ `choisirReferentiel` rejoue bien les deux gestes');
const corpsChoisir = src.slice(src.indexOf('function choisirReferentiel'),
                               src.indexOf('function referentielPour'));
verifier('83. ⭐ il initialise les options du nouveau référentiel',
  /initOptionsControles\(\)/.test(corpsChoisir), true);
verifier('84. ⭐ et il repeint la liste des cases',
  /peindreControles\(\)/.test(corpsChoisir), true);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(60));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
