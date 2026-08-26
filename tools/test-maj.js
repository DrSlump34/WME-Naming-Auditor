/**
 * Tests de la PASTILLE DE MISE A JOUR (v2.38).
 *
 * ⚠️⚠️ CE QUE CES TESTS PROTEGENT : une pastille qui se trompe est PIRE que pas
 * de pastille. Allumee a tort, elle envoie l'editeur reinstaller ce qu'il a
 * deja, et il cesse de la croire. Eteinte a tort, elle ne sert a rien.
 *
 * ⭐ LE MODE DE DEFAILLANCE QUI NE SE VOIT PAS : le sondage passe par
 * `GM_xmlhttpRequest`, que Tampermonkey n'autorise que sur les domaines
 * declares en `@connect`. Sans `@connect update.greasyfork.org` l'appel est
 * refuse, `onerror` se tait (c'est voulu : hors ligne, on n'a rien a dire), et
 * la pastille ne s'allume JAMAIS — sans un seul message nulle part. C'est le
 * verrou n°1 de ce fichier, et il ne peut pas etre porte par le code : la ligne
 * vit dans le BLOC DE METADONNEES, que le script ne lit pas.
 *
 * ⭐ La comparaison de versions ne se fait PAS en chaines : '2.9.00' > '2.13.01'
 * est vrai dans l'alphabet et faux en versions. WNA en est deja a la 2.37, le
 * cas n'est pas theorique — il se produira a la 2.40 face a la 2.9 d'un
 * retardataire.
 *
 * ⚠️ Fonctions EXTRAITES du userscript, jamais recopiees.
 *
 * Usage : node tools/test-maj.js
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

/** Chaine d'une constante du script (URL, motif). */
function chaine(nom) {
  const m = src.match(new RegExp('const ' + nom + " = '([^']+)'"));
  if (!m) throw new Error('constante introuvable : ' + nom);
  return m[1];
}

const GF_META_URL = chaine('GF_META_URL');
const GF_PAGE_URL = chaine('GF_PAGE_URL');

/**
 * Monte le module de mise a jour avec un faux bouton et un faux
 * `GM_xmlhttpRequest`. `reponse` decrit ce que GreasyFork est cense repondre :
 *   { statut, corps }  ou  { erreur: true }  ou  { timeout: true }
 */
/**
 * ⚠️ LE BOUTON PART D'UNE SENTINELLE, PAS DE 'none'. Quand il n'y a rien a
 * annoncer, `_majVerifier` sort AVANT d'appeler `_majRender` : le bouton n'est
 * alors pas touche du tout. C'est correct — dans le script il nait deja
 * `display:none` dans le HTML de l'en-tete, et `buildOverlay` le repeint (les
 * deux sont verrouilles en section 4). L'invariant a verifier ici est donc
 * « la pastille ne s'ALLUME pas » (display !== 'flex'), et non « elle vaut
 * none » : ecrit ainsi, le test echouait sur du code juste.
 */
function monter(versionInstallee, reponse) {
  const bouton = { style: { display: 'sentinelle : jamais repeint' }, title: null };
  const journal = [];
  const appels = [];
  const module = new Function('bouton', 'journal', 'appels', 'reponse', [
    "const VERSION = '" + versionInstallee + "';",
    "const GF_META_URL = '" + GF_META_URL + "';",
    'const _VER_RE = ' + (src.match(/const _VER_RE = (\/.+\/);/) || [])[1] + ';',
    'let _majEnLigne = null;',
    'const log = (...a) => journal.push(a.join(" "));',
    'const document = { getElementById: id => (id === "agn-maj" ? bouton : null) };',
    'const GM_xmlhttpRequest = o => {',
    '  appels.push(o);',
    '  if (reponse.erreur) return o.onerror && o.onerror({});',
    '  if (reponse.timeout) return o.ontimeout && o.ontimeout({});',
    '  o.onload({ status: reponse.statut, responseText: reponse.corps });',
    '};',
    extraire('_majCmp'), extraire('_majRender'), extraire('_majVerifier'),
    'return { _majCmp, _majRender, _majVerifier, etat: () => _majEnLigne };'
  ].join('\n'))(bouton, journal, appels, reponse || {});
  return { module, bouton, journal, appels };
}

/** Un bloc de metadonnees GreasyFork credible, avec la version demandee. */
const meta = v => [
  '// ==UserScript==',
  '// @name         WME Naming Auditor',
  '// @version      ' + v,
  '// @description  peu importe',
  '// ==/UserScript=='
].join('\n');

let ok = 0, ko = 0;
function verifie(quoi, cond, detail) {
  if (cond) { ok++; return; }
  ko++;
  console.log('  ECHEC : ' + quoi + (detail ? '\n          ' + detail : ''));
}

// ───────────────────────────────────────────────────────────────────────────
// 1. La comparaison de versions
// ───────────────────────────────────────────────────────────────────────────
{
  const { module: m } = monter('2.37.00', {});
  verifie('2.37.00 est anterieure a 2.38.00', m._majCmp('2.37.00', '2.38.00') === -1);
  verifie('2.38.00 est posterieure a 2.37.00', m._majCmp('2.38.00', '2.37.00') === 1);
  verifie('2.37.00 est egale a elle-meme', m._majCmp('2.37.00', '2.37.00') === 0);
  // ⭐ LE CAS QUI TUE UNE COMPARAISON DE CHAINES : dans l'alphabet, '9' > '1'.
  verifie('2.9.00 est ANTERIEURE a 2.13.01 (et non l\'inverse)',
    m._majCmp('2.9.00', '2.13.01') === -1,
    'la comparaison se fait en chaines : elle croit que 2.9 est plus recent que 2.13');
  verifie('2.40.00 est posterieure a 2.9.00', m._majCmp('2.40.00', '2.9.00') === 1);
  // Les segments absents valent 0 : une meme version ecrite deux facons.
  verifie('2.37 et 2.37.00 sont la MEME version', m._majCmp('2.37', '2.37.00') === 0);
  verifie('2.37 est anterieure a 2.37.01', m._majCmp('2.37', '2.37.01') === -1);
  verifie('3.0.00 est posterieure a 2.99.99', m._majCmp('3.0.00', '2.99.99') === 1);
}

// ───────────────────────────────────────────────────────────────────────────
// 2. La pastille s'allume — et seulement quand il le faut
// ───────────────────────────────────────────────────────────────────────────
{
  const t = monter('2.37.00', { statut: 200, corps: meta('2.38.00') });
  t.module._majVerifier();
  verifie('une version publiee plus recente allume la pastille',
    t.module.etat() === '2.38.00' && t.bouton.style.display === 'flex',
    'display = ' + t.bouton.style.display + ', etat = ' + t.module.etat());
  verifie('l\'infobulle nomme la version publiee ET celle qui tourne',
    /2\.38\.00/.test(t.bouton.title) && /2\.37\.00/.test(t.bouton.title),
    'title = ' + t.bouton.title);
  verifie('la trouvaille est ecrite dans la console', t.journal.length === 1);
  verifie('le sondage interroge bien le .meta.js de GreasyFork',
    t.appels.length === 1 && t.appels[0].url === GF_META_URL);
  verifie('le sondage a un delai de garde', t.appels[0].timeout > 0,
    'sans timeout, un serveur muet laisse la requete pendante');
}
{
  const t = monter('2.37.00', { statut: 200, corps: meta('2.37.00') });
  t.module._majVerifier();
  verifie('la MEME version n\'allume rien',
    t.module.etat() === null && t.bouton.style.display !== 'flex');
}
{
  // ⚠️ Cas REEL du developpeur : sa copie de travail est en avance sur la
  // version publiee. La pastille lui dirait de RECULER.
  const t = monter('2.38.00', { statut: 200, corps: meta('2.37.00') });
  t.module._majVerifier();
  verifie('une version publiee PLUS ANCIENNE n\'allume rien',
    t.module.etat() === null && t.bouton.style.display !== 'flex');
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Tout ce qui peut mal tourner laisse la pastille ETEINTE
// ───────────────────────────────────────────────────────────────────────────
{
  // ⚠️ `onload` est appele AUSSI sur un 404 : sans le test de statut, la page
  // d'erreur de GreasyFork serait analysee comme un bloc de metadonnees.
  const t = monter('2.37.00', { statut: 404, corps: meta('9.99.99') });
  t.module._majVerifier();
  verifie('un 404 n\'est pas analyse comme des metadonnees',
    t.module.etat() === null && t.bouton.style.display !== 'flex',
    'la page d\'erreur a ete lue comme une version');
}
{
  const t = monter('2.37.00', { statut: 200, corps: '<html>maintenance</html>' });
  t.module._majVerifier();
  verifie('une reponse sans @version n\'allume rien', t.module.etat() === null);
}
{
  const t = monter('2.37.00', { statut: 200, corps: meta('demain') });
  t.module._majVerifier();
  verifie('une version publiee illisible n\'allume rien', t.module.etat() === null,
    'un numero qui n\'est pas fait de chiffres a ete accepte');
}
{
  const t = monter('2.37.00', { erreur: true });
  t.module._majVerifier();
  verifie('hors ligne : pas de pastille, et rien dans la console',
    t.module.etat() === null && t.journal.length === 0);
}
{
  const t = monter('2.37.00', { timeout: true });
  t.module._majVerifier();
  verifie('serveur muet : pas de pastille', t.module.etat() === null);
}
{
  // VERSION vaut '?' quand GM_info manque (chargement par injection, test).
  const t = monter('?', { statut: 200, corps: meta('9.99.99') });
  t.module._majVerifier();
  verifie('version locale inconnue : on ne sonde meme pas',
    t.module.etat() === null && t.appels.length === 0,
    'on a compare a une version qu\'on ne connait pas');
}

// ───────────────────────────────────────────────────────────────────────────
// 4. Verrous d'ASSEMBLAGE — le module peut etre parfait et n'etre branche
//    nulle part. C'est exactement ce qui est arrive au cadrage le 14/08.
// ───────────────────────────────────────────────────────────────────────────
{
  // ⭐⭐⭐ LE VERROU QUI COMPTE : sans cette ligne de metadonnees, Tampermonkey
  // refuse l'appel et la pastille ne s'allume JAMAIS, EN SILENCE.
  verifie('l\'en-tete declare @connect update.greasyfork.org',
    /^\/\/ @connect\s+update\.greasyfork\.org\s*$/m.test(src),
    'GM_xmlhttpRequest sera refuse par le gestionnaire de scripts, sans aucun message');

  verifie('le bouton existe dans l\'en-tete de la fenetre',
    /<button id="agn-maj"[^>]*style="display:none"/.test(src),
    'le bouton manque, ou il est visible des le depart');
  verifie('le bouton est pose AVANT « Reduire »',
    src.indexOf('id="agn-maj"') < src.indexOf('id="agn-reduire"'));
  verifie('le clic ouvre la page GreasyFork dans un autre onglet',
    /#agn-maj'\)\.onclick[\s\S]{0,220}open\(GF_PAGE_URL, '_blank', 'noopener'\)/.test(src),
    'le clic n\'ouvre pas GF_PAGE_URL, ou il remplacerait l\'onglet WME');
  verifie('le clic ne part pas en glissement de la fenetre',
    /#agn-maj'\)\.onclick[\s\S]{0,120}stopPropagation\(\)/.test(src),
    'l\'en-tete est la poignee de deplacement : sans stopPropagation le clic la fait bouger');

  // ⚠️ Le sondage peut repondre AVANT que l'en-tete existe : la construction
  // doit repeindre, sinon la pastille reste eteinte alors que la MAJ est la.
  verifie('la construction de la fenetre repeint la pastille',
    /_majRender\(\);/.test(src.slice(src.indexOf('function buildOverlay('))),
    'buildOverlay n\'appelle pas _majRender');
  verifie('le sondage est lance une seule fois',
    (src.match(/^\s*_majVerifier\(\);/gm) || []).length === 1,
    (src.match(/^\s*_majVerifier\(\);/gm) || []).length + ' appel(s) a _majVerifier');
  // ⚠️ APRES buildOverlay : la pastille n'a nulle part ou se poser avant.
  verifie('le sondage est lance APRES la construction de la fenetre',
    src.indexOf('_majVerifier();') > src.indexOf('    buildOverlay();'),
    '_majVerifier est appele avant que l\'en-tete existe');

  // ⭐ Les deux URL doivent designer LE MEME script : une pastille qui renvoie
  // vers la page d'un autre script serait pire que rien.
  const idMeta = (GF_META_URL.match(/scripts\/(\d+)/) || [])[1];
  const idPage = (GF_PAGE_URL.match(/scripts\/(\d+)/) || [])[1];
  verifie('les deux URL GreasyFork designent le meme script',
    idMeta && idMeta === idPage, 'meta = ' + idMeta + ', page = ' + idPage);
  verifie('l\'URL de la page GreasyFork n\'est ecrite qu\'une fois',
    (src.match(/greasyfork\.org\/fr\/scripts\/\d+-wme-naming-auditor/g) || []).length === 1,
    'l\'adresse est ecrite a plusieurs endroits : ils divergeront');

  // La pastille doit garder son rouge : les regles generales de l'en-tete
  // repeignent TOUS ses boutons (piege vecu sur WCT en theme compact).
  verifie('la pastille a sa propre couleur, par un selecteur a deux id',
    /#agn-tete button#agn-maj\{[^}]*background:#e53935/.test(src),
    'la regle generale `#agn-tete button` repeindra la pastille en bleu translucide');

  // ── L'animation ────────────────────────────────────────────────────────
  // ⭐ L'INTERMITTENCE PORTE UN SENS, elle n'est pas decorative : une rotation
  // CONTINUE est le vocabulaire du « traitement en cours » et dit d'ATTENDRE,
  // quand la pastille dit qu'il y a quelque chose A FAIRE. Un tour, puis une
  // pause. Le verrou porte donc sur le PALIER des keyframes, pas sur la duree.
  // ⚠️ Pas de [^}]* ici : les keyframes contiennent leurs propres accolades.
  verifie('la fleche tourne', /@keyframes agn-maj-tourne\{[\s\S]{0,120}rotate\(360deg\)/.test(src));
  verifie('elle s\'ARRETE entre deux tours (palier dans les keyframes)',
    /@keyframes agn-maj-tourne\{0%\{transform:rotate\(0deg\)\}25%,\s*100%\{transform:rotate\(360deg\)\}\}/.test(src),
    'la rotation est continue : elle se lira comme un traitement en cours');
  // ⚠️ « Animations reduites » vise les troubles vestibulaires, pas un gout.
  verifie('le réglage système « animations réduites » est honoré',
    /@media \(prefers-reduced-motion: reduce\)\{[\s\S]{0,120}#agn-maj svg\{animation:none\}/.test(src),
    'la fleche tournera meme chez qui a demande l\'arret des animations');
}

console.log((ko ? '✗' : '✓') + ' ' + ok + ' verification(s), ' + ko + ' echec(s)');
process.exit(ko ? 1 : 0);
