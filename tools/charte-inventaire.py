# -*- coding: utf-8 -*-
"""Inventaire des valeurs de style en dur dans le bloc CSS, pour decider d'une
echelle. On ne touche PAS aux couleurs fonctionnelles (familles de surlignage) :
elles vivent dans le JS (`FAMILLES`), pas ici, et chacune porte du sens."""
import io, re
from collections import Counter

src = io.open('WME-Naming-Auditor.user.js', encoding='utf-8').read()
m = re.search(r'const CSS = `(.*?)`;', src, re.S)
css = m.group(1)

def compte(motif, nom):
    v = re.findall(motif, css)
    c = Counter(v)
    print('\n%s — %d valeurs distinctes, %d occurrences' % (nom, len(c), len(v)))
    for val, n in sorted(c.items(), key=lambda x: -x[1]):
        print('   %-10s x%d' % (val, n))
    return c

compte(r'font-size:\s*([0-9.]+px)', 'TAILLES DE POLICE')
compte(r'border-radius:\s*([0-9.]+px)', 'RAYONS DE BORDURE')
cols = compte(r'(#[0-9a-fA-F]{3,6})', 'COULEURS')
print('\nCouleurs utilisees UNE SEULE fois : %d'
      % sum(1 for v, n in cols.items() if n == 1))
