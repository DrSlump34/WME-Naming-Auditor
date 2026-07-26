# -*- coding: utf-8 -*-
"""
Chantier n°3 de l'audit : homogeneiser la charte du CSS.

CE QUI EST FAIT
  1. Echelle de TAILLES : 10 / 11 / 12 / 13 px (les demi-pixels arbitraires
     10,5 / 11,5 / 12,5 disparaissent). 19 px reste : c'est l'icone du bouton
     flottant, un cas isole et assume.
  2. Echelle de RAYONS : 3 / 4 / 6 / 8 px (2 -> 3, 5 -> 4, 7 -> 6, 9 -> 8).
  3. Les gris et les couleurs SEMANTIQUES passent en variables `--agn-*`,
     definies sur `:root` (nos elements vivent dans trois racines DOM
     differentes — fenetre, volet, panneau lateral — donc l'heritage depuis
     `:root` est la seule facon de les partager).

⚠️⚠️ CHAQUE `var()` PORTE SON FALLBACK : `var(--agn-bleu, #1e88e5)`. Si la
variable venait a manquer (feuille tronquee, conflit), la couleur d'origine
s'applique quand meme. Sans ce filet, un `var()` non resolu rend la propriete
invalide et l'element perd sa couleur — sur 176 occurrences, le risque n'est pas
theorique.

⚠️⚠️ AUCUN BACKTICK dans le bloc RACINE : ce CSS est injecte dans un template
literal, un backtick le coupe (erreur commise ici le 26/07, deux fois).

⚠️ On ne touche PAS aux couleurs FONCTIONNELLES des familles d'ecarts : elles
vivent dans le JS (`FAMILLES`), chacune porte du sens, et l'editeur peut les
regler lui-meme.
"""
import io, re, sys

FICHIER = 'WME-Naming-Auditor.user.js'

TAILLES = {'10.5px': '11px', '11.5px': '11px', '12.5px': '12px'}
RAYONS = {'2px': '3px', '5px': '4px', '7px': '6px', '9px': '8px'}

# couleur d'origine -> nom de variable
COULEURS = {
    '#1f2933': 'texte',
    '#546e7a': 'gris',
    '#78909c': 'gris-clair',
    '#607d8b': 'gris-titre',
    '#b0bec5': 'gris-pale',
    '#cfd8dc': 'bord',
    '#eceff1': 'fond-doux',
    '#f5f7f9': 'fond-survol',
    '#1e88e5': 'bleu',
    '#1565c0': 'bleu-fonce',
    '#2e7d32': 'vert',
    '#c62828': 'rouge',
    '#e65100': 'orange',
    '#a34a00': 'brun',
    '#ffb300': 'ambre',
}

RACINE = """  /* ─── Charte (v2.07) ────────────────────────────────────────────────────
     Une echelle de 4 tailles (10/11/12/13) et de 4 rayons (3/4/6/8), et des
     couleurs nommees. Avant : 8 tailles dont des demi-pixels arbitraires,
     8 rayons, 61 couleurs en dur.
     ⚠️ Definies sur :root parce que nos elements vivent dans TROIS racines
     DOM distinctes (fenetre flottante, volet, panneau lateral de WME) : c'est
     le seul point commun qui les fasse heriter.
     ⚠️ Chaque usage porte son fallback — var(--agn-bleu, #1e88e5) — pour
     qu'une variable manquante ne fasse jamais disparaitre une couleur. */
  :root{
    --agn-texte:#1f2933; --agn-gris:#546e7a; --agn-gris-clair:#78909c;
    --agn-gris-titre:#607d8b; --agn-gris-pale:#b0bec5;
    --agn-bord:#cfd8dc; --agn-fond-doux:#eceff1; --agn-fond-survol:#f5f7f9;
    --agn-bleu:#1e88e5; --agn-bleu-fonce:#1565c0;
    --agn-vert:#2e7d32; --agn-rouge:#c62828; --agn-orange:#e65100;
    --agn-brun:#a34a00; --agn-ambre:#ffb300;
  }
"""


def main():
    dry = '--dry' in sys.argv
    src = io.open(FICHIER, encoding='utf-8').read()
    m = re.search(r'(const CSS = `)(.*?)(`;)', src, re.S)
    css = m.group(2)
    avant = css
    stats = {'tailles': 0, 'rayons': 0, 'couleurs': 0}

    for vieux, neuf in TAILLES.items():
        n = len(re.findall(r'font-size:\s*' + re.escape(vieux), css))
        css = re.sub(r'(font-size:\s*)' + re.escape(vieux), r'\g<1>' + neuf, css)
        stats['tailles'] += n
    for vieux, neuf in RAYONS.items():
        n = len(re.findall(r'border-radius:\s*' + re.escape(vieux), css))
        css = re.sub(r'(border-radius:\s*)' + re.escape(vieux), r'\g<1>' + neuf, css)
        stats['rayons'] += n
    for hexa, nom in COULEURS.items():
        # insensible a la casse, sur le mot entier (pas au milieu d'un #aabbccdd)
        motif = re.compile(re.escape(hexa) + r'(?![0-9a-fA-F])', re.I)
        n = len(motif.findall(css))
        css = motif.sub('var(--agn-%s, %s)' % (nom, hexa), css)
        stats['couleurs'] += n

    css = RACINE + css.lstrip('\n')
    src = src[:m.start(2)] + css + src[m.end(2):]

    if not dry:
        io.open(FICHIER, 'w', encoding='utf-8', newline='').write(src)
    print('tailles unifiees : %d, rayons : %d, couleurs nommees : %d%s'
          % (stats['tailles'], stats['rayons'], stats['couleurs'],
             ' (essai a blanc)' if dry else ' (APPLIQUE)'))
    # controle : aucune variable sans fallback
    sans = re.findall(r'var\(--agn-[a-z-]+\)', css)
    if sans:
        print('  ⚠️ %d var() SANS fallback : %s' % (len(sans), set(sans)))
    else:
        print('  toutes les var() portent un fallback')


main()
