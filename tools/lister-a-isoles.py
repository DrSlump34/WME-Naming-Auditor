# -*- coding: utf-8 -*-
"""
Liste les « a » isoles dans le TEXTE VISIBLE, pour arbitrer un par un.

⚠️ Aucun automatisme possible ici : « a » est soit la preposition (« à la main »,
« a couper » -> « à couper »), soit le verbe avoir (« WME a refuse », « le script
a besoin »). Seul le contexte tranche, donc on se contente de LISTER, avec assez
de texte autour pour decider.
"""
import io, re

RE_LITTERAL = re.compile(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"|`")
src = io.open('WME-Naming-Auditor.user.js', encoding='utf-8').read()

trouves = []
for num, ligne in enumerate(src.split('\n'), 1):
    s = ligne.lstrip()
    if s.startswith('//') or s.startswith('*') or s.startswith('/*'):
        continue
    if re.search(r'\bRE_[A-Z_]+\s*=|new RegExp', ligne):
        continue
    # on ne garde que les lignes qui portent visiblement du texte affiche
    if not re.search(r"['\"`>]", ligne):
        continue
    for m in re.finditer(r'(.{0,32})\ba\b(.{0,32})', ligne):
        avant, apres = m.group(1), m.group(2)
        ctx = (avant + ' [a] ' + apres).strip()
        # exclure le code evident
        if re.search(r'[=({;]\s*a\b|\ba\s*[=.)]|function|const |let |var ', ctx):
            continue
        trouves.append((num, ctx))

with io.open('tools/a-isoles.txt', 'w', encoding='utf-8') as f:
    f.write('%d occurrences de « a » isole a arbitrer\n\n' % len(trouves))
    for num, ctx in trouves:
        f.write('L%-6d %s\n' % (num, ctx))
print('%d occurrences -> tools/a-isoles.txt' % len(trouves))
