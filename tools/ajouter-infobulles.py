# -*- coding: utf-8 -*-
"""
Chantier n°2 de l'audit : infobulles.

⚠️ Regle suivie : une infobulle n'a d'interet que si elle apprend quelque chose
que le libelle ne dit pas deja. « Annuler », « Terminer », « Precedent » n'en
recoivent donc AUCUNE — du remplissage rendrait les vraies infobulles suspectes.
On explique en priorite : ce qu'une action va REELLEMENT faire, ce qu'une option
change, et ce qui est irreversible.

Remplacements LITTERAUX exacts. Corrige au passage 3 accents oublies, restes
dans des templates imbriques hors de portee des outils d'accentuation.
"""
import io, sys

PAIRES = [
    # ── accents oublies (templates imbriques) ────────────────────────────────
    ('id="agn-r-reset">Couleurs par defaut<', 'id="agn-r-reset">Couleurs par défaut<'),
    ('> village rattache</label>', '> village rattaché</label>'),
    ('id="agn-na-stop">Tout arreter<', 'id="agn-na-stop">Tout arrêter<'),

    # ── fenetre de travail : actions ─────────────────────────────────────────
    ('<button class="agn-btn primary" id="agn-scan" disabled>',
     '<button class="agn-btn primary" id="agn-scan" disabled '
     'title="Analyse le nommage et l\'adressage de toute la commune choisie. '
     'Rien n\'est enregistré : tu reliras chaque correction dans WME.">'),
    ('<button class="agn-tab" data-vue="segments">',
     '<button class="agn-tab" data-vue="segments" '
     'title="Les écarts de nommage des segments (agglomération, cartouches, rédaction)">'),
    ('<button class="agn-tab" data-vue="adresses">',
     '<button class="agn-tab" data-vue="adresses" '
     'title="Les écarts de numérotation : numéros de rue et POI résidentiels">'),
    ('<button class="agn-lien" id="agn-tout">',
     '<button class="agn-lien" id="agn-tout" '
     'title="Déplie ou replie tous les groupes de résultats">'),

    # ── volet des donnees de reference ───────────────────────────────────────
    ('<select class="agn-sel" id="agn-source">',
     '<select class="agn-sel" id="agn-source" '
     'title="D\'où viennent les contours communaux à charger">'),
    ('<input type="search" id="agn-dep-filtre"',
     '<input type="search" id="agn-dep-filtre" '
     'title="Filtre la liste par numéro ou par nom de département"'),
    ('<button class="agn-btn" id="agn-dep-go" disabled>',
     '<button class="agn-btn" id="agn-dep-go" disabled '
     'title="Télécharge les contours des départements cochés (~3 Mo et ~10 s chacun) '
     'et les AJOUTE à ta base, sans effacer les autres">'),
    ('<button class="agn-btn" id="agn-contours">',
     '<button class="agn-btn" id="agn-contours" '
     'title="Charge un fichier GeoJSON de contours communaux. ⚠️ Remplace les contours '
     'en base ; les agglomérations tracées sont conservées">'),
    ('<button class="agn-btn" id="agn-volet-ok">',
     '<button class="agn-btn" id="agn-volet-ok" '
     'title="Referme ce volet et rend la place à la fenêtre de travail">'),
    ('<button class="agn-btn" id="agn-tracer" disabled>',
     '<button class="agn-btn" id="agn-tracer" disabled '
     'title="Dessine à la main, sur la carte, le polygone de l\'agglomération '
     '(double-clic pour fermer le tracé)">'),

    # ── panneau lateral : reglages ───────────────────────────────────────────
    ('<button class="agn-sb-b agn-sb-p" id="agn-rouvrir">',
     '<button class="agn-sb-b agn-sb-p" id="agn-rouvrir" '
     'title="Réaffiche la fenêtre de travail si tu l\'as fermée">'),
    ('<input type="checkbox" id="agn-r-sansadresse">',
     '<input type="checkbox" id="agn-r-sansadresse" '
     'title="Parkings et voies privées sont exclus par défaut : ils n\'ont pas '
     'd\'adressage. Les inclure remonte des écarts de rédaction sur leur nom.">'),
    ('<input type="checkbox" id="agn-r-alt">',
     '<input type="checkbox" id="agn-r-alt" '
     'title="Un nom alternatif en trop est souvent légitime (voie connue sous '
     'plusieurs noms) : désactivé par défaut pour ne pas noyer les vrais écarts.">'),
    ('<input type="checkbox" id="agn-r-surligner">',
     '<input type="checkbox" id="agn-r-surligner" '
     'title="Peint les segments et les points en écart directement sur la carte">'),
    ('<button class="agn-sb-b" id="agn-r-reset"',
     '<button class="agn-sb-b" id="agn-r-reset" '
     'title="Remet les couleurs d\'origine"'),
    ('<input type="checkbox" id="agn-r-zoom">',
     '<input type="checkbox" id="agn-r-zoom" '
     'title="Recentre la carte sur le segment quand tu cliques un écart">'),
    ('<button class="agn-sb-b" id="agn-r-exporter">',
     '<button class="agn-sb-b" id="agn-r-exporter" '
     'title="Écrit un fichier JSON contenant tes polygones et tes communes '
     '« sans agglo », à transmettre à un autre éditeur. Tes coches « traité » '
     'restent personnelles et n\'y sont pas.">'),
    ('<button class="agn-sb-b" id="agn-r-importer-f">',
     '<button class="agn-sb-b" id="agn-r-importer-f" '
     'title="Ajoute les communes d\'un fichier reçu. ⚠️ Tes communes existantes ne '
     'sont JAMAIS écrasées : seules les absentes sont ajoutées.">'),
    ('<input type="text" id="agn-r-url" class="agn-sb-i"',
     '<input type="text" id="agn-r-url" class="agn-sb-i" '
     'title="Adresse https d\'un fichier de partage (les autres protocoles sont refusés)"'),
    ('<button class="agn-sb-b" id="agn-r-importer-u">',
     '<button class="agn-sb-b" id="agn-r-importer-u" '
     'title="Télécharge ce fichier et ajoute les communes qui te manquent">'),

    # ── boites de dialogue ───────────────────────────────────────────────────
    ('<input type="text" id="agn-saisie-nom" placeholder="Nom de la rue…" autocomplete="off">',
     '<input type="text" id="agn-saisie-nom" placeholder="Nom de la rue…" autocomplete="off" '
     'title="Le nom de voie à donner à cette adresse. Il sera écrit tel quel.">'),
    ('<select class="agn-sel" id="agn-saisie-ville">',
     '<select class="agn-sel" id="agn-saisie-ville" '
     'title="Laisse vide pour que chaque numéro prenne la commune où il tombe '
     'géographiquement">'),
    ('<input type="checkbox" id="agn-na-rat">',
     '<input type="checkbox" id="agn-na-rat" '
     'title="Village rattaché : le nom appliqué devient « Village (Commune) » '
     'au lieu du seul nom de la commune INSEE">'),
]


def main():
    dry = '--dry' in sys.argv
    src = io.open('WME-Naming-Auditor.user.js', encoding='utf-8').read()
    faits, absents = 0, []
    for a, b in PAIRES:
        n = src.count(a)
        if n == 1:
            src = src.replace(a, b)
            faits += 1
        elif n == 0:
            absents.append(('ABSENT', a))
        else:
            absents.append(('x%d AMBIGU' % n, a))
    if not dry:
        io.open('WME-Naming-Auditor.user.js', 'w', encoding='utf-8',
                newline='').write(src)
    print('appliquees : %d / %d%s' % (faits, len(PAIRES),
                                      ' (essai a blanc)' if dry else ' (APPLIQUE)'))
    for quoi, a in absents:
        print('  %-10s %s' % (quoi, a[:72]))


main()
