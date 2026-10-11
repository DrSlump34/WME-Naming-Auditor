#!/usr/bin/env node
// test-liste-groupe.js — la confirmation du ⚡ de groupe MONTRE ce qui va être écrit (doctrine France § 3.3,
// 2.53.00) : une ligne par correction, chaque champ « avant → après », les segments verrouillés dits, les
// écarts du dictionnaire public absents (le ⚡ ne les écrit pas), et rien n'est appliqué sans « Appliquer ».
// confirmerGroupe est extraite du fichier RÉEL et jouée contre un DOM simulé.
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'WME-Naming-Auditor.user.js'), 'utf8');
const i = src.indexOf('  function confirmerGroupe('), j = src.indexOf('\n  function isolerClavier(', i);
if (i < 0 || j < 0) { console.error('ECHEC : confirmerGroupe introuvable'); process.exit(1); }
const bloc = src.slice(i, j);
let ok = 0, ko = 0;
const dit = (b, q, d) => { console.log('  ' + (b ? 'ok  ' : 'KO  ') + ' ' + q + (d ? '   ' + d : '')); b ? ok++ : ko++; };

const jouer = (code, clic) => {
    let html = '';
    const boutons = {};
    const boite = {
        querySelector: s => (boutons[s] = boutons[s] || { onclick: null, focus() {} }),
        addEventListener() {}, remove() { boite.retiree = true; }, onclick: null,
    };
    const env = {
        el: h => { html = h; return boite; },
        document: { body: { appendChild() {} } },
        esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
        tr: s => s, trf: (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]),
        texteQuota: q => 'Quota : ' + q.reste, rendreDeplacable() {}, isolerClavier() {},
    };
    const k = Object.keys(env);
    const f = new Function(...k, code + '\nreturn confirmerGroupe;')(...k.map(x => env[x]));
    const aFaire = [
        { libelle: 'Rue de la Paix', nb: 3, verrouilles: 1, segId: 11, ecarts: [
            { champ: 'Nom', avant: 'r. de la paix', apres: 'Rue de la Paix' },
            { champ: 'Nom', avant: 'X', apres: 'NOM PUBLIC', publique: true }] },
        { libelle: 'Chemin <b>du Moulin</b>', nb: 1, segId: 22, ecarts: [{ champ: 'Ville', avant: '', apres: 'Uzès' }] },
    ];
    const p = f(aFaire, { nbSeg: 3, douteux: 1, q: { reste: 120 }, prevu: 4 });
    clic(boutons);
    return p.then(r => ({ r, html, retiree: boite.retiree }));
};

(async () => {
    const a = await jouer(bloc, b => b['#agn-cg-ok'].onclick());
    dit(a.r === true, 'Appliquer ⇒ true');
    dit(a.retiree === true, 'la boîte se ferme');
    dit(/Rue de la Paix/.test(a.html) && /Chemin &lt;b>du Moulin/.test(a.html), 'une ligne par correction, libellé échappé');
    dit(/r\. de la paix → Rue de la Paix/.test(a.html), 'le champ « avant → après » est listé');
    dit(/<b>Ville<\/b> :  → Uzès/.test(a.html), 'un champ vide avant est listé aussi');
    dit(!/NOM PUBLIC/.test(a.html), 'l’écart du dictionnaire public n’est PAS listé (le ⚡ ne l’écrit pas)');
    dit(/🔒 1 segment\(s\) verrouillé/.test(a.html), 'les segments verrouillés sont dits');
    dit(/2 segment\(s\)/.test(a.html), 'les segments touchés sont comptés sans les verrouillés');
    dit(/1 autre\(s\) avec un doute/.test(a.html) && /Quota : 120/.test(a.html), 'doutes et quota rappelés');
    const b = await jouer(bloc, x => x['#agn-cg-non'].onclick());
    dit(b.r === false, 'Annuler ⇒ false (rien n’est appliqué)');
    dit(/confirmerGroupe\(aFaire, \{ nbSeg, douteux, q, prevu \}\)\.then\(ok => \{\s*if \(ok\) corriger\(/.test(src), 'le ⚡ de groupe passe par la liste, et ne corrige que sur « Appliquer »');
    // TÉMOIN : sans le filtre, l'écart public serait listé comme s'il allait être écrit.
    const sans = bloc.replace('.filter(e => !e.publique)', '');
    dit(sans !== bloc, 'TÉMOIN trouvé');
    const t = await jouer(sans, x => x['#agn-cg-ok'].onclick());
    dit(/NOM PUBLIC/.test(t.html), 'TÉMOIN : sans le filtre, le nom public apparaîtrait');
    console.log('\n' + (ko ? '❌ ' + ko + ' ECHEC(S)' : '✅ TOUT PASSE') + '   (' + ok + ' assertions)\n');
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ECHEC : ' + e.stack); process.exit(1); });
