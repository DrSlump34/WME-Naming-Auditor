#!/usr/bin/env node
// test-droits.js — à qui le ⚡ « corriger » est ouvert (2.51.00, décision de l'auteur du 11/10/2026) :
// L6, Champs (Local Champ, Global Champ, Country Coordinator), Global Editors, staff. Plus les L5.
// Le contrôle est extrait du fichier RÉEL et joué contre des profils simulés. Les rangs restent
// écrits en empreintes (consigne de l'auteur) : ce banc est l'endroit où la règle se lit en clair.
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'WME-Naming-Auditor.user.js'), 'utf8');
const i = src.indexOf('  const _fx = t =>'), j = src.indexOf('  /** La « ville vide »', i);
if (i < 0 || j < 0) { console.error('ECHEC : bloc des droits introuvable'); process.exit(1); }
const bloc = src.slice(i, j);
let ok = 0, ko = 0;
const dit = (b, quoi, d) => { console.log('  ' + (b ? 'ok  ' : 'KO  ') + ' ' + quoi + (d ? '   ' + d : '')); b ? ok++ : ko++; };

const jouer = async ({ rang, global = false, staff = false, groupes = [], code = bloc }) => {
    const sdk = { State: { getUserInfo: () => ({ rank: rang }) } };
    const hote = {
        W: { loginManager: { user: { attributes: { rank: rang, globalEditor: global, isStaff: staff } } } },
        fetch: async () => ({ ok: true, json: async () => ({ current_user: { groups: groupes.map(name => ({ name })) } }) }),
    };
    const f = new Function('sdk', 'hote', code + '\nreturn { droits, attendre: () => new Promise(r => setTimeout(r, 5)) };');
    const o = f(sdk, hote);
    await o.attendre();
    return o.droits();
};

(async () => {
    console.log('\n=== Droits du ⚡ corriger ===\n');
    const cas = [
        ['L4 sans rôle', { rang: 3 }, false],
        ['L5 sans rôle : RETIRÉ', { rang: 4 }, false],
        ['L6', { rang: 5 }, true],
        ['L5 Local Champ', { rang: 4, groupes: ['fr-local-champ'] }, true],
        ['L4 Global Champ', { rang: 3, groupes: ['editors-global-champ'] }, true],
        ['L5 Coordinator', { rang: 4, groupes: ['editors-coordinator'] }, true],
        ['L5 Emeritus Local Champ : non', { rang: 4, groupes: ['fr-emeritus-local-champ'] }, false],
        ['L3 Global Editor', { rang: 2, global: true }, true],
        ['L2 staff', { rang: 1, staff: true }, true],
    ];
    for (const [nom, profil, attendu] of cas) {
        const d = await jouer(profil);
        dit(d.autorise === attendu, nom, 'autorise=' + d.autorise + ' motifs=' + d.motifs.join(','));
    }
    const lc = await jouer({ rang: 4, groupes: ['fr-local-champ'] });
    dit(lc.motifs.includes('Local Champ'), 'le motif « Local Champ » est affiché', lc.motifs.join(','));
    // TEMOIN : remettre l'empreinte de r4 dans la liste rouvre les L5.
    const avecL5 = bloc.replace('const _fz = [', 'const _fz = [0x953f8f3, ').replace(/const _fq = 0x[0-9a-f]+;/, 'const _fq = ' + (0x3549bc41 ^ 0x953f8f3) + ';');
    dit(avecL5 !== bloc, 'TEMOIN : la liste est trouvée dans le bloc');
    // 2.52.00 : le recoupement du plafond (`_fs`) porte aussi sur le jeu d'empreintes. Retoucher la
    // liste et `_fq` sans `_fs` laisse le ⚡ ÉTEINT ; il faut les trois pour rouvrir les L5.
    const t0 = await jouer({ rang: 4, code: avecL5 });
    dit(t0.autorise === false, '2.52.00 : liste + _fq retouchés sans _fs ⇒ ⚡ éteint', 'autorise=' + t0.autorise);
    const avecL5bis = avecL5.replace(/const _fs = 0x[0-9a-f]+;/, 'const _fs = ' + ((0x357f5257 ^ 0x953f8f3) >>> 0) + ';');
    dit(avecL5bis !== avecL5, 'TEMOIN : la somme du plafond est trouvée dans le bloc');
    const t = await jouer({ rang: 4, code: avecL5bis });
    dit(t.autorise === true, 'TEMOIN : avec l empreinte de r4, un L5 serait autorisé', 'autorise=' + t.autorise);
    // Le plafond fait partie du droit : un cœur de quota retouché (151 au lieu de 150) éteint le ⚡.
    const quota151 = bloc.replace('const m = 0x96, f = 0x36ee80;', 'const m = 0x97, f = 0x36ee80;');
    dit(quota151 !== bloc, 'TEMOIN : le cœur du quota est trouvé dans le bloc');
    const t2 = await jouer({ rang: 5, code: quota151 });
    dit(t2.autorise === false, 'plafond relevé à 151 dans le cœur ⇒ L6 refusé (⚡ éteint)', 'autorise=' + t2.autorise);
    dit(!/\bL5\b/.test(src.slice(src.indexOf('Correction désactivée'), src.indexOf('Correction désactivée') + 120)), 'le message de refus ne cite plus les L5');
    console.log('\n' + (ko ? '❌ ' + ko + ' ECHEC(S)' : '✅ TOUT PASSE') + '   (' + ok + ' assertions)\n');
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ECHEC : ' + e.stack); process.exit(1); });
