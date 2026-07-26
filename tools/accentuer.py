# -*- coding: utf-8 -*-
"""
Accentuation du TEXTE VISIBLE du userscript.

⚠️⚠️ Regle de surete n°1 : on ne touche QU'AUX LITTERAUX DE CHAINE, jamais au
code. Un automate suit l'etat « dans une chaine / dans du code », parce qu'un
remplacement mot-a-mot casserait tout : « controles » est aussi bien un libelle
affiche (« Controles ») qu'un identifiant (options.controles).

⚠️⚠️ Regle de surete n°2 : le dictionnaire ne contient QUE des formes sans
ambiguite grammaticale. Les participes masculins singuliers en sont exclus (voir
le bloc AMBIGUS_A_LA_MAIN en bas) : deux regressions reelles ont ete attrapees a
l'essai a blanc du 26/07 sur ce point precis.

Usage : python tools/accentuer.py --dry   (rapport seul, rien n'est ecrit)
        python tools/accentuer.py         (applique)
"""
import io, re, sys

FICHIER = 'WME-Naming-Auditor.user.js'

MOTS = {
    # ═══ NOMS COMMUNS (aucune ambiguite grammaticale) ═══
    'agglomeration': 'agglomération', 'agglomerations': 'agglomérations',
    'numero': 'numéro', 'numeros': 'numéros', 'numerotation': 'numérotation',
    'departement': 'département', 'departements': 'départements',
    'reference': 'référence', 'references': 'références',
    'donnees': 'données', 'controles': 'contrôles',
    'fenetre': 'fenêtre', 'fenetres': 'fenêtres',
    'ecart': 'écart', 'ecarts': 'écarts',
    'etiquette': 'étiquette', 'etiquettes': 'étiquettes',
    'peripherique': 'périphérique', 'peripheriques': 'périphériques',
    'abreviation': 'abréviation', 'abreviations': 'abréviations',
    'redaction': 'rédaction', 'resultats': 'résultats',
    'perimetre': 'périmètre', 'reseau': 'réseau', 'serie': 'série',
    'cles': 'clés', 'coeur': 'cœur',
    'entree': 'entrée', 'entrees': 'entrées',
    'apercu': 'aperçu', 'facon': 'façon', 'facons': 'façons',
    'echecs': 'échecs', 'etape': 'étape', 'etapes': 'étapes',
    'criteres': 'critères', 'parametres': 'paramètres',
    'problemes': 'problèmes', 'systeme': 'système',
    'reglages': 'réglages', 'reperage': 'repérage',
    'telechargement': 'téléchargement', 'deplacement': 'déplacement',
    'delai': 'délai', 'etat': 'état',
    # ═══ ADJECTIFS ET PARTICIPES ACCORDES ═══
    # Feminins et pluriels : la forme verbale homographe n'existe pas.
    'tracee': 'tracée', 'tracees': 'tracées',
    'rattachee': 'rattachée', 'rattaches': 'rattachés',
    'residentiel': 'résidentiel', 'residentiels': 'résidentiels',
    'residentielle': 'résidentielle', 'residentielles': 'résidentielles',
    'ferree': 'ferrée', 'ferrees': 'ferrées',
    'privee': 'privée', 'privees': 'privées',
    'surnumeraire': 'surnuméraire', 'surnumeraires': 'surnuméraires',
    'verrouillee': 'verrouillée', 'verrouilles': 'verrouillés',
    'appliquee': 'appliquée', 'appliquees': 'appliquées', 'appliques': 'appliqués',
    'activee': 'activée', 'actives': 'activés',
    'desactivee': 'désactivée', 'desactives': 'désactivés',
    'detectee': 'détectée', 'detectes': 'détectés', 'detectees': 'détectées',
    'indeterminee': 'indéterminée', 'indeterminable': 'indéterminable',
    'reservee': 'réservée', 'reservees': 'réservées',
    'enregistree': 'enregistrée', 'enregistrees': 'enregistrées',
    'enregistres': 'enregistrés',
    'conservee': 'conservée', 'conserves': 'conservés', 'conservees': 'conservées',
    'ecartee': 'écartée', 'ecartees': 'écartées',
    'ajoutee': 'ajoutée', 'ajoutees': 'ajoutées',
    'refusee': 'refusée', 'acceptee': 'acceptée',
    'acceptes': 'acceptés', 'acceptees': 'acceptées',
    'autorisee': 'autorisée', 'autorises': 'autorisés',
    'abimerait': 'abîmerait',
    'resistant': 'résistant', 'resistante': 'résistante',
    'metropolitaine': 'métropolitaine',
    'complete': 'complète', 'completes': 'complètes',
    'derniere': 'dernière', 'dernieres': 'dernières',
    'premiere': 'première', 'premieres': 'premières',
    'entiere': 'entière', 'legitime': 'légitime', 'legitimes': 'légitimes',
    'identifiee': 'identifiée', 'traitee': 'traitée', 'traitees': 'traitées',
    'separee': 'séparée', 'separees': 'séparées',
    'differente': 'différente', 'differentes': 'différentes',
    'necessaire': 'nécessaire', 'necessaires': 'nécessaires',
    'eligible': 'éligible', 'eligibles': 'éligibles',
    'declaree': 'déclarée', 'proposee': 'proposée',
    'creee': 'créée', 'crees': 'créés',
    'supprimee': 'supprimée', 'selectionnee': 'sélectionnée',
    'selectionne': 'sélectionné',
    'chargee': 'chargée', 'chargees': 'chargées',
    'verifiee': 'vérifiée', 'verifiees': 'vérifiées',
    'interrompue': 'interrompue',
    # ═══ INFINITIFS ET ADVERBES (sans ambiguite) ═══
    'verifier': 'vérifier', 'telecharger': 'télécharger', 'reduire': 'réduire',
    'reessayer': 'réessayer', 'deplacer': 'déplacer', 'dezoomer': 'dézoomer',
    'reinstaller': 'réinstaller', 'depasser': 'dépasser', 'deplier': 'déplier',
    'preciser': 'préciser', 'creer': 'créer', 'ecrire': 'écrire',
    'generer': 'générer', 'recuperer': 'récupérer', 'demarrer': 'démarrer',
    'separement': 'séparément', 'deja': 'déjà', 'tres': 'très',
    'apres': 'après', 'memes': 'mêmes',
    # ═══ 2e VAGUE — mots dont l'accent ne depend PAS du contexte ═══
    # Cas interessant : « regle », « repere », « genere » s'ecrivent avec accent
    # AUSSI bien comme nom que comme verbe conjugue — donc sans ambiguite ici.
    'meme': 'même', 'etre': 'être', 'peut-etre': 'peut-être',
    'editeur': 'éditeur', 'editeurs': 'éditeurs', 'edition': 'édition',
    'donnee': 'donnée',
    'regle': 'règle', 'regles': 'règles',
    'francais': 'français', 'francaise': 'française', 'francaises': 'françaises',
    'proprietes': 'propriétés', 'propriete': 'propriété',
    'entierement': 'entièrement', 'entier': 'entier',
    'selecteur': 'sélecteur', 'selection': 'sélection',
    'decoupage': 'découpage', 'decoupee': 'découpée', 'decoupe': 'découpe',
    'interieur': 'intérieur', 'exterieur': 'extérieur',
    'maniere': 'manière', 'manieres': 'manières',
    'caractere': 'caractère', 'caracteres': 'caractères',
    'geometrie': 'géométrie', 'geographique': 'géographique',
    'preferences': 'préférences',
    'repere': 'repère', 'reperes': 'repères',
    'acces': 'accès', 'succes': 'succès', 'progres': 'progrès',
    'resultat': 'résultat', 'numerique': 'numérique',
    'different': 'différent', 'differents': 'différents',
    'present': 'présent', 'presents': 'présents', 'presente': 'présente',
    'precedent': 'précédent', 'precedente': 'précédente',
    'element': 'élément', 'elements': 'éléments',
    'etendue': 'étendue', 'degre': 'degré', 'degres': 'degrés',
    'metre': 'mètre', 'metres': 'mètres', 'kilometre': 'kilomètre',
    'kilometres': 'kilomètres',
    'eventuel': 'éventuel', 'eventuelle': 'éventuelle',
    'eventuellement': 'éventuellement',
    'generalement': 'généralement', 'immediatement': 'immédiatement',
    'precisement': 'précisément', 'probleme': 'problème',
    'modele': 'modèle', 'modeles': 'modèles',
    'annulee': 'annulée', 'fleche': 'flèche',
    'deuxieme': 'deuxième', 'troisieme': 'troisième',
    'voila': 'voilà', 'ci-apres': 'ci-après',
    'evite': 'évite', 'eviter': 'éviter',
    'reussie': 'réussie', 'echoue': 'échoué',
    'incomplet': 'incomplet', 'incomplete': 'incomplète',
    'exige': 'exige', 'necessite': 'nécessite',
    'operation': 'opération', 'operations': 'opérations',
    'verification': 'vérification', 'verifications': 'vérifications',
    'numerotees': 'numérotées',
    'grossiere': 'grossière', 'grossieres': 'grossières',
    'hierarchie': 'hiérarchie',
    'unite': 'unité', 'unites': 'unités',
    'securite': 'sécurité',
    'integre': 'intègre', 'integrite': 'intégrité',
    'periode': 'période', 'frequence': 'fréquence',
    'lumiere': 'lumière', 'barriere': 'barrière',
    'arriere': 'arrière', 'derriere': 'derrière',
    'maniere': 'manière',
}

# ⚠️⚠️ VOLONTAIREMENT ABSENTS DU DICTIONNAIRE — a corriger A LA MAIN.
# Ces formes sont ambigues et un dictionnaire ne peut pas trancher sans le
# contexte. Deux regressions reelles attrapees a l'essai a blanc du 26/07 :
#     'ajoute @grant GM_xmlhttpRequest'  ->  'ajouté @grant …'   FAUX (imperatif)
#     'delai depasse'                    ->  'delai dépasse'     il fallait « délai dépassé »
# Concernes : ajoute, applique, active, refuse, accepte, autorise, depasse,
# propose, cree, supprime, charge, telecharge, declare, considere, genere,
# ecarte, conserve, enregistre, reserve, detecte, verifie, identifie, releve,
# trace, deplace, commence, reste, meme, ainsi que « ou » vs « ou » et « a » vs « a ».
AMBIGUS = set()

# Chaines a NE JAMAIS toucher : identifiants, selecteurs, cles de stockage.
# ⚠️⚠️ La regle `^-` est CAPITALE : les noms de calques se construisent par
# concatenation (SCRIPT_ID + '-ecarts'). Accentuer ce fragment renommait le
# calque et cassait le surlignage — regression attrapee a l'essai a blanc.
RE_TECHNIQUE = re.compile(
    r'^-'
    r'|^(#|\.|\w+-)?agn[-\w]*$|^wmeAgglo|^wmeprefs|^wme-|^https?://'
    r'|^[\w.-]+/[\w./-]*$'
    r'|^[A-Za-z_$][\w$]*$'
    r'|^[a-z-]+:[^\s]*$'
)

RE_MOT = re.compile(r'[A-Za-zÀ-ÿ]+')


def applique_mot(m):
    """Remplace un mot en preservant sa casse."""
    mot = m.group(0)
    bas = mot.lower()
    rep = MOTS.get(bas)
    if not rep or bas in AMBIGUS or rep == bas:
        return mot
    if mot.isupper():
        return rep.upper()
    if mot[0].isupper():
        return rep[0].upper() + rep[1:]
    return rep


def traite_chaine(contenu):
    """Accentue le texte d'un litteral, en epargnant ce qui est technique."""
    if RE_TECHNIQUE.match(contenu.strip()):
        return contenu
    morceaux = re.split(r'(\$\{[^{}]*\}|(?:class|id|data-\w+|list|type|accept|'
                        r'autocomplete|style)="[^"]*")', contenu)
    for i in range(0, len(morceaux), 2):
        morceaux[i] = RE_MOT.sub(applique_mot, morceaux[i])
    return ''.join(morceaux)


def traite_ligne(l):
    """Automate : ne modifie que l'interieur des litteraux ' " ` ."""
    s = l.lstrip()
    if s.startswith('//') or s.startswith('*') or s.startswith('/*'):
        return l, 0
    if re.search(r'=\s*/|new RegExp|\.test\(|\.replace\(/', l):
        return l, 0
    out, i, n, modifs = [], 0, len(l), 0
    while i < n:
        c = l[i]
        if c in '\'"`':
            q = c
            j = i + 1
            buf = []
            while j < n:
                if l[j] == '\\':
                    buf.append(l[j:j + 2]); j += 2; continue
                if l[j] == q:
                    break
                buf.append(l[j]); j += 1
            brut = ''.join(buf)
            neuf = traite_chaine(brut)
            if neuf != brut:
                modifs += 1
            out.append(q + neuf + (q if j < n else ''))
            i = j + 1
        elif l.startswith('//', i):
            out.append(l[i:]); break
        else:
            out.append(c); i += 1
    return ''.join(out), modifs


def main():
    dry = '--dry' in sys.argv
    src = io.open(FICHIER, encoding='utf-8').read()
    lignes = src.split('\n')
    total, touchees, apercu = 0, 0, []
    for k, l in enumerate(lignes):
        neuf, m = traite_ligne(l)
        if m and neuf != l:
            total += m
            touchees += 1
            apercu.append((k + 1, l.strip(), neuf.strip()))
            lignes[k] = neuf
    with io.open('tools/accents-rapport.txt', 'w', encoding='utf-8') as r:
        r.write('Lignes modifiees : %d - chaines touchees : %d\n\n' % (touchees, total))
        for num, av, ap in apercu:
            r.write('L%d\n  - %s\n  + %s\n' % (num, av, ap))
    if not dry:
        io.open(FICHIER, 'w', encoding='utf-8', newline='').write('\n'.join(lignes))
    print('lignes modifiees : %d, chaines touchees : %d%s'
          % (touchees, total, ' (essai a blanc)' if dry else ' (APPLIQUE)'))


# ⚠️ Ne s'execute QUE lance directement : `accentuer2.py` importe ce module pour
# son dictionnaire, et cet import ne doit surtout pas reecrire le userscript.
if __name__ == '__main__':
    main()
