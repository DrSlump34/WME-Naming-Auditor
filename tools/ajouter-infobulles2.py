# -*- coding: utf-8 -*-
"""Infobulles, 2e serie : elements construits en JS (donc hors du HTML statique)
et les cases « tableau / carte », dont seule une note commune expliquait l'effet."""
import io, sys

PAIRES = [
    ('<select class="agn-sel" id="agn-commune"><option value="">',
     '<select class="agn-sel" id="agn-commune" '
     'title="La commune sur laquelle porte l\'analyse. Celle qui est sous le centre '
     'de la carte est remontée en tête de liste."><option value="">'),
    # cases « ou voir les resultats » : la note au-dessus vaut pour les cinq, une
    # infobulle par case dit ce que CHACUNE change.
    ('<input type="checkbox" id="agn-r-segtable"> tableau',
     '<input type="checkbox" id="agn-r-segtable" '
     'title="Lister les écarts de nommage dans l\'onglet Segments"> tableau'),
    ('<input type="checkbox" id="agn-r-segcarte"> carte',
     '<input type="checkbox" id="agn-r-segcarte" '
     'title="Surligner les segments en écart sur la carte"> carte'),
    ('<input type="checkbox" id="agn-r-adrtable"> tableau',
     '<input type="checkbox" id="agn-r-adrtable" '
     'title="Lister les écarts d\'adressage dans l\'onglet Numérotation"> tableau'),
    ('<input type="checkbox" id="agn-r-adrcarte"> carte',
     '<input type="checkbox" id="agn-r-adrcarte" '
     'title="Marquer les numéros de rue et POI en écart sur la carte : '
     'disque plein pour un numéro hors agglomération, anneau pour un RPP en agglomération"> carte'),
    ('<input type="checkbox" id="agn-r-pancarte"> carte',
     '<input type="checkbox" id="agn-r-pancarte" '
     'title="Afficher les panneaux d\'entrée et de sortie d\'agglomération relevés : '
     'vert dans un polygone, rouge dehors, gris si aucun polygone n\'est tracé"> carte'),
    # nuanciers : construits en boucle
    ("""<label class="agn-sb-col">
            <input type="color" value=\"""",
     """<label class="agn-sb-col" title="Couleur de cette famille d'écarts sur la carte">
            <input type="color" value=\""""),
    # « village rattache » de la liste des polygones (construit par renderAgglos)
    ('<label><input type="checkbox" class="agn-ratt" ${a.rattache ? \'checked\' : \'\'}> village rattaché</label>',
     '<label title="Le nom appliqué devient « Village (Commune) » au lieu du seul nom '
     'de la commune INSEE. Le village est lu sur la City du segment.">'
     '<input type="checkbox" class="agn-ratt" ${a.rattache ? \'checked\' : \'\'}> village rattaché</label>'),
    # case « cette commune n'a aucune agglomeration »
    ('<label class="agn-sansagglo"><input type="checkbox" ${declaree ? \'checked\' : \'\'}>',
     '<label class="agn-sansagglo" title="À cocher seulement si la commune n\'a '
     'RÉELLEMENT aucun panneau d\'agglomération : toute la commune sera alors '
     'analysée comme hors agglomération.">'
     '<input type="checkbox" ${declaree ? \'checked\' : \'\'}>'),
]


def main():
    dry = '--dry' in sys.argv
    src = io.open('WME-Naming-Auditor.user.js', encoding='utf-8').read()
    faits, rates = 0, []
    for a, b in PAIRES:
        n = src.count(a)
        if n == 1:
            src = src.replace(a, b); faits += 1
        else:
            rates.append((n, a))
    if not dry:
        io.open('WME-Naming-Auditor.user.js', 'w', encoding='utf-8',
                newline='').write(src)
    print('appliquees : %d / %d%s' % (faits, len(PAIRES),
                                      ' (essai a blanc)' if dry else ' (APPLIQUE)'))
    for n, a in rates:
        print('  x%d  %s' % (n, a[:80].replace('\n', ' | ')))


main()
