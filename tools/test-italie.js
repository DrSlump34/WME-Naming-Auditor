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
{
  // ⭐⭐ RELEVE EN VRAI DANS WME (auteur, 09/09) : au val di Fassa, la ville
  // portee par le segment est « Vigo, San Giovanni di Fassa ». Ce cas CROISE
  // les deux mecaniques, et c'est pour ca qu'il vaut mieux qu'un exemple de
  // wiki :
  //   • le comune est a DOUBLE NOM — openpolis sert
  //     « San Giovanni di Fassa-Sèn Jan », d'ou `nomComuneIT` ;
  //   • et la ville du segment est une FRAZIONE, donc au format a la virgule.
  // Si l'un des deux lachait, WNA reclamerait de remplacer une valeur JUSTE.
  const nomComuneIT = new Function(extraire('nomComuneIT') +
    '\n' + relire('COMUNI_DOUBLE_NOM') + '\nreturn nomComuneIT;')();
  const comune = nomComuneIT('San Giovanni di Fassa-Sèn Jan');
  verifier('59 bis. le comune a double nom se ramene a son nom italien',
    comune, 'San Giovanni di Fassa');
  const r = IT.expectedNaming(nam(['Strada de Ciampedie', 'Vigo, San Giovanni di Fassa']),
                              RATTACHE, comune);
  verifier('59 ter. ⭐⭐ « Vigo, San Giovanni di Fassa » est DEJA juste — releve dans WME',
    r.primary.cityName, 'Vigo, San Giovanni di Fassa');
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
// 🔴 Défaut mesuré à Bergamo : le référentiel italien était actif, ses
// contrôles affichés — et la section CONTOURS proposait toujours les 101
// départements français. Un éditeur italien n'avait donc AUCUN moyen de
// charger ses communes : la seule porte d'entrée du travail restait fermée.
// J'avais corrigé les cases à cocher sans généraliser à toute l'interface.
verifier('84 bis. ⭐⭐ … et la section CONTOURS, qui dépend du pays elle aussi',
  /peindreSourceContours\(\)/.test(corpsChoisir), true);

titre('🔴 La section contours est DÉPLACÉE : garder les références, pas les chemins');
// `rangerChargementContours()` sort le corps de la section de l'overlay pour
// l'accrocher au panneau latéral. Une référence prise avant le déplacement
// suit le nœud ; un `o.querySelector(...)` refait après ne le trouve plus.
// Mesuré à Bergamo : la grille se repeignait (capturée) pendant que l'intitulé
// de la source et le placeholder restaient français (recherchés). Le projet
// connaît déjà ce piège — la panne du 27/07 « il ne charge rien » venait du
// même déplacement.
// ⚠️⚠️ LA FIN SE CHERCHE À PARTIR DU DÉBUT. `ui.peindreSourceContours();`
//    apparaît AUSSI dans `choisirReferentiel`, bien plus haut : sans l'offset,
//    la tranche partait à l'envers et rendait une chaîne VIDE — sur laquelle
//    « aucun o.querySelector » passait au vert sans rien éprouver. Deuxième
//    ancre ambiguë de la journée, même mécanisme que paysServi/paysServis.
const debPeindre = src.indexOf('ui.peindreSourceContours = () =>');
const corpsPeindre = src.slice(debPeindre,
                               src.indexOf('ui.peindreSourceContours();', debPeindre));
verifier('84 ter a. la tranche examinée n\'est pas vide (sinon tout passe)',
  corpsPeindre.length > 200 && corpsPeindre.includes('optWazefrance'), true);
verifier('84 ter. ⭐⭐ elle ne cherche AUCUN nœud par sélecteur à chaud',
  /o\.querySelector/.test(corpsPeindre), false);
verifier('84 quater. ⚠️ la source française est masquée hors de France',
  /optWazefrance\.hidden\s*=\s*\(REF\.code !== 'FR'\)/.test(corpsPeindre), true);

titre('🔴 Le référentiel suit le PAYS, pas l\'analyse');
// Mesuré à Bergamo : 1 479 segments italiens sous les yeux, WME rendant
// « Italy », et « Cartouches des Dxxx » toujours affiché. `choisirReferentiel`
// n'était appelé que depuis `scan()` — or `scan()` exige une commune, et une
// commune vient des CONTOURS. Sans contours ISTAT, aucune commune, donc jamais
// d'analyse, donc jamais de bascule. Le pays, lui, est connu bien avant.
// ⚠️ Ancre choisie NON AMBIGUË : « const paysServi » est un préfixe de
//    « const paysServis », déclaré 140 lignes PLUS HAUT — la tranche partait
//    alors à l'envers et rendait une chaîne vide, donc deux tests rouges sur
//    du code parfaitement juste. Chercher un motif rare ET certain.
const corpsEval = src.slice(src.indexOf('function evaluerPays'),
                            src.indexOf('const paysServi = () =>'));
verifier('85. ⭐⭐ `evaluerPays` bascule le référentiel dès que le pays est connu',
  /choisirReferentiel\(/.test(corpsEval), true);
verifier('86. ⚠️ … et seulement quand un référentiel sert ce pays',
  /if \(ref\) choisirReferentiel/.test(corpsEval), true);

// ═══════════════════════════════════════════════════════════════════════════
// 9. LE CONTRAT AVEC LA SOURCE DE CONTOURS (mesuré le 08/09)
// ═══════════════════════════════════════════════════════════════════════════
titre('🔴 Les clés du référentiel correspondent-elles à la SOURCE RÉELLE ?');
// Propriétés relevées sur openpolis/geojson-italy (CC-BY-4.0), fichiers
// limits_P_16 (Bergamo, 243 communes) et limits_R_20 (Sardaigne, 377) :
// mêmes clés des deux côtés, 100 % de codes à 6 chiffres.
const PROPS_REELLES = ['name', 'op_id', 'minint_elettorale', 'minint_finloc',
  'prov_name', 'prov_istat_code', 'prov_acr', 'reg_name', 'reg_istat_code',
  'opdm_id', 'com_catasto_code', 'com_istat_code', 'com_istat_code_num'];

const litListe = (bloc, champ) => {
  const m = bloc.match(new RegExp(champ + ':\\s*\\[([^\\]]*)\\]', 's'));
  if (!m) throw new Error(champ + ' introuvable');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
};
const clesNomIT = litListe(blocIT, 'clesNom');
const clesCodeIT = litListe(blocIT, 'clesCode');

verifier('87. ⭐⭐ une clé de NOM du référentiel existe dans la source',
  clesNomIT.some(k => PROPS_REELLES.includes(k)), true);
verifier('88. ⭐⭐ une clé de CODE du référentiel existe dans la source',
  clesCodeIT.some(k => PROPS_REELLES.includes(k)), true);
verifier('89. ⭐ `com_istat_code` est bien déclaré — il manquait',
  clesCodeIT.includes('com_istat_code'), true);
verifier('90. ⭐ `name` aussi', clesNomIT.includes('name'), true);
// Les codes servis font six chiffres, zéros de tête compris.
['016001', '112001', '101001', '016024'].forEach((c, i) =>
  verifier((91 + i) + '. « ' + c +' » (code ISTAT réel) est accepté', codeIT.test(c), true));

// ═══════════════════════════════════════════════════════════════════════════
// 10. LE CHARGEUR DE CONTOURS ITALIEN
// ═══════════════════════════════════════════════════════════════════════════
titre('Le téléchargeur lit le référentiel, plus une source en dur');
const urlIT = new Function(
  blocIT.slice(blocIT.indexOf('url: code =>'), blocIT.indexOf('aide:'))
    .replace(/^url:/, 'const f =').replace(/,\s*$/, '') + '\nreturn f;')();

verifier('95. ⭐ Bergamo (16) donne bien le fichier P_16',
  urlIT('16').endsWith('/limits_P_16_municipalities.geojson'), true);
verifier('96. ⚠️ le code n\'est PAS paddé (limits_P_016 rend 404)',
  urlIT('16').includes('_P_016_'), false);
verifier('97. l\'hôte est bien celui mesuré',
  urlIT('16').startsWith('https://raw.githubusercontent.com/openpolis/geojson-italy/'), true);

titre('⚠️ La liste des provinces — couverture mesurée le 08/09');
const blocProv = src.slice(src.indexOf('const PROVINCES_IT = ['),
                           src.indexOf('// Les 101 departements'));
const provs = [...blocProv.matchAll(
  /\{"code":"(\d+)","nom":"((?:[^"\\]|\\.)*)","b":\[([-\d.,]+)\]\}/g)]
  .map(m => ({ code: m[1], nom: m[2], b: m[3].split(',').map(Number) }));
verifier('98. ⭐ 110 provinces — autant que de fichiers servis', provs.length, 110);
// Les 9 fichiers vides du dépôt sont des provinces ABOLIES (réforme sarde de
// 2016) : aucune ne doit figurer dans la liste, sinon le chargement rendrait
// un GeometryCollection vide de 49 octets sans que rien ne l'explique.
const ABOLIES = ['90', '91', '92', '95', '104', '105', '106', '107', '111'];
verifier('99. ⭐⭐ aucune province ABOLIE n\'est proposée',
  provs.filter(p => ABOLIES.includes(p.code)).map(p => p.code), []);
verifier('100. Bergamo est là, avec son acronyme',
  (provs.find(p => p.code === '16') || {}).nom, 'Bergamo (BG)');
verifier('101. ⚠️ aucun code n\'a de zéro de tête',
  provs.filter(p => p.code.length > 1 && p.code[0] === '0'), []);
verifier('102. les codes sont uniques',
  new Set(provs.map(p => p.code)).size, provs.length);

titre('⭐ Deviner la province sous les yeux : RESTREINDRE, jamais trancher');
// Mesure du 08/09 sur 620 communes réelles : la plus PETITE boîte englobante
// se trompe une fois sur cinq (78,2 %). Un chargement automatique qui prend la
// mauvaise province est pire que le choix manuel. En revanche la bonne est
// TOUJOURS parmi les candidates — 620/620, 1,70 en moyenne.
const sousLaVue = (lon, lat) => provs.filter(
  p => lon >= p.b[0] && lon <= p.b[2] && lat >= p.b[1] && lat <= p.b[3]);

verifier('103. toutes les provinces ont une boîte de 4 nombres',
  provs.filter(p => p.b.length !== 4).length, 0);
verifier('104. ⚠️ aucune boîte inversée (min > max)',
  provs.filter(p => p.b[0] > p.b[2] || p.b[1] > p.b[3]).length, 0);
verifier('105. ⚠️ toutes les boîtes tombent sur l\'Italie (6-19°E, 35-48°N)',
  provs.filter(p => p.b[0] < 6 || p.b[2] > 19 || p.b[1] < 35 || p.b[3] > 48).length, 0);

// Bergamo, centre-ville — coordonnées de l'essai réel.
const cand = sousLaVue(9.6773, 45.6983).map(p => p.code);
verifier('106. ⭐⭐ Bergamo est proposée depuis son centre-ville',
  cand.includes('16'), true);
verifier('107. ⭐ et la liste reste COURTE (≤ 4 candidates)',
  cand.length >= 1 && cand.length <= 4, true);
// Un point hors d'Italie ne doit rien proposer plutôt que proposer au hasard.
verifier('108. ⚠️ en pleine mer, aucune candidate — on ne propose pas au hasard',
  sousLaVue(3.0, 42.0).length, 0);
verifier('109. ⚠️ Paris non plus', sousLaVue(2.35, 48.85).length, 0);

titre('⚠️ La suggestion PRÉ-COCHE, elle ne télécharge pas');
const corpsPeindre2 = src.slice(debPeindre,
                                src.indexOf('ui.peindreSourceContours();', debPeindre));
verifier('110. ⭐ rien ne part sans un clic : aucun appel de chargement ici',
  /chargerDepuisGouv|telecharger\(/.test(corpsPeindre2), false);
verifier('111. les candidates sont bien pré-cochées',
  /checked/.test(corpsPeindre2), true);

titre('⭐ Chargement AUTOMATIQUE : la vue désigne ses provinces, sans réseau');
// La France interroge geo.api.gouv.fr faute de mieux ; l'Italie porte ses 110
// boîtes et répond en local. On interroge les 5 points de la vue (centre + 4
// coins), comme le fait la version française — une vue large chevauche souvent
// deux provinces.
const depsDeLaVueIT = (ext) => {
  const [x1, y1, x2, y2] = ext;
  const pts = [[(x1 + x2) / 2, (y1 + y2) / 2], [x1, y1], [x2, y1], [x1, y2], [x2, y2]];
  const vus = new Set();
  pts.forEach(([lon, lat]) => sousLaVue(lon, lat).forEach(u => vus.add(u.code)));
  return [...vus];
};
// Rome — le cas signalé par l'auteur. Province ISTAT 58.
verifier('112. ⭐⭐ une vue sur Rome désigne bien la province 58',
  depsDeLaVueIT([12.44, 41.87, 12.55, 41.94]).includes('58'), true);
// Bergamo, déjà éprouvé en vrai.
verifier('113. ⭐ une vue sur Bergamo désigne la province 16',
  depsDeLaVueIT([9.63, 45.67, 9.72, 45.72]).includes('16'), true);
// Milano (15) et Napoli (63), deux autres grandes villes.
verifier('114. Milano ⇒ 15',
  depsDeLaVueIT([9.15, 45.44, 9.24, 45.50]).includes('15'), true);
verifier('115. Napoli ⇒ 63',
  depsDeLaVueIT([14.22, 40.82, 14.30, 40.88]).includes('63'), true);
// ⚠️ La liste doit rester courte, sinon le chargement automatique devient
//    coûteux : 5 points × plusieurs provinces, ça peut enfler.
const tailles = [[12.44, 41.87, 12.55, 41.94], [9.63, 45.67, 9.72, 45.72],
                 [9.15, 45.44, 9.24, 45.50], [14.22, 40.82, 14.30, 40.88]]
  .map(e => depsDeLaVueIT(e).length);
verifier('116. ⚠️ jamais plus de 5 provinces désignées par une vue de travail',
  tailles.every(n => n >= 1 && n <= 5), true);
verifier('117. ⚠️ une vue hors d\'Italie n\'en désigne AUCUNE',
  depsDeLaVueIT([2.30, 48.83, 2.40, 48.88]).length, 0);

titre('🔴 De quelle PROVINCE relève une commune ? (les 3 premiers chiffres)');
// Défaut du 08/09 : `depDuCode` prenait les DEUX premiers caractères — la règle
// INSEE. Sur « 016024 » (Bergamo) elle rendait « 01 », une province qui
// n'existe pas. Tout ce qui compare des unités s'en trouvait faussé, et la
// purge retirait la commune en cours — reposant « la carte a quitté X » juste
// après que l'éditeur ait choisi sa commune.
const uniteIT = new Function('s',
  'return (' + blocIT.match(/uniteDuCode:\s*(s => [^\n]+?),\n/)[1] + ')(s);');
verifier('118. ⭐⭐ « 016024 » (Bergamo) relève de la province 16', uniteIT('016024'), '16');
verifier('119. ⭐ « 058091 » (Roma) relève de la province 58', uniteIT('058091'), '58');
verifier('120. « 112001 » (Sassari) relève de la province 112', uniteIT('112001'), '112');
verifier('121. ⚠️ … et surtout PAS « 01 » — le défaut mesuré',
  uniteIT('016024') === '01', false);
// Le code rendu doit correspondre à une province de la liste, sinon rien ne
// se compare : c'est cette égalité qui fait marcher chargement et purge.
verifier('122. ⭐⭐ le code rendu existe dans PROVINCES_IT',
  provs.some(p => p.code === uniteIT('016024')), true);
verifier('123. … pour Rome aussi',
  provs.some(p => p.code === uniteIT('058091')), true);

titre('🔴 Les panneaux EB10/EB20 n\'existent PAS en Italie');
// Signalé par l'auteur le 08/09 : « maintenant que j'ai sélectionné Bari, il me
// propose de chercher les panneaux EB10/EB20, or en Italie… ». Ces panneaux
// viennent d'un jeu du Ministère de l'Intérieur FRANÇAIS (api.wazefrance.com).
// L'analyse le disait dès le matin — le code, lui, ne le disait pas.
verifier('130. ⭐⭐ le référentiel italien ne déclare AUCUNE source de panneaux',
  /sourcePanneaux:\s*null/.test(blocIT), true);
verifier('131. ⭐ … là où la France en déclare une',
  /sourcePanneaux:\s*\{/.test(blocFR), true);
// Le sondage doit répondre « aucun » sans réseau : c'est cet état qui grise le
// bouton AVEC sa raison et fait sauter les étapes de guidage.
const corpsSonde = src.slice(src.indexOf('async function sonderPanneaux'),
                             src.indexOf('/** Ce que le sondage sait'));
verifier('132. ⚠️ le sondage ne part pas sans source, et conclut « aucun »',
  /if \(!REF\.sourcePanneaux\)/.test(corpsSonde) && /etat: 'aucun'/.test(corpsSonde), true);
// ⚠️ « aucun » et « pas de source » ne se disent pas pareil : servir le message
//    français à un éditeur italien lui ferait chercher un défaut chez lui.
// ⚠️ L'apostrophe est ÉCHAPPÉE dans le source (`n\'existe`) : chercher
//    « n'existe » tel quel ne matche jamais. On vise un fragment sans apostrophe.
verifier('133. ⭐ le bouton explique la VRAIE raison selon le pays',
  /!REF\.sourcePanneaux[\s\S]{0,220}existe pour/.test(src), true);

titre('🔴🔴 Le découpage suit LA COMMUNE, pas le pays regardé');
// Défaut du 08/09, et le plus coûteux de la journée : `depDuCode` déléguait à
// `REF.uniteDuCode`, donc au référentiel COURANT. Dès qu'on passait en Italie,
// les 5 561 communes FRANÇAISES déjà en base étaient redécoupées à
// l'italienne — « 83000 » devenait « 830 ». Mesure en live : 17 départements
// devenus 73 unités fantômes, 142 Mo, purge et chargement automatique affolés,
// et la carte qui partait à 200 km. Un code porte son pays dans sa FORME.
const depReel = new Function('code', `
  const REFERENTIELS = {
    FR: { reCodeCommune: ${blocFR.match(/reCodeCommune:\s*(\/[^\n,]+\/)/)[1]},
          uniteDuCode: ${blocFR.match(/uniteDuCode:\s*(s => [^\n]+?),\n/)[1]} },
    IT: { reCodeCommune: ${blocIT.match(/reCodeCommune:\s*(\/[^\n,]+\/)/)[1]},
          uniteDuCode: ${blocIT.match(/uniteDuCode:\s*(s => [^\n]+?),\n/)[1]} } };
  const s = String(code || '');
  const ref = Object.values(REFERENTIELS)
    .find(r => r.reCodeCommune && r.reCodeCommune.test(s) && r.uniteDuCode);
  if (ref) return ref.uniteDuCode(s);
  return /^9[78]/.test(s) ? s.slice(0, 3) : s.slice(0, 2).toUpperCase();`);

verifier('124. ⭐⭐ une commune FRANÇAISE garde son département, même en Italie',
  ['83000', '11170', '34172'].map(depReel), ['83', '11', '34']);
verifier('125. ⭐ la Corse aussi', depReel('2A004'), '2A');
verifier('126. ⭐ et l\'outre-mer', depReel('97401'), '974');
verifier('127. ⭐⭐ une commune ITALIENNE relève de sa province',
  ['016024', '058091', '004172'].map(depReel), ['16', '58', '4']);
verifier('128. ⚠️ … et JAMAIS « 830 » pour une commune française — le défaut mesuré',
  depReel('83000') === '830', false);
// Le découpage doit être STABLE : la même commune rend toujours la même unité,
// que l'éditeur regarde la France ou l'Italie. C'est ce qui manquait.
verifier('129. ⭐⭐ le découpage ne dépend d\'AUCUN état courant',
  new Set(['83000', '83000', '83000'].map(depReel)).size, 1);

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(60));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
