# -*- coding: utf-8 -*-
"""Inventaire des mots SANS ACCENT presents dans le texte visible, par frequence.
Sert a completer le dictionnaire sans rien rater (on juge a l'oeil, on ne devine
pas). Les mots deja accentues et le vocabulaire technique sont ecartes."""
import io, re
from collections import Counter

RE_LITTERAL = re.compile(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"")
RE_TECH = re.compile(r'^-|^#|^\.|^agn|^wme|^https?:|^[a-z-]+:[^ ]*$')
# mots anglais / techniques / abreviations metier a ignorer
IGNORE = set('''div span input button label select option br b i em style class id
data value type text number checkbox color file json geojson url href src px em
rem flex grid none auto hidden block inline center left right top bottom
GM_xmlhttpRequest connect grant WME SDK API POI RPP HN INSEE EB LIM CART GIR
localStorage IndexedDB Tampermonkey GreasyFork GitHub Waze
lat lon lonLat bbox zoom zoomLevel segmentId venueId streetId cityId
ok nb id px and the for with from this that then true false null undefined
Av Bd Bld Blvd Bvd Rte Rt Ch Pl Imp All Sq Fbg St Ste
com nom code label ring rattache insee agglo sansAgglo traites
a de du des le la les un une et ou en au aux par pour sur dans avec sans
est sont ne pas plus que qui quoi dont si il elle on se son sa ses ce cet
cette ces mais donc or ni car y tout tous toute toutes rien
non oui via etc cf ex vs
segment segments rue rues route routes ville villes commune communes
polygone polygones sommet sommets point points ligne lignes zone zones
nom noms carte cartes case cases bouton boutons onglet onglets
liste listes fichier fichiers dossier ligne colonne
script scripts version niveau niveaux couleur couleurs
maximal minimal total partiel local global
grossiers alignees'''.split())

src = io.open('WME-Naming-Auditor.user.js', encoding='utf-8').read()
mots = Counter()
exemples = {}
for num, ligne in enumerate(src.split('\n'), 1):
    s = ligne.lstrip()
    if s.startswith('//') or s.startswith('*') or s.startswith('/*'):
        continue
    if re.search(r'=\s*/|new RegExp|\.test\(', ligne):
        continue
    for m in RE_LITTERAL.finditer(ligne):
        txt = m.group(1) if m.group(1) is not None else m.group(2)
        if not txt or len(txt) < 4 or RE_TECH.match(txt.strip()):
            continue
        # on retire les balises et les interpolations : ce n'est pas du texte
        clair = re.sub(r'<[^>]*>|\$\{[^}]*\}', ' ', txt)
        for w in re.findall(r'[A-Za-z]{4,}', clair):
            if w in IGNORE or w.lower() in IGNORE:
                continue
            mots[w.lower()] += 1
            exemples.setdefault(w.lower(), (num, clair.strip()[:70]))

with io.open('tools/mots-restants.txt', 'w', encoding='utf-8') as f:
    f.write('Mots de 4+ lettres sans accent dans le texte visible (%d distincts)\n\n'
            % len(mots))
    for w, n in mots.most_common():
        num, ex = exemples[w]
        f.write('%-22s x%-3d  L%-6d %s\n' % (w, n, num, ex))
print('%d mots distincts -> tools/mots-restants.txt' % len(mots))
