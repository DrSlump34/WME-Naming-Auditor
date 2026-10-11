#!/usr/bin/env node
/**
 * PLAFOND DES ÉDITIONS SCRIPTÉES (2.52.00) — doctrine France des scripts, § 3.3.
 *
 * « Tout lot hors fermetures et notes de carte est plafonné à 150 éditions scriptées par heure
 * glissante, compté à l'enregistrement, quota affiché, non modifiable par réglage. »
 * Modèle repris de WME BAN Coverage (`quotaHn`, bloc ==WBC-QUOTA==).
 *
 * Ce banc extrait le code RÉEL du userscript (bloc des droits + ==WNA-QUOTA== + rapprochement +
 * affichage, puis `appliquerCorrection`) et le joue sur un monde simulé :
 *   A. le cœur : 150 par heure glissante, l'heure de reprise ;
 *   B. l'auto-test : un cœur ou une sonde retouchés éteignent le ⚡ ;
 *   C. le stockage : scellé, brouillé, en trois copies — retouché ⇒ bloqué une heure ;
 *   D. le rapprochement après enregistrement : retrouvé ⇒ compté, annulé ⇒ rendu, doute ⇒ gardé ;
 *   E. ce que coûte une correction, et le refus AVANT toute écriture quand il ne reste pas assez ;
 *   F. l'affichage : ⚡ grisés avec l'heure de reprise ;
 *   G. le branchement sur `wme-save-finished` et sur la série du ⚡ de groupe.
 * ⭐ TÉMOINS : chaque garde est retiré du source, et le banc exige alors l'ÉCHEC de l'assertion.
 *
 * Usage : node tools/test-quota.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'WME-Naming-Auditor.user.js'), 'utf8');

let ok = 0, ko = 0;
const dit = (b, quoi, d) => { console.log('  ' + (b ? 'ok  ' : 'KO  ') + ' ' + quoi + (d !== undefined ? '   ' + d : '')); b ? ok++ : ko++; };
const temoin = (assertionTientEncore, quoi) => dit(!assertionTientEncore, 'TÉMOIN — ' + quoi + ' : l\'assertion ÉCHOUE sur le source muté');

function entre(src, debut, fin) {
  const i = src.indexOf(debut), j = src.indexOf(fin, i);
  if (i < 0 || j < 0) throw new Error('bloc introuvable : ' + debut.slice(0, 40));
  return src.slice(i, j);
}
function extraire(src, entete) {
  const i = src.indexOf(entete);
  if (i < 0) throw new Error('fonction introuvable : ' + entete);
  let prof = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') prof++; else if (src[j] === '}') { prof--; if (!prof) break; } }
  return src.slice(i, j + 1);
}

/** Monte le bloc des droits + le quota sur un monde simulé. */
function monter(src, monde) {
  monde = monde || {};
  const code = entre(src, '  const _fx = t =>', '  /**\n   * Contexte administratif d\'un segment');
  const stock = monde.stock || new Map(), gm = monde.gm || new Map();
  const localStorage = {
    getItem: k => stock.has(k) ? stock.get(k) : null,
    setItem: (k, v) => stock.set(k, String(v)),
    removeItem: k => stock.delete(k),
  };
  const sdk = monde.sdk || { State: { getUserInfo: () => ({ rank: 5, userName: monde.pseudo === undefined ? 'Testeur' : monde.pseudo }) } };
  const hote = { W: { loginManager: { user: { attributes: { rank: 5 } } } },
                 fetch: async () => ({ ok: false }) };
  const ui = monde.ui || {};
  const document = { getElementById: () => null };
  const f = new Function('sdk', 'hote', 'log', 'readNaming', 'tr', 'trf', 'localStorage', 'GM_getValue', 'GM_setValue',
    'ui', 'document', 'LANGUE',
    code + '\nreturn { quotaEditions, _fc, _fk, _fs, quotaCourant, reserverEditions, rapprocherEditions, etatEdition,' +
    ' lireEditions, ecrireEditions, quotaUtilisateur, texteQuota, majQuotaAffiche, _qn, droits };');
  const tr = x => x, trf = (x, v) => x.replace(/\{(\w+)\}/g, (m, k) => v && v[k] != null ? String(v[k]) : m);
  const api = f(sdk, hote, () => {}, monde.readNaming || (() => null), tr, trf, localStorage,
    (k, d) => gm.has(k) ? gm.get(k) : d, (k, v) => gm.set(k, v), ui, document, 'fr');
  return Object.assign(api, { stock, gm });
}

const H = 3600 * 1000;

(async () => {

console.log('\n=== A. Le cœur : 150 éditions par heure glissante ===\n');
{
  const a = monter(SRC);
  const m = Date.now(), pl = n => Array.from({ length: n }, () => m);
  dit(a.quotaEditions([], m).reste === 150, 'aucune édition : 150 restantes');
  dit(a.quotaEditions([], m).max === 150, 'le plafond affiché est 150');
  dit(a.quotaEditions(pl(149), m).reste === 1, '149 éditions : 1 restante');
  dit(a.quotaEditions(pl(150), m).reste === 0, '150 éditions : plus rien');
  dit(a.quotaEditions(pl(200), m).reste === 0, '200 (copies réunies) : jamais négatif');
  dit(a.quotaEditions([m - H + 6e4], m).utilises === 1, 'une édition d\'il y a 59 min compte encore');
  dit(a.quotaEditions([m - H - 6e4], m).utilises === 0, 'une édition d\'il y a 61 min ne compte plus');
  const vieux = m - 40 * 6e4;
  const l = [vieux].concat(pl(149));
  dit(a.quotaEditions(l, m).libre === vieux + H, 'heure de reprise = la plus ancienne + 1 h', new Date(a.quotaEditions(l, m).libre).toISOString());
  // Les entrées objets (format réel) comptent comme les horodatages bruts.
  dit(a.quotaEditions([{ t: m, o: 's', id: '1', e: 0 }, { t: m, o: 's', id: '2', e: 1 }], m).utilises === 2,
    'réservées ET comptées occupent le quota');
}

console.log('\n=== B. L\'auto-test : un cœur ou une sonde retouchés éteignent le ⚡ ===\n');
{
  const a = monter(SRC);
  dit(a._fc() === true, 'auto-test intact : vrai');
  dit(a.droits().autorise === true, 'un L6 est autorisé (le plafond fait partie du droit)');
  dit(a._fk[0] === 0x96 && a._fk[1] === 0x36ee80 && /const _fk = \[0x96, 0x36ee80\];/.test(SRC),
    'les constantes sont écrites en hexadécimal (150, 3 600 000 ms)');
  dit(!/\b150\b/.test(entre(SRC, '  function quotaEditions(', '  const _fk')) && !/3600000|3600 \* 1000/.test(entre(SRC, '  function quotaEditions(', '  const _fk')),
    'le cœur ne porte ni 150 ni 3 600 000 en clair');
  // Mutation : le cœur passe à 151 ⇒ l'auto-test le voit et le quota tombe à ZÉRO, pas à 151.
  const mut = SRC.replace('const m = 0x96, f = 0x36ee80;', 'const m = 0x97, f = 0x36ee80;');
  dit(mut !== SRC, 'mutation du cœur trouvée');
  const b = monter(mut);
  dit(b._fc() === false && b.quotaCourant().reste === 0 && b.quotaCourant().bloque === true,
    'cœur à 151 ⇒ auto-test faux ⇒ AUCUNE place (pas 151)', JSON.stringify(b.quotaCourant()));
  dit(b.droits().autorise === false, 'cœur à 151 ⇒ ⚡ refusé au L6');
  const mut2 = SRC.replace('const _fk = [0x96, 0x36ee80];', 'const _fk = [0x97, 0x36ee80];');
  dit(monter(mut2)._fc() === false, 'sonde seule retouchée ⇒ auto-test faux');
  const mut3 = SRC.replace('const _fs = 0x357f5257;', 'const _fs = 0x357f5258;');
  dit(monter(mut3)._fc() === false, 'somme XOR retouchée ⇒ auto-test faux');
  // TÉMOIN : sans `|| !_fc()` dans quotaCourant, le cœur à 151 donnerait UNE place de trop.
  const mutT = mut.replace('if (!u || !_fc()) return', 'if (!u) return');
  dit(mutT !== mut, 'mutation du garde de quotaCourant trouvée');
  const c = monter(mutT);
  for (let i = 0; i < 150; i++) c.reserverEditions([{ o: 's', id: i, x: null }]);
  temoin(c.quotaCourant().reste === 0, 'garde `_fc` retiré, cœur à 151');
}

console.log('\n=== C. Le stockage : scellé, brouillé, trois copies ===\n');
{
  const a = monter(SRC);
  a.reserverEditions([{ o: 's', id: 4242, x: { seg: 4242, nom: 'Rue Secrète', ville: 'Uzès' } }]);
  const cle = a._qn('Testeur');
  const v = a.stock.get(cle);
  dit(typeof v === 'string' && /^w2\.[0-9a-z]+\./.test(v), 'copie localStorage scellée (w2.<sceau>.<données>)');
  dit(!/Testeur|Secr|4242/.test(cle + v), 'ni le pseudo ni le contenu ne se lisent en clair');
  dit(a.gm.get(cle) === v, 'deuxième copie dans le stockage de Tampermonkey');
  dit(a.quotaCourant().reste === 149, 'une édition réservée : 149 restantes');
  // Effacer localStorage ne rend rien (copie GM + mémoire).
  a.stock.clear();
  dit(a.quotaCourant().reste === 149, 'localStorage effacé : toujours 149');
  // Une page neuve (mémoire vide) relit la copie GM.
  const b = monter(SRC, { gm: a.gm });
  dit(b.quotaCourant().reste === 149, 'nouvelle page, localStorage vide : la copie GM tient');
  // Copie retouchée ⇒ bloqué une heure.
  const retouchee = v.replace(/.$/, c => c === "A" ? "B" : "A");
  const st = new Map([[cle, retouchee]]);
  const d = monter(SRC, { stock: st });
  const q = d.quotaCourant();
  dit(q.reste === 0 && q.libre > Date.now() + H - 6e4, 'copie retouchée ⇒ ⚡ bloqué une heure', JSON.stringify({ reste: q.reste }));
  // Un autre éditeur a son propre quota.
  const e = monter(SRC, { pseudo: 'Autre', stock: a.stock, gm: a.gm });
  dit(e.quotaCourant().reste === 150, 'un autre éditeur : quota plein, séparé');
  // Sans pseudo lisible : aucune place, et on le dit.
  const f = monter(SRC, { pseudo: '' });
  dit(f.quotaCourant().reste === 0 && f.quotaCourant().bloque === true, 'pseudo illisible : aucune place');
  dit(/introuvable/.test(f.texteQuota()), 'pseudo illisible : le message le dit', f.texteQuota());
  // TÉMOIN : sans le blocage d'une copie retouchée, la retouche rendrait le quota.
  const mut = SRC.replace('if (l === false) faux = true; else if (l) listes.push(l);', 'if (l) listes.push(l);');
  dit(mut !== SRC, 'mutation du blocage trouvée');
  temoin(monter(mut, { stock: new Map([[cle, retouchee]]) }).quotaCourant().reste === 0, 'blocage d\'une copie retouchée retiré');
}

console.log('\n=== D. Après l\'enregistrement : compté, rendu ou gardé ===\n');
{
  // Le monde : le segment 1 porte « Rue de la Gare / Coursan » (l'écriture est partie), le 2 est
  // revenu à « Rue de la Grae » (Ctrl+Z avant d'enregistrer), le 3 n'est plus chargé.
  const nommages = {
    1: { primary: { name: 'Rue de la Gare', cityName: 'Coursan' }, alts: [] },
    2: { primary: { name: 'Rue de la Grae', cityName: 'Coursan' }, alts: [] },
    4: { primary: { name: 'Chemin X', cityName: '' }, alts: [{ name: 'D26', cityName: '' }] },
  };
  const readNaming = s => { if (!nommages[s.id]) throw new Error('DataModelNotFoundError'); return nommages[s.id]; };
  const a = monter(SRC, { readNaming });
  const X = (seg, extra) => Object.assign({ seg, nom: 'Rue de la Gare', ville: 'Coursan', alts: [] }, extra || {});
  a.reserverEditions([{ o: 's', id: 1, x: X(1) }, { o: 's', id: 2, x: X(2) }, { o: 's', id: 3, x: X(3) },
                      { o: 's', id: 4, x: { seg: 4, alts: [{ nom: 'D26', ville: '' }] } }]);
  dit(a.quotaCourant().reste === 146, '4 éditions réservées : 146 restantes');
  dit(a.etatEdition({ o: 's', x: X(1) }) === 'ok', 'segment qui porte le nom écrit : retrouvé');
  dit(a.etatEdition({ o: 's', x: X(2) }) === 'absent', 'segment revenu en arrière : annulé');
  dit(a.etatEdition({ o: 's', x: X(3) }) === null, 'segment introuvable : on ne tranche pas');
  dit(a.etatEdition({ o: 's', x: { seg: 4, alts: [{ nom: 'D26', ville: '' }] } }) === 'ok', 'alternatif retrouvé');
  const res = a.rapprocherEditions(a.lireEditions('Testeur'), x => a.etatEdition(x));
  dit(res.comptes.length === 2 && res.rendus.length === 1 && res.entrees.length === 3,
    'rapprochement : 2 comptées, 1 rendue, 1 gardée', JSON.stringify({ c: res.comptes.length, r: res.rendus.length, g: res.entrees.length }));
  a.ecrireEditions('Testeur', res.entrees);
  dit(a.quotaCourant().reste === 147, 'l\'édition annulée est RENDUE au quota (147)');
  dit(res.entrees.filter(x => x.e === 1).length === 2, 'les retrouvées passent « comptées »');
  // Une entrée déjà comptée n'est jamais remise en cause.
  const res2 = a.rapprocherEditions(res.entrees, () => 'absent');
  dit(res2.entrees.filter(x => x.e === 1).length === 2, 'une entrée comptée n\'est plus jamais rendue');
  // TÉMOIN : un rapprochement qui rend sur un DOUTE rendrait des places à tort.
  const mut = SRC.replace("else if (st === 'absent') rendus.push(x);", "else if (st !== 'ok') rendus.push(x);");
  dit(mut !== SRC, 'mutation du rapprochement trouvée');
  const b = monter(mut, { readNaming });
  const r3 = b.rapprocherEditions([{ t: Date.now(), o: 's', id: '3', x: X(3), e: 0 }], x => b.etatEdition(x));
  temoin(r3.rendus.length === 0, 'rendre sur un doute');
}

console.log('\n=== E. Le coût d\'une correction, et le refus AVANT toute écriture ===\n');
{
  const prev = new Function(extraire(SRC, 'function editionsPrevues(') + '\nreturn editionsPrevues;')();
  const P = t => ({ type: t });
  dit(prev({ segIds: [1, 2, 3] }, [P('principal')]) === 3, 'renommer 3 segments : 3 éditions');
  dit(prev({ segIds: [1, 2, 3], verrouilles: 1 }, [P('principal')]) === 2, '… dont 1 verrouillé : 2');
  dit(prev({ segIds: [1] }, [P('principal'), P('alt')]) === 3, 'principal + alternatif sur 1 segment : au plus 3 (segment, rue créée, écusson reporté)');
  dit(prev({ segIds: [1, 2], cartouche: {} }, [P('cartouchePrincipal')]) === 1, 'cartouche sur la rue : 1');
  dit(prev({ adresse: true }, [P('hn2poi')]) === 2, 'conversion numéro → RPP : 2 (RPP créé, numéro retiré)');
  dit(prev({ poi: true }, [P('poiAdresse')]) === 1, 'adresse d\'un POI : 1');

  // appliquerCorrection réel, monde simulé (même harnais que test-ecriture-preparee.js).
  const monterAC = (src, reste) => {
    const code = [extraire(src, 'async function appliquerCorrection('), extraire(src, 'function preparerEcriture('),
      extraire(src, 'function resoudreStreet('), extraire(src, 'function editionsPrevues('), 'return appliquerCorrection;'].join('\n');
    const monde = { ecritures: [], reserves: [] };
    const sdk = { DataModel: {
      Segments: {
        getAddress: () => ({ state: { id: 7 }, country: { id: 73 }, city: { name: 'Coursan', isEmpty: false } }),
        updateAddress: a => monde.ecritures.push(['principal', a.segmentId]),
        addAlternateStreet: a => monde.ecritures.push(['alt', a.streetId]) },
      Cities: { getCity: ({ cityName }) => cityName === 'Coursan' ? { id: 'c' } : null },
      Streets: { getStreet: () => null, addStreet: ({ streetName }) => ({ id: -5, name: streetName }) } } };
    const plan = [{ type: 'principal', nom: 'Rue de la Gare', ville: 'Coursan' }, { type: 'alt', nom: 'D26', ville: 'Coursan' }];
    const fn = new Function('evaluerPays', 'pays', 'planDeCorrection', 'segmentsEditables', 'sdk',
      'readNaming', 'cartoucheAReprendre', 'cartoucheDeStreet', 'ecrireCartouche',
      'villeVide', 'log', 'progEnCours', 'cadrerSur', 'demanderNomPrincipal',
      'quotaCourant', 'refusQuota', 'reserverEditions', 'rueHorsDroits', 'tr', 'trf', code)(
      () => ({ etat: 'servi' }), {}, () => plan, ids => ids.slice(), sdk,
      () => ({ primary: { name: 'D26', cityName: '' }, alts: [] }), () => null, () => null, () => true,
      () => ({ id: 0, isEmpty: true }), () => {}, null, () => {}, async () => null,
      () => ({ reste, max: 150, libre: Date.now() }), (q, b) => ({ ok: false, quota: true, motif: 'quota ' + b }),
      l => monde.reserves.push(...l), () => null, x => x, x => x);
    return { fn, monde };
  };
  const F = { segIds: [1, 2], libelle: 'x' };
  {
    const { fn, monde } = monterAC(SRC, 10);
    const r = await (fn(F));
    dit(r.ok === true, 'quota suffisant : la correction passe');
    dit(monde.reserves.map(x => x.o).sort().join(',') === 'r,s,s',
      'réservé : 2 segments modifiés (une entrée chacun, nom + alternatif) + 1 rue créée', monde.reserves.map(x => x.o + ':' + x.id).join(' '));
    const s1 = monde.reserves.find(x => x.o === 's' && x.id === 1);
    dit(s1 && s1.x.nom === 'Rue de la Gare' && s1.x.ville === 'Coursan' && s1.x.alts[0].nom === 'D26',
      'l\'entrée garde ce qu\'il faudra retrouver après l\'enregistrement');
  }
  let refusOk;
  {
    const { fn, monde } = monterAC(SRC, 3);   // besoin : 2 segments + 2 (alt) = 4 > 3
    const r = await (fn(F));
    refusOk = r.ok === false && r.quota === true && monde.ecritures.length === 0 && monde.reserves.length === 0;
    dit(refusOk, 'quota insuffisant (3 < 4) : REFUS, et RIEN n\'est écrit ni réservé', JSON.stringify(r));
  }
  // TÉMOIN : sans le contrôle préalable, la correction écrirait au-delà du quota.
  const mut = SRC.replace('if (qAvant.reste < besoin) return refusQuota(qAvant, besoin);', '');
  dit(mut !== SRC, 'mutation du contrôle préalable trouvée');
  {
    const { fn, monde } = monterAC(mut, 3);
    const r = await (fn(F));
    temoin(r.ok === false && r.quota === true && monde.ecritures.length === 0, 'contrôle préalable retiré');
  }
}

console.log('\n=== F. L\'affichage : ⚡ grisés, heure de reprise ===\n');
{
  const bouton = t => ({ disabled: false, title: t, dataset: { agnTitre: t }, classList: { toggle() {} } });
  const b1 = bouton('Appliquer la correction (sans enregistrer)'), b2 = bouton('groupe');
  const span = { textContent: '', title: '', classList: { v: false, toggle(c, x) { this.v = x; } } };
  const ui = { results: { querySelectorAll: sel => sel.includes('agn-quota') ? [span] : [b1, b2] } };
  const a = monter(SRC, { ui });
  a.majQuotaAffiche();
  dit(!b1.disabled && !b2.disabled && span.textContent === '150 restante(s)', 'quota plein : ⚡ actifs, « 150 restante(s) »', span.textContent);
  for (let i = 0; i < 150; i++) a.reserverEditions([{ o: 's', id: i, x: null }]);
  dit(b1.disabled && b2.disabled, 'quota épuisé : ⚡ unitaire ET ⚡ de groupe grisés');
  dit(/reprise à \d\d:\d\d/.test(b1.title) && /reprise à/.test(span.textContent), 'l\'infobulle et l\'en-tête donnent l\'heure de reprise', b1.title);
  dit(/150 éditions scriptées par heure atteint/.test(a.texteQuota()), 'le texte du quota dit le plafond');
  // TÉMOIN : sans le grisage, le bouton resterait actif.
  const mut = SRC.replace('b.disabled = !q.reste;', '');
  dit(mut !== SRC, 'mutation du grisage trouvée');
  const c1 = bouton('x');
  const c = monter(mut, { ui: { results: { querySelectorAll: sel => sel.includes('agn-quota') ? [] : [c1] } } });
  for (let i = 0; i < 150; i++) c.reserverEditions([{ o: 's', id: i, x: null }]);
  temoin(c1.disabled === true, 'grisage retiré');
}

console.log('\n=== G. Les branchements ===\n');
dit(/eventName: 'wme-save-finished', eventHandler: r => \{ if \(r && r\.success\) lancerRapprochementQ\(\); \}/.test(SRC),
  'le rapprochement est branché sur un enregistrement RÉUSSI (wme-save-finished)');
dit(/if \(res\.quota\) \{[\s\S]{0,300}break;/.test(extraire(SRC, 'async function corriger(')),
  'la série du ⚡ de groupe s\'arrête au premier refus de quota');
dit(/const besoin = editionsPrevues\(f, plan\);\s*const qAvant = quotaCourant\(\);\s*if \(qAvant\.reste < besoin\)/.test(extraire(SRC, 'async function appliquerCorrection(')),
  'le contrôle du quota précède toute question et toute écriture');
dit(/reserverEditions\(r\.editions\)/.test(SRC) && /reserverEditions\(\[\{ o: 'p'/.test(SRC) && /finally \{[\s\S]{0,200}reserverEditions\(\[\.\.\.parSeg\.values\(\)\]\.concat\(autres\)\)/.test(SRC),
  'les trois chemins d\'écriture réservent (conversion, adresse de POI, segments)');
dit(!/options\.[a-zA-Z]*[qQ]uota/.test(SRC), 'aucun réglage ne touche au quota');

console.log('\n' + (ko ? '❌ ' + ko + ' ECHEC(S)' : '✅ TOUT PASSE') + '   (' + ok + ' assertions)\n');
process.exit(ko ? 1 : 0);
})().catch(e => { console.error("ECHEC : " + e.stack); process.exit(1); });

