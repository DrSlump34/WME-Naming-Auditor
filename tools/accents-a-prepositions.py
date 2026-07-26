# -*- coding: utf-8 -*-
"""
Passe 3 : « a » -> « à » uniquement quand c'est la PREPOSITION, arbitre a la main.

Laisses volontairement intacts (verbe avoir) :
    « WME a refusé l'enregistrement »   « le script a besoin de lire le pays »
    « si elle n'en a réellement aucune »
"""
import io, sys

PAIRES = [
    ("Tu peux le relancer a la main ci-dessus.", "Tu peux le relancer à la main ci-dessus."),
    ("<b>a corriger aux poignees</b>", "<b>à corriger aux poignées</b>"),
    ("agglomérations a la main</b>", "agglomérations à la main</b>"),
    ("‹sans nom› — a basculer en nom alternatif", "‹sans nom› — à basculer en nom alternatif"),
    ("utile a la recherche)", "utile à la recherche)"),
    ("résidentiels en agglomération (a vérifier)", "résidentiels en agglomération (à vérifier)"),
    ("adresse a choisir a la conversion", "adresse à choisir à la conversion"),
    ("le nom du POI sera demande a la conversion", "le nom du POI sera demandé à la conversion"),
    ("ce qu\\'il sert a dire", "ce qu\\'il sert à dire"),
    ("'a couper sur la limite communale'", "'à couper sur la limite communale'"),
    ("'a couper au panneau d\\'entrée d", "'à couper au panneau d\\'entrée d"),
    ("Saisis le nom a donner ", "Saisis le nom à donner "),
    ("si elle n'en a reellement aucune", "si elle n'en a réellement aucune"),
    ("le choix sera demande a la correction", "le choix sera demandé à la correction"),
    ("calculee, pas relevee", "calculée, pas relevée"),
]


def main():
    dry = '--dry' in sys.argv
    src = io.open('WME-Naming-Auditor.user.js', encoding='utf-8').read()
    faits, absents = 0, []
    for a, b in PAIRES:
        if src.count(a):
            src = src.replace(a, b)
            faits += 1
        else:
            absents.append(a)
    if not dry:
        io.open('WME-Naming-Auditor.user.js', 'w', encoding='utf-8',
                newline='').write(src)
    print('appliquees : %d / %d' % (faits, len(PAIRES)))
    for a in absents:
        print('  NON TROUVE : %s' % a[:70])


main()
