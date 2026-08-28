#!/usr/bin/env node
// check-accents-visibles.js — reste-t-il du TEXTE AFFICHE sans accent ?
//
// POURQUOI CE CONTROLE EXISTE (2026-08-28)
// ----------------------------------------
// Le suivi du projet portait « accents manquants (dictionnaire) » comme chantier ouvert,
// et `tools/mots-restants.py` annonçait 1 146 mots. Mais ce chiffre n'etait pas lisible :
// il compte « voie », « hors », « aucun » — des mots QUI N ONT PAS D ACCENT — et surtout
// il compte « agglom » et « ration », les deux moities de « agglomération » DEJA accentue,
// coupe par le caractere accentue lui-meme. Un inventaire qui compte ses propres succes
// comme des echecs ne permet de decider de rien.
//
// Et l essai a blanc des outils d accentuation proposait 40 remplacements qui portaient
// presque tous sur des COMMENTAIRES CSS et un message de log : leur automate suit l etat
// « dans une chaine », or le bloc CSS entier est une chaine. Applique, il produisait des
// commentaires internes a moitie accentues — pire que rien.
//
// CE QUE CELUI-CI MESURE : uniquement ce qu un editeur LIT A L ECRAN.
//   - les libelles et textes des gabarits HTML (hors commentaires),
//   - les infobulles `title="…"`,
//   - les textes du guidage pas a pas.
// Il ignore les commentaires, les logs, les identifiants et les selecteurs CSS.
'use strict';
const fs = require('fs');
const path = require('path');

const FICHIER = path.join(__dirname, '..', 'WME-Naming-Auditor.user.js');
const src = fs.readFileSync(FICHIER, 'utf8');

// Formes sans ambiguite grammaticale, reprises du dictionnaire de tools/accentuer.py.
// ⚠️ Aucun participe masculin singulier : « trace » (le trace) et « tracé » (il a tracé)
// ne se distinguent pas hors contexte, et deux regressions reelles ont ete attrapees
// la-dessus le 26/07. Ce controle SIGNALE, il ne corrige pas.
const ATTENDUS = [
    ['agglomeration', 'agglomération'], ['agglomerations', 'agglomérations'],
    ['numero', 'numéro'], ['numeros', 'numéros'], ['numerotation', 'numérotation'],
    ['departement', 'département'], ['departements', 'départements'],
    ['reference', 'référence'], ['references', 'références'],
    ['donnees', 'données'], ['controles', 'contrôles'], ['controle', 'contrôle'],
    ['fenetre', 'fenêtre'], ['fenetres', 'fenêtres'],
    ['ecart', 'écart'], ['ecarts', 'écarts'],
    ['etiquette', 'étiquette'], ['etiquettes', 'étiquettes'],
    ['peripherique', 'périphérique'], ['abreviation', 'abréviation'],
    ['redaction', 'rédaction'], ['resultats', 'résultats'], ['resultat', 'résultat'],
    ['perimetre', 'périmètre'], ['reseau', 'réseau'], ['serie', 'série'],
    ['selection', 'sélection'], ['selecteur', 'sélecteur'],
    ['probleme', 'problème'], ['systeme', 'système'], ['modele', 'modèle'],
    ['regle', 'règle'], ['regles', 'règles'], ['etape', 'étape'], ['etapes', 'étapes'],
    ['element', 'élément'], ['elements', 'éléments'], ['propriete', 'propriété'],
    ['geometrie', 'géométrie'], ['thematique', 'thématique'],
    ['deja', 'déjà'], ['meme', 'même'], ['apres', 'après'], ['tres', 'très'],
    ['entierement', 'entièrement'], ['completement', 'complètement'],
];

// ── Extraction du texte affiche ────────────────────────────────────────────
// 1. Les infobulles : title="…" ou title='…'
const titres = [...src.matchAll(/\btitle\s*=\s*["']([^"']{4,})["']/g)].map(m => m[1]);
// 2. Les textes entre balises des gabarits : >…< sans balise ni interpolation
const balises = [...src.matchAll(/>([^<>{}`$]{6,})</g)].map(m => m[1]);
// 3. Les textes du guidage pas a pas
const iG = src.indexOf('const GUIDAGE');
const guidage = iG < 0 ? [] :
    [...src.slice(iG, src.indexOf('\n  };', iG)).matchAll(/(?:texte|suite)\s*:\s*(?:\(\)\s*=>\s*)?'([^']{6,})'/g)]
        .map(m => m[1]);

// ⚠️⚠️ LE FILTRE EST LA PIECE CRITIQUE, et sa premiere version etait fausse : le motif
// `>…<` attrape TOUT ce qui separe un chevron d un autre dans le fichier, donc aussi du
// code (`p[1])); // Longueur = …`, `prog.etape('Lecture…')`, `options.controles.poiNumero`).
// Elle rendait 15 « formes a accentuer » qui etaient toutes du JavaScript.
// On ne garde donc qu une PHRASE : au moins deux espaces, et aucun caractere de code.
// ⚠️ Deuxieme resserrage : le filtre laissait encore passer de la CONCATENATION
// (`… les numéros : ' + 'WME ne les charge …`), qui n est pas du texte affiche mais
// deux chaines collees dans le code. Discriminant sur : le texte de l interface emploie
// l apostrophe TYPOGRAPHIQUE ; l apostrophe droite et le + n appartiennent qu au code.
const estPhrase = t => /\s\S+\s/.test(t)
    && !/[;(){}[\]=+'"\\]|\/\/|\$\{/.test(t);
const morceaux = [...titres, ...balises, ...guidage]
    .map(t => t.replace(/\s+/g, ' ').trim())
    .filter(t => t.length >= 12 && estPhrase(t));

console.log('\n— Ce qui a ete lu —');
console.log('  infobulles title= : ' + titres.length);
console.log('  textes de gabarit : ' + balises.length);
console.log('  textes du guidage : ' + guidage.length);
console.log('  fragments retenus : ' + morceaux.length);

const trouve = [];
for (const [sans, avec] of ATTENDUS) {
    const re = new RegExp('(^|[^a-zà-ÿ])' + sans + '($|[^a-zà-ÿ])', 'i');
    for (const t of morceaux) {
        if (re.test(t)) trouve.push({ sans, avec, ou: t.replace(/\s+/g, ' ').trim().slice(0, 96) });
    }
}

console.log('\n— Formes sans accent dans du texte affiche —');
if (!trouve.length) {
    console.log('  aucune.');
} else {
    for (const t of trouve) console.log('  « ' + t.sans + ' » -> « ' + t.avec + ' »   dans : ' + t.ou);
}

// TEMOIN : sans lui, un extracteur casse rendrait « aucune » et on conclurait a tort que
// tout est accentue. On verifie qu'il voit bien du texte francais ACCENTUE la ou il doit.
const temoins = morceaux.filter(t => /[éèêàçô]/.test(t)).length;
console.log('\n— Temoin d extraction —');
console.log('  fragments contenant deja un accent : ' + temoins +
            (temoins > 50 ? '  (l extracteur voit bien le texte francais)' : '  <-- TROP PEU, l extraction est suspecte'));

// ⚠️⚠️ CE QUE CE CONTROLE NE VOIT PAS, ET IL FAUT LE DIRE : le filtre est CONSERVATEUR.
// En ecartant tout fragment qui porte une apostrophe droite, un +, une parenthese, il
// ecarte aussi du VRAI texte affiche construit par concatenation. « Aucune » veut donc
// dire « aucune parmi les fragments retenus », jamais « aucune dans tout l ecran ».
// Un verdict qui tairait son perimetre vaudrait moins que pas de verdict du tout.
console.log('\n— Perimetre de ce verdict —');
console.log('  ' + morceaux.length + ' fragments examines sur ' +
            (titres.length + balises.length + guidage.length) + ' extraits.');
console.log('  Le filtre ecarte les chaines concatenees : elles ne sont PAS couvertes.');

console.log('');
if (temoins <= 50) { console.log('❌ MESURE NON CONCLUANTE : l extracteur ne voit pas le texte affiche.'); process.exit(2); }
console.log(trouve.length ? '❌ ' + trouve.length + ' forme(s) a accentuer dans du texte affiche.'
                          : 'TOUT PASSE : aucune forme sans accent parmi les fragments examines.');
process.exit(trouve.length ? 1 : 0);
