# -*- coding: utf-8 -*-
"""
Passe MANUELLE : corrections que `accentuer.py` refuse de faire parce qu'elles
demandent le contexte grammatical. Chaque paire a ete revue a la main.

Distinctions qui ont guide ces choix :
  - participe passe  -> accent final : « Panneau releve » -> « Panneau relevé »
  - imperatif        -> PAS d'accent final : « charge un fichier » reste
    « charge » (imperatif de charger), « trace-les » reste « trace-les »
  - « Verifie » PREND un accent, mais sur la premiere syllabe (ve-ri-fie), pas
    sur la terminaison : « Vérifie »
  - « a » -> « à » seulement quand c'est la preposition, jamais le verbe avoir

Remplacements LITTERAUX et EXACTS, pas de mots isoles : c'est ce qui rend la
passe verifiable et sans effet de bord.

Usage : python tools/accents-manuels.py --dry | python tools/accents-manuels.py
"""
import io, sys

# (avant, apres) — l'ordre compte : les chaines longues d'abord.
PAIRES = [
    # ── participes passes ────────────────────────────────────────────────────
    ("Panneau releve (rien a confronter)", "Panneau relevé (rien à confronter)"),
    ("appel refuse", "appel refusé"),
    ("délai depasse", "délai dépassé"),
    (" — appel direct bloque par WME ; ", " — appel direct bloqué par WME ; "),
    ("WME a refuse l", "WME a refusé l"),
    ("Releve interrompu.", "Relevé interrompu."),
    ("Aucun panneau EB10 / EB20 releve dans cette commune.",
     "Aucun panneau EB10 / EB20 relevé dans cette commune."),
    ("Aucun polygone trace : rien a confronter pour l",
     "Aucun polygone tracé : rien à confronter pour l"),
    ("Aucun panneau releve : rien a proposer. ",
     "Aucun panneau relevé : rien à proposer. "),
    ("panneau(x) releve(s) ", "panneau(x) relevé(s) "),
    ("Releve peut-être incomplet", "Relevé peut-être incomplet"),
    ("Aucun polygone cree.", "Aucun polygone créé."),
    ("polygone(s) cree(s)", "polygone(s) créé(s)"),
    ("trace inexploitable", "tracé inexploitable"),
    ("Le polygone trace est entièrement HORS de ", "Le polygone tracé est entièrement HORS de "),
    ("trace annule ou échoué", "tracé annulé ou échoué"),
    ("outil desactive.", "outil désactivé."),
    ("Territoire indetermine : analyse en attente.", "Territoire indéterminé : analyse en attente."),
    ("nom de rue indetermine", "nom de rue indéterminé"),
    ("territoire indetermine : impossible de garantir",
     "territoire indéterminé : impossible de garantir"),
    ("numéros non charges par WME malgre le cadrage", "numéros non chargés par WME malgré le cadrage"),
    ("segment(s) non charge(s) par WME malgre le cadrage", "segment(s) non chargé(s) par WME malgré le cadrage"),
    ("sans agglomération (declare)", "sans agglomération (déclarée)"),
    ("rien n", "rien n"),   # neutre, garde-fou d'ordre
    ("rien n\\'a ete modifie.", "rien n\\'a été modifié."),
    ("Aucun contour charge. ", "Aucun contour chargé. "),
    ("sélection des POI creees impossible", "sélection des POI créées impossible"),
    ("segment(s) ignore(s), verrouille(s) au-dessus de ton niveau",
     "segment(s) ignoré(s), verrouillé(s) au-dessus de ton niveau"),
    ("les corrections proposees", "les corrections proposées"),
    ("Aucun écart detecte.", "Aucun écart détecté."),
    ("Rien ne sera enregistre :", "Rien ne sera enregistré :"),
    ("contours charges automatiquement", "contours chargés automatiquement"),
    (" charges automatiquement — <b>", " chargés automatiquement — <b>"),
    ("Trace grossier, a ajuster aux poignees.", "Tracé grossier, à ajuster aux poignées."),
    ("Ces traces sont grossiers", "Ces tracés sont grossiers"),
    ("Aucun trace propose — <b>trace les ", "Aucun tracé proposé — <b>trace les "),
    ("est rattache d", "est rattaché d"),
    # ── imperatifs et presents : PAS d'accent final, mais parfois un accent interne
    ("Verifie que le trace englobe bien les habitations de ",
     "Vérifie que le tracé englobe bien les habitations de "),
    ("verifie qu", "vérifie qu"),
    ("Verifie ou cree-la a la main, puis relance.", "Vérifie ou crée-la à la main, puis relance."),
    ("le script ne cree pas de commune.", "le script ne crée pas de commune."),
    ("La carte se deplace le temps du balayage, puis revient a sa vue.",
     "La carte se déplace le temps du balayage, puis revient à sa vue."),
    ("Deplace-toi sur ta zone : le département se telecharge tout seul.",
     "Déplace-toi sur ta zone : le département se télécharge tout seul."),
    ("et telecharge ses contours", "et télécharge ses contours"),
    ("Ces segments se declarent en agglomération", "Ces segments se déclarent en agglomération"),
    ("Recupere les panneaux EB10 / EB20", "Récupère les panneaux EB10 / EB20"),
    ("Charge les contours a la main (sélecteur de départements ci-dessus), ",
     "Charge les contours à la main (sélecteur de départements ci-dessus), "),
    ("Coche un département ci-dessus, ou charge un fichier GeoJSON.",
     "Coche un département ci-dessus, ou charge un fichier GeoJSON."),
    ("WME ne les charge qu", "WME ne les charge qu"),
    ("reessaie", "réessaie"),
    # ── preposition « a » -> « à » (verifiee une par une)
    ("a ECARTER pour les contours", "à ÉCARTER pour les contours"),
    ("alignees pour deviner un contour : trace-les a la main, les panneaux ",
     "alignées pour deviner un contour : trace-les à la main, les panneaux "),
    ("ou alignees le long des routes.", "ou alignées le long des routes."),
    (" a partir de ", " à partir de "),
    ("s\\'applique a toute la voie", "s\\'applique à toute la voie"),
    ("Zoome a 14 ou plus sur la commune", "Zoome à 14 ou plus sur la commune"),
    ("⚠ a tracer", "⚠ à tracer"),
    # ⚠️ Ce texte vit dans un attribut en guillemets DOUBLES : l'apostrophe n'y
    # est pas echappee, contrairement aux chaines en apostrophes simples.
    ("un segment a cheval est rattache d'office a un cote. En dessous, il est signale comme a couper.",
     "un segment à cheval est rattaché d'office à un côté. En dessous, il est signalé comme à couper."),
    ("le choix sera demande a la correction", "le choix sera demandé à la correction"),
    ("a passer en POI résidentiel", "à passer en POI résidentiel"),
    ("adresse a saisir a la conversion", "adresse à saisir à la conversion"),
    ("du bon cote,", "du bon côté,"),
    ("rien a confronter", "rien à confronter"),
    ("a trancher", "à trancher"),
    ("(01 a 95, 2A, 2B, 971…)", "(01 à 95, 2A, 2B, 971…)"),
    ("au-dela de laquelle", "au-delà de laquelle"),
    # ── divers
    ("interrompu par l\\'éditeur", "interrompu par l\\'éditeur"),
    ("aucune commune exploitable (nom introuvable dans les propriétés)",
     "aucune commune exploitable (nom introuvable dans les propriétés)"),
    ("Ou et comment les écarts se voient", "Où et comment les écarts se voient"),
    ("Ou voir les resultats", "Où voir les résultats"),
    ("Ou voir les résultats", "Où voir les résultats"),
    ("Ce que l\\'analyse regarde", "Ce que l\\'analyse regarde"),
    ("Ou saisir une autre adresse", "Ou saisir une autre adresse"),
    ("plusieurs numéros de route sur le segment", "plusieurs numéros de route sur le segment"),
    ("Cartouche seul (nommage bon)", "Cartouche seul (nommage bon)"),
    ("A couper — entrée agglo", "À couper — entrée agglo"),
    ("A couper — limite communale", "À couper — limite communale"),
    ("Etiquette (repérage seul)", "Étiquette (repérage seul)"),
    ("Editer les sommets", "Éditer les sommets"),
    ("Etat de SA base", "État de SA base"),
]


def main():
    dry = '--dry' in sys.argv
    src = io.open('WME-Naming-Auditor.user.js', encoding='utf-8').read()
    faits, absents = [], []
    for avant, apres in PAIRES:
        if avant == apres:
            continue
        n = src.count(avant)
        if n == 0:
            absents.append(avant)
            continue
        src = src.replace(avant, apres)
        faits.append((n, avant, apres))
    with io.open('tools/accents-manuels-rapport.txt', 'w', encoding='utf-8') as f:
        f.write('APPLIQUES (%d)\n\n' % len(faits))
        for n, a, b in faits:
            f.write('x%-3d %s\n  -> %s\n' % (n, a, b))
        f.write('\n\nNON TROUVES (%d) — a verifier\n\n' % len(absents))
        for a in absents:
            f.write('  %s\n' % a)
    if not dry:
        io.open('WME-Naming-Auditor.user.js', 'w', encoding='utf-8',
                newline='').write(src)
    print('appliques : %d / non trouves : %d%s'
          % (len(faits), len(absents), ' (essai a blanc)' if dry else ' (APPLIQUE)'))


main()
