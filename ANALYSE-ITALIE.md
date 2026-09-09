# WNA — Portage vers l'Italie · Analyse préalable

**Date** : 2026-09-08 · **Demandeur** : Silvio, Country Coordinator IT

## 🆕 09/09 — LA LISTE DES COMUNI EST ARRIVÉE, ET ELLE A FAIT TOMBER UN DÉFAUT

Silvio a répondu à la **question 1**, celle qui bloquait tout le zonage : **« Comuni ISTAT al
08.09.2026 »**, 7 894 comuni — [le Sheets qu'il
partage](https://docs.google.com/spreadsheets/d/1Lf7gwU6Tpw_H_iQOSOBb7NSwdKg7g7ADGP2F46oBpWc/edit).
Le wiki italien datait encore sa liste du **05.05.2017**. Colonnes : *Regione* · *Unità
territoriale* · *Sigla automobilistica* · **Denominazione in italiano** · **Denominazione altra
lingua**.

⚠️ **ELLE NE PORTE AUCUN CODE ISTAT.** Elle ne peut donc pas *remplacer* openpolis, qui apparie
par `com_istat_code` : elle sert d'**ÉTALON** pour le contrôler. C'est ce qui a été fait, et c'est
ce qui a payé.

### 🔴 Le défaut : le nom SERVI n'est pas le nom que WME PORTE

openpolis nomme **124 comuni dans les deux langues** ; WME n'en porte qu'une — relevé dans
l'éditeur par l'auteur : **WME écrit « Bolzano », openpolis sert « Bolzano/Bozen »**.

Or le nom du contour **est** la ville que WNA propose (`villeAgglo` → `etatCible`) et le témoin de
`poiVilleCommune`. Sans normalisation, **les 116 comuni de la province de Bolzano partaient en
écart**, et le bouton de correction offrait une ville *qui n'existe pas dans WME*. Un pays entier
de faux positifs, sur une province où personne de l'équipe n'édite — donc invisible jusqu'au jour
où un éditeur du Haut-Adige installe le script.

⚠️⚠️ **DEUX SÉPARATEURS, ET UN SEUL SE RECONNAÎT À SA FORME** — c'est tout l'enjeu :

| | Combien | Reconnaissable ? |
|---|---|---|
| **Barre oblique** (`Bolzano/Bozen`) | 116, **toutes** en province de Bolzano | ✅ oui — sur les 7 896 noms servis, **aucun autre comune n'a de slash** |
| **Tiret** (`Sgonico-Zgonik`) | 8 — Trente, Gorizia, Trieste | 🔴 **non** — **60 comuni portent un tiret légitime** (`Gattico-Veruno`, `Pont-Saint-Martin`) |

⇒ Les 8 sont **nommées une à une** (`COMUNI_DOUBLE_NOM`). Une règle de forme « couper au tiret »
aurait réparé 8 comuni et **cassé 60**. ⭐ Et cinq noms **mixtes** —
`Castelbello-Ciardes/Kastelbell-Tschars` — prouvent que la coupe se fait au **slash**, jamais au
tiret : le nom italien contient lui-même un tiret.

⚠️ **La normalisation s'applique au CHARGEMENT *et* à la RESTAURATION.** Les contours déjà en base
portent l'ancien nom, et **personne ne recharge une province qu'il a déjà** : un correctif limité
au téléchargement aurait laissé le défaut chez tous ceux qui l'avaient rencontré. 🔴 Et à la
restauration, avec le référentiel **de ce contour-là** (`referentielDeCommune`), jamais avec le
référentiel courant — c'est le défaut commis deux fois le 08/09.

### ✅ Le contrôle des deux sources, et ce qu'il dit d'openpolis

| | |
|---|---|
| comuni ISTAT au 08.09.2026 | **7 894** |
| comuni servis par openpolis (110 provinces) | **7 896** |
| codes à 6 chiffres | **7 896 / 7 896** |

**openpolis a deux fusions de retard** : `Castegnero` + `Nanto` (VI) y sont encore séparées alors
qu'ISTAT les donne fusionnées en **Castegnero Nanto**, et **Lirio** (PV) a disparu d'ISTAT sans
disparaître des contours. **Rien n'est codé pour ça** : c'est une limite de la source, pas un
défaut du script, et elle touche 3 comuni sur 7 894. À revérifier au prochain passage.

⚡ **`tools/comuni-double-nom.js` régénère la table ET rejoue ce contrôle** — à relancer quand le
CC annonce une liste plus récente. Rien n'a été retapé à la main : `Savogna d'Isonzo-Sovodnje ob
Soči` ne se recopie pas sans faute.

📌 **v2.40.01**, toujours **non publiée**. `tools/test-nom-comune.js` — **74 vérifications**, dont
les 60 tirets légitimes qui doivent rester intacts. Éprouvé par **mutation** : supprimer la coupe,
couper au tiret, brancher la normalisation sur la France, ou l'ôter de la restauration — **les
quatre font tomber le harnais**.

### ✅ VÉRIFIÉ DANS WME, DANS LES QUATRE ZONES BILINGUES (09/09)

La normalisation retient le **nom italien**. Ce n'était vérifié que sur Bolzano ; l'auteur a relevé
les quatre autres directement dans l'éditeur, une par régime linguistique :

| Zone | Ce qu'openpolis sert | **Ce que WME porte** |
|---|---|---|
| Bolzano — chef-lieu | `Bolzano/Bozen` | **Bolzano** ✅ |
| Ortisei — val Gardena, **ladin** | `Ortisei/St. Ulrich` | **Ortisei** ✅ |
| Silandro — Vinschgau, **germanophone** | `Silandro/Schlanders` | **Silandro** ✅ |
| San Giovanni di Fassa — Trentin, **ladin** | `San Giovanni di Fassa-Sèn Jan` | **Vigo, San Giovanni di Fassa** ✅ |
| Sgonico — Karst, **slovène** | `Sgonico-Zgonik` | **Sgonico** ✅ |

⇒ **WME porte l'italien partout**, y compris là où la langue majoritaire ne l'est pas. Les deux
formes de composition (slash et tiret) sont couvertes, et le sélecteur de commune affiche bien
« Bolzano ».

⭐⭐ **Et le val di Fassa a donné mieux qu'une confirmation : un cas qui CROISE les deux
mécaniques.** « Vigo, San Giovanni di Fassa » est une **frazione** au format italien, portée par un
comune à **double nom**. Il faut que `nomComuneIT` ramène le comune à « San Giovanni di Fassa »
*et* que `villeAgglo` reconnaisse la virgule, sinon WNA réclamerait de remplacer une valeur déjà
juste. C'est désormais le cas **59 bis / 59 ter de `tools/test-italie.js`** — un relevé de terrain
vaut mieux qu'un exemple de wiki.

✅ **LES GRANDES PLACES — TRANCHÉ PAR SILVIO LE 09/09** : *« Pour rotatorie on a choosy la
suggestion : 1 »*. Les *piazze* tracées en anneau ressemblent à un giratoire mais portent
légitimement un nom et des numéros civiques ; sur les trois voies proposées, il retient celle où
**le script signale toujours et l'éditeur ignore le cas**.
⇒ **Il n'y a rien à coder** — mais il fallait l'ÉCRIRE, dans le code comme ici, sinon ce bruit
finira par être « corrigé » par quelqu'un qui le prendra pour un défaut. ⚠️ Et surtout : **ne pas
ajouter d'exception sur le préfixe « Piazza »** tant que la Wazeopedia italienne ne la porte pas —
c'était la condition explicite de la solution 2, et la doctrine du projet est que le script
applique la norme, il ne la crée pas.

## 🌍 09/09 — LES QUATRE COMBINAISONS, ET OÙ EN EST LA TRADUCTION

Objectif posé par l'auteur : **Silvio doit pouvoir utiliser WNA en Italie en italien avec les
règles italiennes, en France en italien avec les règles françaises — et un Français en France avec
les règles françaises, en Italie en français avec les règles italiennes.** Les quatre cases, pas
deux.

| | Règles FR | Règles IT |
|---|---|---|
| **En français** | ✅ d'origine | ✅ depuis la v2.42 — l'aide suit le référentiel |
| **En italien** | 🚧 interface ✅, aide en cours | 🚧 interface ✅, aide en cours |

**Ce qui est acquis** : le référentiel et la langue sont deux axes séparés (v2.42), la traduction
par bloc fonctionne (v2.43), l'interface courante est traduite (138 clés), et l'aide **dit le vrai
pour chaque pays**, quelle que soit la langue.

**Ce qui reste** : les mots de l'aide. Mesure du 09/09 par `tools/couverture-i18n.js` —
**206 blocs sur 229**, soit ~30 Ko :

| Section | Blocs | Caractères |
|---|---|---|
| `regles` (les deux pays) | 67 | 9 476 |
| `controles` | 29 | 4 083 |
| `contours` | 22 | 2 722 |
| `agglo` | 18 | 3 292 |
| `limites` | 18 | 2 515 |
| `numerotation` · `poi` | 30 | 4 583 |
| `partage` · `selzone` | 18 | 3 425 |
| `resultats` · `analyse` · `pays` | 9 | 179 |
| **`demarrage`** | **0** | ✅ fait |

⚠️ **Le compte porte sur les DEUX référentiels** : un éditeur italien qui aide en France lit l'aide
**française** en italien. Les 124 blocs communs ne sont comptés qu'une fois.

🔴 **Une section mentait depuis la v2.40** : « Pourquoi la France uniquement » disait encore
*« le script se ferme hors de France »* — la première chose qu'un testeur italien serait allé lire.
Elle est devenue « Les pays pris en charge », construite à partir de `paysServis()`, et elle
explique la distinction référentiel / langue qui fonde tout le portage.

## 🗣️ 09/09 — L'i18n : traduire À LA SORTIE, et non 1 100 fois

**Le constat qui a tout décidé** : la mécanique de langue existait depuis la v2.40, mais elle
n'était branchée que sur **les libellés de contrôle**. Le reste du panneau — ~1 100 chaînes — ne
passait par `tr()` nulle part.

**L'alternative écartée** était d'envelopper ces 1 100 chaînes une à une dans des templates HTML :
c'est la même passe mécanique que l'accentuation de la v2.05, dont `tools/README.md` liste les
régressions **silencieuses**, et un texte oublié dans la passe ne se voit jamais — il reste
simplement en français.

⇒ **`traduireDOM` lit le DOM produit et remplace ce que le dictionnaire connaît** ;
`observerTraduction` fait de même pour tout ce qui y arrive ensuite, sans quoi l'italien
disparaîtrait au premier des 59 `innerHTML =`. Traduire, désormais, c'est **ajouter une ligne au
dictionnaire**.

🔴 **PAS DE BOUCLE POSSIBLE** : on n'observe que `childList`, et la fonction ne touche qu'à des
`nodeValue` et des attributs — ses écritures ne produisent aucune mutation observée. Ce n'est pas
une précaution, c'est une **propriété**, et `tools/test-traduire-dom.js` la vérifie (cas 10) sur un
DOM de papier, sans navigateur ni dépendance.

### 🔴🔴 Et ce que ce choix a sauvé sans qu'on l'ait prévu

`e.champ` n'est pas qu'un libellé affiché : il est **comparé à des valeurs françaises en six
endroits du moteur de correction** (`=== 'principal'`, `!== 'alt manquant'`, `=== 'rédaction
(dictionnaire FR)'`, `/^ville interdite \(principal\)/`). Un `tr()` posé sur `champ:` aurait laissé
l'italien s'afficher correctement **pendant que les boutons de correction cessaient de mordre** —
en silence, et pour les seuls éditeurs italiens. Traduire à la sortie ne touche que le DOM :
l'objet garde sa clé.

### Le périmètre livré — un lot qui se RELIT

| Lot | Clés |
|---|---|
| Libellés de contrôle, tous référentiels | **30 / 30** |
| Ossature du panneau (onglets, boutons, volet, infobulles) | 40 |
| Libellés d'écart, formes en « (alt) » comprises | 48 |
| Messages d'état | 9 |
| **Total** | **138 clés, 0 orpheline** |

⏳ **Restent en français, et c'est un choix** : l'aide (mode d'emploi) et le **guidage pas à pas**
(168 chaînes). Le lot doit rester relisible par Silvio — 1 100 chaînes ne se relisent pas.
⚠️ Restent aussi en français **les messages composés avec une valeur** (« Sélection impossible : »
+ la cause) : leur texte final change à chaque appel, aucune clé ne peut le désigner.

### ⚠️ Le harnais i18n s'est corrigé trois fois — et jamais dans le sens qu'on croit

Une **mutation** a démasqué un contrôle décoratif : *« en français, rien n'est traduit »* restait
vert même après suppression de la garde `LANGUE === 'fr'` — ce qui le faisait passer était
l'absence de `TEXTES.fr`, pas la garde. Puis le contrôle « aucune clé orpheline » a produit **deux
faux refus** : il ignorait les libellés composés (`'abreviation' + ou`), et il comparait une valeur
**décodée** à un source **encodé** (`'limite d\'agglo'`). ⇒ Un contrôle plus strict que la fonction
qu'il surveille ne protège de rien : il force à écrire des clés fragiles.

⏳ **Ce qui reste ouvert chez Silvio** : les *cartelli bianchi* (recherche en cours de son côté).
✅ **La question 7 — le nom en région bilingue — n'a plus besoin de lui** : l'éditeur a tranché à
sa place, WME porte l'italien dans les quatre zones.

## ⏸️ ÉTAT AU 08/09 AU SOIR — v2.40.00, non publiée

| | |
|---|---|
| ✅ Garde-fou généralisé | il demande « quel référentiel sert ce territoire », plus « est-ce la France » |
| ✅ 19 constantes nationales versées | le moteur ne lit plus **aucune** globale française |
| ✅ `REFERENTIELS.IT` écrit | vocabulaire, types, 14 contrôles ; 9 contrôles FR volontairement absents |
| ✅ `tools/test-italie.js` | **65 vérifications** rejouant les **exemples du wiki** |
| ✅ Fautes d'écriture IT | sigles sans espace, dates en chiffres romains |
| ✅ Format des *frazioni* | `nomefrazione, nomecomune` |
| ✅ Codes ISTAT à 6 chiffres | le partage communautaire fonctionne |
| ✅ **Chargement des contours** | source openpolis, 110 provinces, **chargement AUTOMATIQUE sans réseau** |
| ⏳ 6 questions à Silvio | *rotatorie* tranché ; message prêt sur les places |
| ✅ **`fari`** | `flagAttributes.headlights`, relevé en live et codé |
| ✅ Panneaux EB10/EB20 | **désactivés en Italie** : aucune source, le chemin entier disparaît |
| ⏳ Ordinaux `1ª` / `1º` | trop ambigu pour être automatisé — question à Silvio |
| ⏳ i18n | **21 clés** sur ~1 032 chaînes ; mécanique posée et éprouvée |
| ✅ **Essai réel CONCLUANT** | 08/09 à Bergamo — voir ci-dessous |

⛔ **NE PAS PUBLIER** : la description de l'en-tête dit encore « FRANCE UNIQUEMENT », et
c'est volontaire tant que les questions restent ouvertes et que rien n'a été essayé en vrai.

**995 vérifications sur 30 fichiers, 0 échec.**

### ✅ Essai réel du 08/09 — Bergamo, v2.40.00 dans Tampermonkey

Verdict de l'auteur, carte sur Bergamo : **« Tout est en français, mais il considère les
règles italiennes. »**

⭐ **C'est exactement le comportement visé, et il valide la distinction posée le matin** :
la LANGUE suit l'éditeur (son WME est en français), le RÉFÉRENTIEL suit le territoire
(la carte est en Italie). Deux axes indépendants — un Français qui audite l'Italie
applique les règles italiennes énoncées en français.

🔴 **Trois défauts que 933 vérifications vertes n'avaient pas vus.** Aucun harnais ne
pouvait les attraper : ils montent tous le moteur avec **un référentiel figé**. C'est la
*traversée de frontière* qui manquait, et elle ne s'observe qu'en vrai.

1. Les options des contrôles d'un nouveau pays n'étaient **jamais initialisées** ⇒
   `undefined`, donc *falsy*, donc **aucun contrôle italien ne s'exécutait** — pendant
   que les cases affichées décrivaient un autre pays.
2. La bascule n'était **jamais déclenchée** : `choisirReferentiel` ne partait que de
   `scan()`, qui exige une commune, qui exige des contours. Sans contours ISTAT, aucune
   analyse ⇒ aucune bascule, indéfiniment.
3. Il a fallu **deux** correctifs : rendre la bascule rejouable ne servait à rien tant
   qu'elle n'était pas déclenchée. Le premier essai a montré le second défaut.

### La chaîne complète, éprouvée en vrai (Bergamo puis Rome)

`contours chargés → commune trouvée → référentiel italien → règles italiennes, en français`

**Neuf défauts que les 900+ vérifications vertes n'avaient pas vus.** Aucun harnais ne pouvait
les attraper : ils montent le moteur avec un référentiel figé et **ne construisent jamais
l'interface réelle**. C'est exactement le trou que les essais comblent.

| # | Défaut | Ce qu'il produisait |
|---|---|---|
| 1 | Options du nouveau pays jamais initialisées | **aucun** contrôle italien ne s'exécutait |
| 2 | Bascule jamais **déclenchée** (partait de `scan()`) | référentiel français devant une carte italienne |
| 3 | Section Contours non repeinte | 101 départements français en Italie ⇒ **rien à charger** |
| 4 | Nœud **déplacé** cherché par sélecteur | libellés figés alors que la grille, elle, se mettait à jour |
| 5 | 🔴 **Le cercle** : pays déduit du référentiel actif | boucle fermée dès que des contours étaient chargés |
| 6 | 🔴 `o` au lieu de `q` dans `buildReglages` | `ReferenceError` ⇒ **tout le panneau amputé, en silence** |

⭐ Les leçons qui dépassent le portage :
- une **exception dans un constructeur d'interface** ne casse pas la ligne fautive, elle casse
  tout ce qui suit — et l'écran montre une fonctionnalité disparue, pas une erreur ;
- un **nœud déplacé** se garde par sa référence, jamais par son chemin ;
- une règle trouvée pour **un** cas doit être posée **partout** où elle s'applique (défaut n° 3
  était le n° 1 non généralisé) ;
- **corriger n'est pas vérifier** : il a fallu deux correctifs successifs pour la bascule, le
  premier ayant seulement rendu rejouable ce qui n'était pas déclenché.

### ⚡ Relevé du 08/09 — l'attribut « obbligo accensione dei fari »

Mesuré **dans WME**, pas deviné : les traductions de l'éditeur donnent le nom du champ
sans qu'aucun segment n'ait besoin d'être chargé.

```
I18n.translations.fr.objects.segment.flag_fields.headlights → « Allumez vos feux »
I18n.translations.fr.edit.segment.fields.headlights         → « Allumez vos feux »
```

⇒ Le champ s'appelle **`headlights`**, et c'est un **flag field**. Sa famille complète :

| Drapeau | Libellé FR |
|---|---|
| `beacons` | Avec balises |
| `fwdSpeedCamera` | Radar tronçon A→B |
| **`headlights`** | **Allumez vos feux** |
| `nearbyHOV` | Voie VOM à proximité |
| `revSpeedCamera` | Radar tronçon B→A |
| `tunnel` | Tunnel |
| `unpaved` | Non bitumée |

✅ **RÉSOLU le 08/09, et le relevé a évité un désastre.** Le SDK expose
`segment.flagAttributes`, un objet de booléens. `headlights` n'existe **ni** comme attribut
direct de l'objet SDK, **ni** dans le modèle brut (où les drapeaux vivent dans un masque
`flags`). Écrire `seg.headlights` — le nom pourtant exact — aurait rendu `undefined` sur
**chaque** segment : « feux manquants » sur toute la commune, avec l'aplomb d'un contrôle qui
marche. ⇒ **Le nom d'un champ ne dit pas comment on le lit.**

### Les défauts trouvés *en portant* — aucun n'aurait fait de bruit

| Défaut | Ce qu'il aurait produit |
|---|---|
| `codeInseeValide` à 5 caractères | **tout** polygone italien partagé rejeté, en silence |
| `signTypeRocade: null` vs `signType: null` | **tout** segment sans cartouche déclaré « rocade, certain » |
| `formatVillage` en dur | une frazione **déjà juste** signalée, puis abîmée par sa « correction » |
| `detecterPays` → `'France'` ×2 | règles françaises appliquées en Italie |
| Regex FR lues par le moteur | `SS12` pris pour un nom de rue, logigramme faussé |
| `RE_NOM_COMPOSITE` FR | `A4 – Bergamo` (376316) amputé en `Bergamo` **avant** raisonnement |

---

⚡ **Le sommaire officiel est « Pagina principale » (376308)**, désigné par Silvio lui-même.
Il porte un journal des modifications (« Ultime modifiche », dernière entrée **07/04/2025**) et
**liste 54 pages — dont 7 que la vue par catégorie ne montre pas**. Deux d'entre elles ont
répondu à deux de mes questions. ⇒ **Partir du sommaire, jamais de la liste de catégorie.**

---

## 0. Méthode, et pourquoi elle compte ici

Le wiki italien a été **rapatrié en local** (13 sujets, ~3 300 lignes) depuis l'API Discourse,
et non lu au fil de l'eau.

🔴 **L'extraction marque explicitement les règles ABROGÉES.** Le premier passage les rendait en
texte normal — et le wiki italien en contient **82 blocs barrés** rien que dans « Abbreviazioni
del TTS » (toute la table des chiffres romains à apostrophe : `IV'` → *Quarto*). Sans ce
marquage, WNA aurait appliqué 82 règles mortes.

⚠️⚠️ **Le wiki italien emploie TROIS conventions de péremption, aucune systématique** :

| Convention | Où | Ce qu'elle emporte |
|---|---|---|
| `<s>` HTML barré | 376274 | 82 blocs — les ordinaux à apostrophe |
| `~texte~` tilde littéral | 376292 (l. 9, 101, 103) | **les rampes en sortie** |
| Note en clair | 376292 (l. 61) | « *questo esempio non è più valido* » |

⇒ **On ne peut pas déterminer mécaniquement ce qui fait foi.** Toute règle codée d'après ce
wiki doit être confirmée par Silvio. C'est la raison d'être du § 6.

---

## 1. Le verdict d'architecture : le moteur n'est pas à toucher

La notion pivot italienne est **la même** qu'en France :

> « *Il City Boundary NON coincide con il confine del comune ma solo della/e relativa/e
> area/e urbana/e, delimitata/e dai Segnali di località e localizzazione.* »

`centro abitato` ≡ agglomération · `cartelli bianchi` ≡ EB10/EB20 · zone bâtie ≠ contour communal.

⚠️ **Le City Boundary de WME ne peut PAS servir de référentiel d'audit** : il est *formé par les
segments eux-mêmes* (« *i segmenti con impostato il valore City nel PN concorrono alla
formazione* »). S'en servir serait circulaire — un segment mal nommé élargirait la zone qui le
déclarerait ensuite conforme. Il reste donc un polygone à tracer, exactement comme en France.

### ⭐⭐⭐ Le logigramme C/R/H vaut tel quel pour l'Italie

Les cas de `expectedNaming` ont été rejoués contre la table récapitulative italienne :

| Cas WNA | Règle italienne (table officielle) | |
|---|---|---|
| C1 · nom + numéro en zone | `dentro` SS/SR/SP : PN = via comunale + Comune, AN = sigla + Comune | ✅ |
| C2 · nom seul en zone | `dentro` Strade : PN = via comunale + Comune | ✅ |
| C4 · numéro seul en zone | « *non avesse il nome locale, nel PN si indica solamente la sigla* » | ✅ |
| H6 · numéro seul hors zone | `fuori` : PN = SS42 / No city · AN = … / Comune | ✅ |
| H7 · nom seul hors zone | `fuori` : PN = Via Puccini / No city · AN = Via Puccini / San Giuliano Terme | ✅ |
| H9 · numéro + nom hors zone | `fuori` : PN = sigla · AN = nom étendu **et** via comunale | ✅ |

⭐ **La ville en alternatif hors zone bâtie — que l'italien exige — est déjà la cible de WNA.**
C'est l'arbitrage du 27/07 (aligner H9 sur H8, sur le signalement de Glenan56) qui l'a
consolidée. Aucune inversion à écrire : `REFERENTIELS.IT` se pose à côté de `FR`, le moteur ne
bouge pas. C'est la 4ᵉ fois sur ce projet qu'un dispositif est réutilisé plutôt que réinventé.

⚠️ Nuance : l'italien met le **nom étendu** en AN (« SS42 del Tonale e della Mendola ») là où
WNA propose la sigle répétée. Le moteur ne peut pas inventer ce nom — la cible reste
atteignable, l'enrichissement est humain. À dire dans l'aide, pas à coder.

---

## 2. Les contrôles, un par un

| Contrôle FR | Sort en Italie | Ce qu'il faut |
|---|---|---|
| `nommageZone` | ✅ **tel quel** | rien |
| `majuscule` | ✅ **tel quel** | « *la prima lettera di ogni nome di via… maiuscolo* » |
| `bretelles` (jamais de ville) | ✅ **tel quel** | « *Ramp… SEMPRE senza città* » |
| `cartouches` | ⚠️ à relever | les `signType` italiens (le relevé FR valait pour le pays 73). 🔴 Règle IT : « *gli scudetti non vanno mappati sulle rampe, ma sulle relative svolte* » — et **un seul scudetto par segment** |
| `abreviations` | 🔧 à réécrire | interdites : `V.le`, `C.so`, `P.zza`. **Mais `Cav.` est admise** (table TTS) |
| `contractions` | 🔧 à réécrire | même esprit : lettres pointées interdites (`Via G. Garibaldi` ✗) |
| `bretelleForme` | 🔧 à adapter | ⭐ **le chevron `>` est commun aux deux pays** ; forme IT complète ci-dessous |
| `rocades` | 🔧 à adapter | `circ` = *circonvallazione*, + GRA / RA / tangenziali |
| `rails` | 🔧 à adapter | guide *Ferrovie* propre ; ⚠️ les tramways « *non vanno editate* » |
| `voieCommunale` | ⚠️ à revoir | `SC` = *Strada Comunale* existe (table TTS) — la forme abrégée reste à confirmer |
| `nomComposite` | 🔴 **À DÉSACTIVER** | « SS42 del Tonale e della Mendola » est le **nom officiel**, pas une faute |
| `giratoires` | ❓ **question** | le guide *Rotatorie* ne parle que du tracé, jamais du nom |
| `fonctionDirection` | ❓ **question** | pas d'équivalent trouvé |
| dictionnaire de rédaction | 🔴 **absent** | les ~1 430 règles de buchet37 n'ont pas d'équivalent IT |

### Contrôles NEUFS, propres à l'Italie

1. 🎁 **`fari` — l'attribut « obbligo accensione dei fari » sur toute route extra-urbaine.**
   « *su tutte le strade extraurbane della mappa dev'essere presente l'attributo* ».
   WNA sait déjà s'il est hors zone bâtie : le contrôle est trivial et à forte valeur.
2. **Sigles sans espace** : `SS12`, `SP20bis`, `NSA122`, `SS591var`. En Italie l'espace est une
   **faute** (« *in maiuscolo e senza spazi* ») ; `RE_ROUTE` FR le tolère.
3. **Chiffres romains dans les dates** : `Via IV Novembre` → `Via 4 Novembre`.
   ⚠️ Exception unique : `Via 1º Maggio` (caractère `º`, ALT+167).
4. **Ordinaux** : `1ª`, `2ª` (caractère `ª`, ALT+166) — et **non** l'apostrophe, abrogée.
5. **Format des fractions** : `nomefrazione, nomecomune` (virgule + espace).
6. **Régions bilingues** : toponymie italienne en PN, seconde langue en AN.
7. **Types à ne PAS éditer** : tramways, pistes cyclables, sentiers de montagne, allées de parcs,
   voies de copropriété. 🔴 **C'est l'inverse de l'arbitrage FR du 21/07**, où sentiers (5) et
   escaliers (16) restent audités. Champ `typesSansAdresse` — l'architecture le prend en charge.

### La forme des bretelles italiennes — spécification complète

Reconstituée depuis **Denominazione** (376292) **et** *Indicazioni di guida sulle svolte* (376306),
cette dernière portant le standard **en vigueur** qui remplace la règle barrée.

| Situation | Forme attendue |
|---|---|
| Rampe vers Minor / Major Highway | `> Verona` · `> Thiene, Asiago` · `> A4, A21` |
| … avec le nom de la route sur le panneau | `SS42 > Mantova` |
| Entrée au péage depuis la voirie ordinaire | `A4 Verona Sud` · `A4 A21 Brescia Centro` |
| Après le péage, même autoroute | `> Venezia` |
| Après le péage, autoroute différente | `A4 > Venezia` |
| Raccordement / variante | `Raccordo A21` (**seulement** si le panneau le porte) |
| **Sortie non numérotée** | `Uscita Fano` |
| **Sortie numérotée** | `Uscita 17: Jesi Centro` |

⚠️ Le `>` se lit « Direzione » au TTS et **ne s'emploie QUE sur les segments de type Ramp**.
⚠️ Les *Places* d'échangeur et de péage ont leur propre forme (376316) : `A4 – Bergamo`,
`Casello A4 Bergamo`, `Barriera A4 Milano Est` — catégorie `Junction/Interchange`, type Area.

### Symboles normalisés du TTS italien (en vigueur)

`>` Direzione · `/` Barra · `⇗` Controviale di · `¦¦` Corsia preferenziale di (ALT+0166) ·
`[P]` Parcheggio · `[P€]` Parcheggio a pagamento · `dir` Diramazione · `var` Variante ·
`racc` Raccordo · `circ` Circonvallazione · `SGC` Strada di Grande Comunicazione ·
`SC` `SP` `SR` `SS` · `Cav.` Cavaliere

---

## 3. Les données : ce qui ne suivra pas

| Fonction | France | Italie |
|---|---|---|
| Contours communaux | `geo.api.gouv.fr` (service interrogeable) | **openpolis/geojson-italy** — voir § 3 bis |
| Quel département sous les yeux | `geo.api.gouv.fr/communes?lat&lon` | ❌ aucun équivalent → **choix manuel de la province** |
| Pré-tracé depuis les panneaux | `api.wazefrance.com/rs` (jeu du Ministère de l'Intérieur **FR**) | ❌ aucun équivalent connu → **tracé manuel** |

✅ **Le tracé manuel n'est pas un pis-aller** : l'architecture le gère déjà (`sonderPanneaux` rend
`aucun` / `incertain`, ce qui grise le bouton **avec sa raison**), et c'est déjà le quotidien de
l'Hérault (28 % de couverture EB10, mesuré le 28/08).

✅ **Le chargement par fichier GeoJSON existe déjà** (`clesNom` / `clesCode` du référentiel,
outil `Recuperer-Communes.html`).

---

## 3 bis. La source de contours italienne — mesurée le 08/09

**`openpolis/geojson-italy`** — le seul candidat qui remplisse le contrat français.

| Critère | Mesure |
|---|---|
| **Licence** | **CC-BY-4.0** — permissive, **non virale** ✅ |
| Mise à jour | **17/08/2026** (dépôt vivant) |
| Découpage | **119 fichiers par province** + **20 par région** |
| Poids province | 25 Ko → 1 030 Ko, **médiane 271 Ko** (France : ~3 Mo/département) |
| Poids région | 300 Ko → 4 Mo |
| Propriétés | **`name`** et **`com_istat_code`** |
| Codes | **100 % à 6 chiffres** sur 620 communes vérifiées, zéros de tête compris |

🔴 **MAIS SES NOMS NE SONT PAS CEUX DE WME** — mesuré le 09/09 contre la liste ISTAT : **124
comuni y sont nommés dans les deux langues** (`Bolzano/Bozen`), là où WME n'en porte qu'un. Voir le
bloc du 09/09 en tête et `nomComuneIT` : le nom servi passe par une normalisation **avant** de
devenir la ville que le script propose.

⚠️ **La licence était éliminatoire.** L'auteur a écarté `api.wazefrance.com` pour ses contours
parce qu'ils dérivent d'OpenStreetMap (**ODbL, virale**). CC-BY-4.0 est du même ordre que la
Licence Ouverte d'Admin Express : compatible.

**Adressage des fichiers** — le numéro est le code ISTAT **sans zéro de tête** :
```
.../geojson-italy/master/geojson/limits_P_16_municipalities.geojson   → Bergamo, 243 communes
.../geojson-italy/master/geojson/limits_R_20_municipalities.geojson   → Sardaigne, 377 communes
```
🔴 `limits_P_016_...` rend **404** : ne pas padder le code.

### ⚠️ Neuf provinces sont VIDES — et ce n'est pas une panne

`90, 91, 92, 95, 104, 105, 106, 107, 111` renvoient un `GeometryCollection` **vide de 49 octets**
(et non un `FeatureCollection`). Toutes sardes : la Sardaigne a réorganisé ses provinces en 2016.

✅ **Elles sont couvertes par le fichier RÉGION `limits_R_20`** (1,9 Mo, 377 communes), qui porte
**exactement les mêmes clés** — vérifié.

⇒ **Le chargeur doit reconnaître les deux niveaux** et retomber sur la région quand la province
est vide. Un fichier de 49 octets ne doit pas se lire « cette province n'a pas de communes » mais
« ce découpage-là ne la sert pas ».

🔴 **Défaut corrigé grâce à cette mesure** : `clesCode` avait été écrite d'après les noms de
colonnes des **shapefiles** ISTAT (`PRO_COM_T`, `COD_ISTAT`…) — aucune ne correspond aux clés
réellement servies en GeoJSON. **Tout chargement italien aurait échoué**, faute de code de commune.

---

## 4. L'internationalisation

**714 chaînes littérales accentuées, et aucune mécanique de langue dans le code** (mesuré : zéro
occurrence de `i18n`). C'est le plus gros volume du chantier, et le plus mécanique.

**Décision (08/09)** : mécanique extensible à N langues, **deux langues livrées (FR, IT)**.
L'anglais serait un 3ᵉ jeu de 714 chaînes que personne ne relit — on l'ouvre le jour où
quelqu'un le porte.

⚠️ Retour d'expérience WDA : **un dictionnaire i18n se vérifie en l'ÉVALUANT**, pas en le
relisant — 11 clés manquantes y avaient été manquées à l'œil.

---

## 5. L'ordre retenu (08/09)

1. **`REFERENTIELS.IT` d'abord**, interface encore en français → Silvio teste le **fond** tout de
   suite. Raison : les libellés *découlent* des règles ; traduire d'abord, c'est traduire deux fois.
2. L'i18n ensuite, une fois les règles stabilisées.
3. Publication quand les deux tiennent.

---

## 6. Les questions à Silvio

✅ **Deux questions se sont répondues seules** en partant du sommaire officiel plutôt que de la
liste de catégorie :

- ~~Rampes en sortie~~ → *Indicazioni di guida sulle svolte* (376306) porte le standard en
  vigueur. La règle barrée n'a pas été abolie : elle a été **remplacée par une version plus
  complète** (`Uscita Fano` / `Uscita 17: Jesi Centro`). Nuance qui comptait.
- ~~Où sont les *scudetti*~~ → même page (376306).

### 🔴 Les 3 à poser maintenant (elles bloquent)

1. ~~**Le fichier des communes.**~~ ✅ **RÉPONDU LE 09/09** — « Comuni ISTAT al 08.09.2026 »,
   7 894 comuni, [Sheets partagé par
   Silvio](https://docs.google.com/spreadsheets/d/1Lf7gwU6Tpw_H_iQOSOBb7NSwdKg7g7ADGP2F46oBpWc/edit).
   Le wiki renvoyait à la liste du **05.05.2017**. Voir le bloc du 09/09 en tête : elle a servi
   d'étalon et a fait tomber le défaut des comuni à double nom.
2. ~~**Les giratoires.**~~ ✅ **RÉPONDU** — 08/09 : *« Chez nous on n'ajoute ni nom de la rue ni
   HN »*, **même règle qu'en France**, d'où une clé de traduction unique. Puis 09/09, sur le cas
   des grandes places qu'il avait soulevé : **suggestion 1 retenue**, le script signale toujours
   et l'éditeur ignore. Rien à coder. Voir le bloc du 09/09 en tête.
3. **Les panneaux de *centro abitato*.** Existe-t-il un jeu de données ouvert qui les recense ?
   ⇒ Il a mentionné de lui-même un script italien de HN « *basé sur des données officielles* » :
   la question est donc naturelle, et la réponse décide du pré-tracé automatique.

### ⏳ Les 4 à garder pour plus tard (finition)

4. Le wiki emploie **trois** façons de marquer l'obsolète. Convention officielle ?
5. L'exemple SS494, marqué « *non è più valido* » — que devient-il ?
6. **Voies communales `SC`** : forme abrégée obligatoire, comme les `C6` français ?
7. ~~**Régions bilingues** : seconde langue **obligatoire** en AN, ou facultative ?~~
   ✅ **TRANCHÉ PAR L'ÉDITEUR LE 09/09** — pour la **ville**, la question ne se pose plus : WME
   porte l'italien dans les quatre zones bilingues (Bolzano, val Gardena ladin, Vinschgau
   germanophone, Karst slovène). Voir le bloc du 09/09 en tête. ⏳ Reste ouverte pour le **nom de
   la voie** (`Via` / `Straße`), qui est un autre sujet et n'est pas contrôlé.

---

## 7. Sources

Les deux textes normatifs : **Denominazione delle strade** (376292) · **Centro abitato & City
Boundary** (376277).
Catégorie : `waze.com/discuss/c/wazeopedia/italy-wazeopedia/5205` — 13 sujets rapatriés.
