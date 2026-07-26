# -*- coding: utf-8 -*-
"""Liste les elements interactifs SANS `title=`, avec leur contexte, pour ecrire
des infobulles utiles plutot que du remplissage."""
import io, re

src = io.open('WME-Naming-Auditor.user.js', encoding='utf-8').read()
lignes = src.split('\n')

RE_EL = re.compile(r'<(button|input|select|textarea)\b[^>]*>', re.I)

trouves = []
for num, ligne in enumerate(lignes, 1):
    for m in RE_EL.finditer(ligne):
        balise = m.group(0)
        if 'title=' in balise:
            continue
        if re.search(r'type\s*=\s*"(hidden)"', balise):
            continue
        ident = ''
        mi = re.search(r'id\s*=\s*"([^"]+)"', balise)
        mc = re.search(r'class\s*=\s*"([^"]+)"', balise)
        if mi:
            ident = '#' + mi.group(1)
        elif mc:
            ident = '.' + mc.group(1)
        # texte visible qui suit la balise sur la meme ligne
        suite = ligne[m.end():m.end() + 70]
        suite = re.sub(r'<[^>]*>', ' ', suite).strip()
        trouves.append((num, m.group(1).lower(), ident, balise[:60], suite[:50]))

with io.open('tools/sans-infobulle.txt', 'w', encoding='utf-8') as f:
    f.write('%d elements interactifs sans infobulle\n\n' % len(trouves))
    for num, tag, ident, balise, suite in trouves:
        f.write('L%-6d %-8s %-26s %s\n' % (num, tag, ident, suite or balise))
print('%d elements sans infobulle -> tools/sans-infobulle.txt' % len(trouves))
