# -*- coding: utf-8 -*-
"""
Accentuation, 2e generation : parcours GLOBAL du fichier.

⚠️⚠️ POURQUOI CE SECOND OUTIL. `accentuer.py` travaillait LIGNE PAR LIGNE : il
ne voyait donc pas l'interieur des templates literals MULTI-LIGNES, c'est-a-dire
la quasi-totalite de l'interface (tout le HTML est ecrit ainsi). Il n'a touche
que les chaines tenant sur une seule ligne. Constate en live le 26/07 : « privees »,
« surnumeraires », « separement », « ecarts », « Numero », « fenetre » restaient
affiches sans accent dans le panneau.

Cet automate suit l'etat a travers les lignes : CODE / '...' / "..." / `...`,
commentaires ligne et bloc, et les `${...}` d'un template (qui sont du CODE, avec
gestion de l'imbrication).

Protections conservees :
  - les lignes de declaration de regex (`const RE_X = /.../`) sont ignorees :
    ⚠️ RE_ROCADE contient « peripherique », l'accentuer casserait la detection ;
  - les fragments techniques (noms de calques `-ecarts`, selecteurs, cles) ;
  - les valeurs d'attributs techniques (class/id/data-*/list/type/style…) ;
  - les commentaires (invisibles pour l'editeur).

Usage : python tools/accentuer2.py --dry | python tools/accentuer2.py
"""
import io, re, sys

sys.path.insert(0, 'tools')
from accentuer import MOTS, AMBIGUS, RE_TECHNIQUE, RE_MOT, applique_mot  # noqa

FICHIER = 'WME-Naming-Auditor.user.js'

# Attributs dont la valeur est technique : on n'y touche pas.
RE_ATTR_TECH = re.compile(
    r'(?:class|id|data-\w+|list|type|accept|autocomplete|style|for|name|href|src)'
    r'\s*=\s*"[^"]*"')


# ⚠️⚠️ `${...}` DOIT etre protege meme dans une chaine a guillemets SIMPLES.
# Regression attrapee a l'essai a blanc du 26/07 : `label: '${etiquette}'` n'est
# PAS une interpolation JS, c'est un placeholder que le styleContext d'OpenLayers
# resout par nom. L'accentuer en `${étiquette}` cassait toutes les etiquettes de
# la carte, en silence.
RE_PROTEGE = re.compile(r'(\$\{[^{}]*\}|' + RE_ATTR_TECH.pattern + ')')


def traite_texte(txt, dans_template):
    """Accentue un fragment de texte de chaine, en epargnant le technique."""
    if not txt.strip():
        return txt
    if not dans_template and RE_TECHNIQUE.match(txt.strip()):
        return txt
    parts = RE_PROTEGE.split(txt)
    # re.split avec un groupe capturant : les separateurs sont aux rangs impairs.
    for i in range(0, len(parts), 2):
        if parts[i]:
            parts[i] = RE_MOT.sub(applique_mot, parts[i])
    return ''.join(p for p in parts if p is not None)


def lignes_interdites(src):
    """Numeros de lignes a ne pas toucher (declarations de regex)."""
    interdites = set()
    for i, l in enumerate(src.split('\n')):
        if re.search(r'\bRE_[A-Z_]+\s*=|new RegExp|\.replace\(/|\.test\(/', l):
            interdites.add(i)
    return interdites


def main():
    dry = '--dry' in sys.argv
    src = io.open(FICHIER, encoding='utf-8').read()
    interdites = lignes_interdites(src)

    out = []
    i, n = 0, len(src)
    etat = 'CODE'          # CODE | SQ | DQ | TPL | LC | BC
    tampon = []            # texte de chaine en cours
    prof_interp = 0        # profondeur des ${ } dans un template
    ligne = 0
    modifs = 0
    exemples = []

    def vider(dans_tpl):
        nonlocal modifs
        if not tampon:
            return ''
        brut = ''.join(tampon)
        tampon.clear()
        if ligne in interdites:
            return brut
        neuf = traite_texte(brut, dans_tpl)
        if neuf != brut:
            modifs += 1
            if len(exemples) < 500:
                exemples.append((ligne + 1, brut.strip()[:90], neuf.strip()[:90]))
        return neuf

    while i < n:
        c = src[i]
        if c == '\n':
            ligne += 1

        if etat == 'CODE':
            if src.startswith('//', i):
                etat = 'LC'; out.append(c); i += 1; continue
            if src.startswith('/*', i):
                etat = 'BC'; out.append(c); i += 1; continue
            if c == "'":
                etat = 'SQ'; out.append(c); i += 1; continue
            if c == '"':
                etat = 'DQ'; out.append(c); i += 1; continue
            if c == '`':
                etat = 'TPL'; out.append(c); i += 1; continue
            out.append(c); i += 1; continue

        if etat == 'LC':
            out.append(c)
            if c == '\n':
                etat = 'CODE'
            i += 1; continue

        if etat == 'BC':
            out.append(c)
            if src.startswith('*/', i - 1) and i > 0:
                etat = 'CODE'
            i += 1; continue

        if etat in ('SQ', 'DQ'):
            fin = "'" if etat == 'SQ' else '"'
            if c == '\\':
                tampon.append(src[i:i + 2]); i += 2; continue
            if c == fin:
                out.append(vider(False)); out.append(c); etat = 'CODE'; i += 1; continue
            if c == '\n':      # chaine non terminee : on ne prend pas de risque
                out.append(vider(False)); out.append(c); etat = 'CODE'; i += 1; continue
            tampon.append(c); i += 1; continue

        if etat == 'TPL':
            if prof_interp:
                # on est dans ${ ... } : du CODE, on recopie tel quel
                out.append(c)
                if c == '{':
                    prof_interp += 1
                elif c == '}':
                    prof_interp -= 1
                i += 1; continue
            if c == '\\':
                tampon.append(src[i:i + 2]); i += 2; continue
            if src.startswith('${', i):
                out.append(vider(True)); out.append('${'); prof_interp = 1; i += 2; continue
            if c == '`':
                out.append(vider(True)); out.append(c); etat = 'CODE'; i += 1; continue
            tampon.append(c); i += 1; continue

    out.append(vider(etat == 'TPL'))
    neuf = ''.join(out)

    with io.open('tools/accents2-rapport.txt', 'w', encoding='utf-8') as f:
        f.write('Fragments touches : %d\n\n' % modifs)
        for num, av, ap in exemples:
            f.write('L%d\n  - %s\n  + %s\n' % (num, av, ap))
    if not dry:
        io.open(FICHIER, 'w', encoding='utf-8', newline='').write(neuf)
    print('fragments touches : %d%s' % (modifs, ' (essai a blanc)' if dry else ' (APPLIQUE)'))


main()
