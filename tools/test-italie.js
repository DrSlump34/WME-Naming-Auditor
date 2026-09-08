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

/** Monte le moteur avec le vocabulaire d'UN pays. */
function monter(suffixe) {
  const n = c => c + suffixe;               // '' => France, '_IT' => Italie
  return new Function([
    relire(n('RE_ROUTE')), relire(n('RE_COMMUNALE')), relire(n('RE_AUTOROUTE')),
    relire(n('RE_NOM_COMPOSITE')),
    'const REF = { reRoute: ' + n('RE_ROUTE') + ', reCommunale: ' + n('RE_COMMUNALE') +
    ', reAutoroute: ' + n('RE_AUTOROUTE') + ', reNomComposite: ' + n('RE_NOM_COMPOSITE') + ' };',
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

console.log(lignes.join('\n'));
console.log('\n' + '='.repeat(60));
console.log('%d verifications OK, %d ECHEC(S)', ok, ko);
process.exit(ko ? 1 : 0);
