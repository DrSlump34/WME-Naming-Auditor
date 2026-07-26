# -*- coding: utf-8 -*-
"""Liste les chaines VISIBLES contenant une forme grammaticalement ambigue,
que `accentuer.py` refuse de traiter. A corriger a la main, une par une."""
import io, re

AMBIGUS = ['ajoute', 'applique', 'active', 'refuse', 'accepte', 'autorise',
           'depasse', 'propose', 'cree', 'supprime', 'charge', 'telecharge',
           'declare', 'considere', 'genere', 'ecarte', 'conserve', 'enregistre',
           'reserve', 'detecte', 'verifie', 'identifie', 'releve', 'trace',
           'deplace', 'commence', 'interrompu', 'abime', 'indetermine',
           'desactive', 'reussi', 'termine', 'bloque', 'ignore', 'signale',
           'delai', 'depasse', 'selectionne', 'sauvegarde', 'zone grise']

RE_LITTERAL = re.compile(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"")
RE_TECH = re.compile(r'^-|^#|^\.|^agn|^wme|^https?:|^[a-z-]+:[^ ]*$')

src = io.open('WME-Naming-Auditor.user.js', encoding='utf-8').read()
trouves = []
for num, ligne in enumerate(src.split('\n'), 1):
    s = ligne.lstrip()
    if s.startswith('//') or s.startswith('*') or s.startswith('/*'):
        continue
    if re.search(r'=\s*/|new RegExp|\.test\(', ligne):
        continue
    for m in RE_LITTERAL.finditer(ligne):
        txt = m.group(1) if m.group(1) is not None else m.group(2)
        if not txt or len(txt) < 4:
            continue
        if RE_TECH.match(txt.strip()):
            continue
        for w in AMBIGUS:
            if re.search(r'\b' + w, txt, re.I):
                trouves.append((num, txt[:100]))
                break

with io.open('tools/ambigus-a-la-main.txt', 'w', encoding='utf-8') as f:
    f.write('%d chaines visibles a revoir a la main\n\n' % len(trouves))
    for num, txt in trouves:
        f.write('L%-6d %s\n' % (num, txt))
print('%d chaines a revoir a la main' % len(trouves))
