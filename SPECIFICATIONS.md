# WNA — WME Naming Auditor · Dossier de spécifications

> **Version du code décrite ici : 2.39.00** (lue dans le bloc `==UserScript==` de
> `WME-Naming-Auditor.user.js`).
> Diffusé sur **GreasyFork 588554**, dépôt `github.com/DrSlump34/WME-Naming-Auditor`,
> fil Discuss **410907**.

---

## 0. À qui s'adresse ce dossier, et comment le lire

Ce document est le **dossier de reprise** du projet : il doit permettre à quelqu'un — humain ou
IA — qui n'a jamais vu ce code de comprendre **ce que fait l'outil, pourquoi il est fait ainsi, et
ce qu'il ne faut pas casser**, sans lire les 12 675 lignes du script.

| Document | Rôle |
|---|---|
| `README.md` | Vitrine : ce que l'outil apporte, la mise en route, ce qui est contrôlé |
| **`SPECIFICATIONS.md`** (ce fichier) | **Normatif** : le contrat, les invariants, le modèle de données |
| `AUDIT-2026-07-26.md` | Audit du code à une date donnée — historique, non normatif |
| `tools/README.md` | Les outils d'accentuation et leurs limites **mesurées** |
| `PROMPT_ICONE.md` | Le prompt qui a produit l'icône |

Le code est **massivement commenté**, et ces commentaires disent **pourquoi** : ils citent la
mesure, la date, le retour d'éditeur ou le défaut réel qui a fixé la règle. **Quand ce dossier et
un commentaire du code se contredisent, le code fait foi.**

Ordre de lecture pour une reprise : § 1 → § 2 → § 11 (les interdits) → § 6 et § 7 (le cœur du
raisonnement) → § 15 (les contrôles automatisés).

---

## 1. Contexte et enjeu

### 1.1 La règle française bascule à l'entrée d'agglomération

En France, la règle d'édition Waze pour le nommage d'une voie **change au panneau EB10** (entrée
d'agglomération) :

| | Nom principal | Alternatif | Ville |
|---|---|---|---|
| **En agglomération** | le nom de rue | le numéro de route | renseignée |
| **Hors agglomération** | le numéro de route | le nom de rue **avec la ville** | **absente du principal** |

Un segment mal nommé n'est pas une faute d'orthographe : il change ce que l'application annonce au
conducteur et ce que la recherche d'adresse trouve.

### 1.2 Le script ne voit pas les panneaux

WNA n'a aucun moyen de savoir où est le panneau EB10. Il déduit donc la zone de **deux
géométries** :

1. le **contour communal officiel** (GeoJSON INSEE / Admin Express) — il délimite le périmètre
   d'analyse et fournit le nom de commune ;
2. le **polygone d'agglomération**, **tracé à la main** par l'éditeur à l'intérieur — il sépare
   l'agglomération du reste.

Une commune peut compter **plusieurs** polygones : la zone bâtie principale et les villages
rattachés. C'est le point sur lequel les éditeurs se trompent le plus souvent, et il est
explicitement expliqué en vidéo dans le README.

### 1.3 L'enjeu, et ce qu'il impose

**Une proposition fausse coûte plus cher qu'une absence de proposition.** Un éditeur qui applique
en confiance une correction erronée dégrade la carte, et le fait à grande échelle puisque l'outil
travaille par lots.

Trois conséquences structurent tout le code :

1. **Le script n'enregistre jamais rien.** Il lit, compare, propose. Une correction appliquée est
   déposée dans WME exactement comme une saisie manuelle : elle se relit, elle s'annule (Ctrl+Z),
   et **c'est l'éditeur qui enregistre**.
2. **Le script ne crée jamais un nom ni un numéro.** Il réorganise ce qui est déjà saisi. Seule la
   ville peut venir d'ailleurs — du contour communal.
3. **Le doute se dit.** Quand un verdict repose sur un indice et non sur une preuve (§ 7.4), le
   report l'annonce. Quand plusieurs candidats se présentent, **le script ne choisit pas à la place
   de l'éditeur** : il expose la liste et demande.

⭐ Le défaut que le projet redoute porte un nom : **la correction à l'envers** — réclamer de
dégrader un objet déjà conforme. Deux cas réels : les 22 giratoires de Gruissan (v2.11), et les
aires d'autoroute, pour lesquelles WNA exigeait d'ajouter une ville que la règle interdit (§ 8.3).

---

## 2. Périmètre

### 2.1 Ce que WNA fait

- Auditer le **nommage des segments** (nom principal, alternatifs, ville) selon la zone.
- Auditer la **forme des noms** : abréviations, contractions, majuscule initiale, fonction ou
  direction dans le nom, numéro collé au nom, format des bretelles et des voies communales.
- Confronter les noms au **dictionnaire communautaire français** de *WME Check Road Name*.
- Auditer l'**adressage** : numéros de rue (HN), POI résidentiels (RPP), et l'**adresse des vrais
  POI** (rue, commune, numéro).
- Charger les **contours communaux** — par département, directement depuis `geo.api.gouv.fr`, ou
  depuis un fichier GeoJSON fourni par l'éditeur.
- **Sonder les panneaux EB10** de la commune pour proposer un pré-tracé d'agglomération.
- **Partager** les polygones tracés via un dépôt communautaire.
- Proposer et **appliquer** une correction dans WME — sans l'enregistrer.

### 2.2 Ce que WNA ne fait pas — et ne doit pas faire

- **Il n'enregistre jamais.** Aucun `save()`.
- **Il ne crée pas de contenu** : ni nom, ni numéro de route.
- **Il ne tranche pas entre plusieurs candidats** : il demande.
- **Il n'écrit pas la norme, il l'applique.** Un contrôle qui exprimerait une préférence et non une
  règle écrite est livré comme une **mesure** — décoché par défaut, sans bouton de correction, et
  le report dit explicitement que ce n'est pas un écart (`hnSurRoute`).
- **Il ne travaille qu'en France** (§ 10), et refuse de le faire ailleurs plutôt que d'appliquer
  des règles françaises à un autre pays.
- **Il n'envoie aucun contenu.** Les six hôtes joints sont en lecture seule ; les seuls paramètres
  transmis sont un numéro de département et les coordonnées de la vue.

---

## 3. Glossaire

| Terme | Sens |
|---|---|
| **EB10 / EB20** | Panneaux d'entrée et de sortie d'agglomération. |
| **Agglo** | Zone délimitée par le polygone tracé à la main à l'intérieur d'une commune. |
| **Contour INSEE** | Polygone officiel de la commune, source Admin Express (IGN) / COG (INSEE). |
| **Zone grise** | Un segment à cheval dont aucun côté n'atteint le seuil : rien n'est proposé, il est signalé **à couper**. |
| **HN** | *House Number* — numéro de rue porté par un segment. |
| **RPP** | *Residential Point Place* — POI de catégorie résidentielle, qui porte un numéro hors agglomération. |
| **Cartouche** (*road shield*) | Écusson du numéro de route, porté par une entrée de nommage. Il a un `signType` et parfois un `signText`. |
| **Report** | Un écart constaté, avec son état actuel, son état cible et son explication. |
| **Famille** | Regroupement de reports par nature, chacune avec sa couleur sur la carte. |
| **CRN** | *WME Check Road Name* — le script tiers dont WNA emprunte le dictionnaire de rédaction FR. |
| **Référentiel** | L'objet qui porte **tout le franco-français** (`REFERENTIELS.FR`). |

---

## 4. Utilisateurs

Des **éditeurs Waze français**, du débutant au rang élevé. Le script est employé commune par
commune : on charge les contours, on trace l'agglomération une fois, on analyse, on corrige, on
enregistre soi-même.

Deux exigences d'interface qui viennent de retours réels :

- **Le guidage pas à pas** (v2.21) montre *le geste suivant* tant qu'il reste quelque chose à
  faire — décochable, parce qu'un éditeur qui connaît l'outil n'a pas besoin qu'on lui tienne la main.
- **On n'enlève pas à l'éditeur ce qu'il a chargé sans qu'il l'ait demandé.** La purge automatique
  des départements est **décochée par défaut**, et ce n'est pas un oubli : le cumul est un contrat
  affiché depuis la v1.88. L'écran **dit ce que ça pèse** ; c'est l'éditeur qui décide.

---

## 5. Architecture

### 5.1 Un seul fichier livré

`WME-Naming-Auditor.user.js` — **12 675 lignes, ~700 Ko**, aucun `@require`.

`@grant` : `GM_xmlhttpRequest`, `GM_getValue`, `GM_setValue`. `@run-at document-idle`.

⚠️ **Dès qu'un `@grant` est déclaré**, Tampermonkey exécute le script dans un contexte isolé où
`window` n'est plus celui de WME : le SDK et le modèle ne s'y trouvent pas. D'où
`const hote = unsafeWindow || window` en tête de fichier — le repli sur `window` sert quand le
script est chargé autrement (test).

### 5.2 Les six hôtes joints (`@connect`)

| Hôte | Usage |
|---|---|
| `geo.api.gouv.fr` | Contours communaux (API Découpage administratif) |
| `api.wazefrance.com` | Source de contours alternative |
| `docs.google.com`, `googleusercontent.com` | Dictionnaire de rédaction FR |
| `raw.githubusercontent.com` | Import d'un fichier de partage par son adresse |
| `update.greasyfork.org` | Savoir si une version plus récente est publiée |

**Ce sont toutes des lectures.** Rien de ce que l'éditeur édite ne quitte le navigateur.

### 5.3 La bibliothèque copiée

`WMEPrefs` est une **copie conforme** de `../WME-Prefs/WMEPrefs.js`, embarquée en tête de fichier.
⚠️ **Ne pas la faire diverger ici** : corriger la bibliothèque d'origine, puis recopier. Même
démarche que WCT.

### 5.4 Le plan du fichier

| Zone (indicatif) | Contenu |
|---|---|
| ~39 → ~355 | **`WMEPrefs`** (copie conforme) |
| ~356 → ~432 | Pastille de **mise à jour** GreasyFork |
| ~434 → ~940 | **RÉFÉRENTIEL FRANCE** : expressions, catégories POI, types de voies, rocades, contrôles de forme |
| ~942 → ~1010 | **État de module et options** |
| ~1023 → ~1230 | **Progression** — toute attente se voit et s'interrompt |
| ~1236 → ~1500 | **Persistance** (chargement en cascade, fusion multi-poste) |
| ~1510 → ~2280 | Chargement automatique du département visible, gestion des contours |
| ~2296 → ~3170 | **Sondage des panneaux EB10**, clustering, pré-tracé |
| ~3177 → ~3610 | Classement des panneaux, distances, géométrie |
| ~3629 → ~4800 | **Moteur d'audit** : zonage, état cible, voies mitoyennes |
| ~4813 → ~4940 | **`REFERENTIELS`** — l'interface entre le moteur et le pays |
| ~4950 → ~5190 | **Garde-fou territorial** |
| ~5206 → ~5740 | **Adressage** : HN, RPP en agglomération |
| ~5754 → ~6710 | **POI** : position, audit d'adresse, proposition |
| ~6740 → ~7660 | **Balayage** en damier |
| ~7677 → ~9650 | Interface : fenêtre, onglets, reports, calques |
| ~9674 → fin | **Correction**, aide, guidage pas à pas, initialisation |

---

## 6. Le raisonnement de zonage

### 6.1 Les deux géométries

- `communeActive` porte le **contour INSEE** (`geom`) et le nom de commune.
- `agglos[<code INSEE>]` porte la **liste des polygones** d'agglomération de cette commune, chacun
  avec son anneau (`ring`) et son libellé.
- `sansAgglo[<code INSEE>]` marque les communes déclarées **sans agglomération** — une information,
  pas une absence d'information.

### 6.2 Le seuil et la zone grise

`options.seuil` (0,8 par défaut) est la **part de longueur** au-delà de laquelle un segment à
cheval est rattaché d'office à un côté.

Entre `1 - seuil` et `seuil`, c'est la **zone grise** : **aucune correction n'est proposée**, le
segment est signalé **à couper**, puisque le bon nommage dépend de l'endroit de la coupure.

### 6.3 Les trois exceptions — il n'y a rien à couper

1. la voie **mitoyenne**, qui épouse la limite communale (v2.08) ;
2. le segment qui ne porte **ni nom ni ville** — les deux moitiés seraient identiques ;
3. l'**autoroute**, qui ne porte aucune ville quelle que soit la zone.

**Le bilan les compte à part plutôt que de les taire.**

### 6.4 L'état cible — `expectedNaming(nam, agglo, nomCommune)`

Fonction **pure**, cœur du logigramme C/R/H (commune / rue / hors agglo). Elle rend l'état de
nommage attendu, plus un éventuel `doute`.

Trois règles à préserver :

1. **Un nom composite « Dxxx - Nom de la route » ne sert jamais de cible.** Ce format est
   **interdit** (ancienne règle FR abandonnée). Avant tout raisonnement, il est ramené à son nom
   seul (`RE_NOM_COMPOSITE`). Sans ce nettoyage, le script réclamait d'**ajouter**
   « N580 - Route d'Avignon » en alternatif — c'est-à-dire de créer le format interdit — tout en
   demandant par ailleurs de le supprimer. **Deux consignes contradictoires sur le même segment**
   (corrigé en v2.14, vu en direct à Saint-Laurent-des-Arbres).
2. **Le nettoyage peut créer des doublons** : ils sont fondus, sinon le doute « plusieurs noms de
   rue » se déclencherait à tort.
3. **Plusieurs candidats ⇒ on demande.** « La correction automatique prend le premier. Pas bon »
   (auteur, 22/07). La liste est exposée et `appliquerCorrection` interroge l'éditeur — pour les
   noms de rue comme pour les numéros de route.

---

## 7. Le référentiel — `REFERENTIELS.FR`

**Tout le franco-français est isolé ici.** Le moteur ne connaît que cette interface. *Ajouter un
pays revient à écrire un second bloc de ce genre, sans toucher au moteur ni à l'interface — celle-ci
se construit à partir de ce que le référentiel déclare.*

```js
{
  code, nom, correspond(pays),          // identité et reconnaissance
  libelleDecoupage, clesNom, clesCode,  // le fichier de contours
  typesSansAdresse,                     // 17 voie privée, 20 parking
  typesSansAdresseTotale,               // 15 ferry, 18 voie ferrée, 19 piste
  typeBretelle: 4, typeAutoroute: 3, typePiste: 19, typeRail: 18,
  rocadeDe,                             // prend le NOMMAGE, pas les noms
  etatCible: expectedNaming,
  villeAgglo,
  adressage: { hnEnAgglo: true, poiHorsAgglo: true, categoriePoi: 'RESIDENTIAL' },
  controles: [ … ],                     // § 8
  verifierForme, verifierSansVille
}
```

`REF` démarre sur la France et s'ajuste dès que WME dit dans quel pays on travaille
(`choisirReferentiel`).

### 7.1 Les expressions du vocabulaire routier

| Expression | Ce qu'elle reconnaît |
|---|---|
| `RE_ROUTE` | Un numéro : lettre(s) de réseau + au moins un chiffre + suite libre (`D6`, `D2e`, `N88`, `A9`, `M113`, `VC3`, `D981a`) |
| `RE_COMMUNALE` | Voie communale : `C`, `CV`, `CC`, `VC`, `RC`, `CR` + chiffres |
| `RE_AUTOROUTE` | `A` + chiffres — **aucune ville, jamais, quelle que soit la zone** |
| `RE_NOM_COMPOSITE` | Le format **interdit** `numéro - nom` (les trois tirets `-` `–` `—`, espacement libre) |
| `RE_ABREV`, `RE_ABREV_SANS_POINT` | `Av.`, `Bd.`, `Rte`… |
| `RE_SAINT` | Contractions `St-`, `Ste `… |
| `RE_ROCADE` | Repli par le nom, **qui ne prouve rien** (§ 7.4) |
| `RE_SUFFIXE_ROCADE` | **Liste fermée** des suffixes admis après « numéro - » sur une rocade |

⚠️ **`RE_SUFFIXE_ROCADE` doit rester une liste fermée** (validée par l'auteur le 03/08) : l'ouvrir
rendrait légitime « A9 - Autoroute la Languedocienne », qui est interdit. Toute forme voisine non
listée reste signalée.

### 7.2 Les types de voies

- `ROADTYPE_SANS_ADRESSE = {17 voie privée, 20 parking}` — une absence de nom n'y est **pas** une
  anomalie ; exclus par défaut, réintégrables par une case.
- ⚠️ **Les sentiers (5) et les escaliers (16) n'en sont pas** : l'auteur a tranché le 21/07 — ils
  répondent aux règles de nommage même s'ils ne sont pas circulables.
- `ROADTYPE_SANS_ADRESSE_TOTALE = {15 ferry, 18 voie ferrée, 19 piste}` — **trois régimes
  distincts** : la voie ferrée est le seul type où le nom est interdit jusqu'en alternatif ; la
  piste partage l'interdiction de ville mais admet le code OACI ; le guide ne dit rien du ferry.

### 7.3 Les catégories de POI

Deux listes, **relevées dans WME** (`I18n.translations.fr.venues.categories`, 134 catégories) et
**non inventées** :

- `POI_CATEGORIES_NATURELLES` — `RIVER_STREAM`, `SEA_LAKE_POOL`, `ISLAND`, `FOREST_GROVE`, `CANAL`,
  `SWAMP_MARSH`, `POOL`, `NATURAL_FEATURES`, `BEACH`. Ces objets décrivent un élément du paysage :
  ils n'ont pas d'adresse postale. ⚠️ **Ne pas y mettre** `FARM`, `SEAPORT_MARINA_HARBOR`,
  `SWIMMING_POOL`, `CARPOOL_SPOT` — ce sont des lieux bâtis, qui ont bel et bien une adresse.
- `POI_CATEGORIES_AUTOROUTE` — `REST_AREAS`, `FOOD_COURT`, `JUNCTION_INTERCHANGE`. Leur adresse
  **est le nom de l'autoroute, sans ville** : c'est une règle FR écrite (Discuss 70053 et 71786,
  Wazeopedia « Lieux Particuliers » §2.4, 2.12, 2.13). ⚠️ `GAS_STATION` n'y est **pas** : une
  station-service a une adresse ordinaire dès qu'elle n'est pas sur une aire ; celle qui l'est se
  reconnaît à la rue qu'elle porte déjà.

### 7.4 🔴 Identifier une rocade : le cartouche tranche, pas le nom

`rocadeDe(nam)` rend `{ rocade, certain, motif }`.

- **`certain: true` uniquement quand le cartouche Rocade est posé.**
- Sinon on s'appuie sur le nom ou sur le format, et **l'appelant DOIT afficher le doute** (règle de
  l'auteur, 03/08).

⚡ Valeur **mesurée en direct** dans WME (`W.model.signTypes`, pays 73 = France) :
1067 Métropole · 1072 Autoroute/Nationale · 1092 Départementale · 3033 Voie communale ·
**3035 Rocade** · 3036 Route européenne · 3037 Route territoriale.

⚠️⚠️ **Le cartouche Rocade est déclaré `minTextLength: 0, maxTextLength: 0`** : il ne porte aucun
texte, c'est un pictogramme. On ne peut donc **pas** le reconnaître à son `signText` (toujours
vide) : seul le `signType` le dit. C'est aussi pourquoi **il ne faut jamais juger une rocade
« sans cartouche » sur l'absence de texte**.

---

## 8. Les contrôles

Chaque contrôle s'active ou se désactive séparément. Le champ `portee` dit au moteur quand
l'appeler :

| Portée | Sens |
|---|---|
| `zone` | Compare l'état courant à l'état cible |
| `segment` | S'applique à tout segment ordinaire |
| `type` | Propre à un type de voie, géré par le moteur |
| `forme` | Porte sur la rédaction du nom |
| `adresse` | Porte sur les numéros et les RPP |
| `poi` | Porte sur les vrais POI |

### 8.1 La liste

| Clé | Portée | Défaut | Objet |
|---|---|---|---|
| `nommageZone` | zone | ✓ | Le cœur : ville, nom principal, alternatifs |
| `cartouches` | segment | ✓ | Les numéros doivent porter leur écusson |
| `bretelles` | type | ✓ | Jamais de ville |
| `rails` | type | ✓ | Voies ferrées, pistes, ferries : jamais de ville, **règles de nom propres à chacun** |
| `rocades` | type | ✓ | Jamais de ville |
| `giratoires` | type | ✓ | Sans nom ; la ville suit la zone |
| `abreviations` | forme | ✓ | `Av.`, `Bd.`, `Rte`… |
| `contractions` | forme | ✓ | `St-`, `R. Poincaré`… |
| `majuscule` | forme | ✓ | Nom commençant par une minuscule |
| `nomComposite` | forme | ✓ | Numéro collé au nom — **interdit** |
| `fonctionDirection` | forme | ✓ | `Voie de bus`, `… : Marseille` |
| `formatBretelle` | forme | ✓ | Format du nom (numéro, direction) |
| `bretelleForme` | forme | ✗ | Le nom suit-il « A6a: Paris » ou « > Orsay » ? |
| `voieCommunale` | forme | ✓ | Forme abrégée (`C6`, pas « Voie Communale n°6 ») |
| `redactionDico` | forme | *conditionnel* | Dictionnaire communautaire FR |
| `hnHorsAgglo` | adresse | ✓ | Numéros de rue hors agglomération |
| `hnSurRoute` | adresse | ✗ | **Mesure, pas règle** |
| `poiAgglo` | adresse | ✓ | RPP en agglomération (à vérifier) |
| `poiAdresse` | poi | ✓ | Adresse incomplète (rue ou commune manquante) |
| `poiVilleCommune` | poi | ✓ | Commune différente du contour INSEE |
| `poiNumero` | poi | ✗ | Numéro de rue manquant |

### 8.2 Trois défauts qui ne sont pas des oublis

- **`bretelleForme` décoché** : contrairement aux trois contrôles voisins qui n'attrapent qu'une
  faute précise, celui-ci juge la forme **entière** et peut remonter d'un coup toutes les bretelles
  au nom libre. On mesure sur du terrain réel avant d'envisager de le cocher d'office.
  ⭐ La v2.39.00 en fait **le contrôle qui EXIGE la forme, là où les trois autres ne font
  qu'interdire**.
- **`poiNumero` décoché** : mesure à Saint-Laurent-des-Arbres, **49 POI sur 98** n'ont pas de
  numéro. L'activer d'office noierait les rues et communes manquantes, qui sont 25.
- **`redactionDico` : `defaut: () => !crnPresent()`** — décoché si *WME Check Road Name* est
  installé, puisqu'il dit déjà la même chose à partir des mêmes règles.

### 8.3 🔴 `hnSurRoute` — une mesure, pas une règle

Origine : une proposition d'un éditeur (Glenan56, 27/07) selon laquelle en ville les numéros ne
devraient être posés que sur les segments dont le principal est l'adresse postale. **Il demande
lui-même que la norme passe par les LC et le wiki avant d'être codée** — et c'est la doctrine du
projet : *le script applique la norme, il ne la crée pas.*

Ce contrôle **ne juge donc rien : il compte**, pour que la discussion parte de chiffres et non
d'impressions. Décoché par défaut, **aucun bouton de correction**, et le report dit explicitement
que ce n'est pas un écart.

**Tout contrôle futur dans ce cas doit suivre le même régime.**

---

## 9. Adressage et POI

### 9.1 Où doit vivre une adresse

`adressage: { hnEnAgglo: true, poiHorsAgglo: true, categoriePoi: 'RESIDENTIAL' }` — en France, le
numéro de rue est porté par le **segment en agglomération**, et par un **POI résidentiel hors
agglomération**.

### 9.2 🔴 Où se trouve un POI — le point d'accès, pas le centre

Règle posée par l'auteur : **c'est le point d'accès principal qui compte**. Un bâtiment peut
chevaucher deux communes alors que son entrée — donc son adresse — n'est que d'un côté.

`positionPoi(v)` suit un ordre de préférence, **du plus fiable au dernier recours** :

1. le point d'accès marqué `primary` ;
2. n'importe quel point d'accès d'entrée ;
3. la géométrie elle-même si c'est un point ;
4. faute de mieux, la part de surface majoritaire — approchée par les **sommets** du contour, ce qui
   suffit à trancher et coûte infiniment moins qu'une intégration de surface.

Elle rend `{ point, source }` — **et la source est dite à l'éditeur**, parce qu'un verdict fondé sur
une part de surface n'a pas la même force qu'un point d'accès explicite.

*(Relevé du 26/07 : `app/Features` expose `entryExitPoints` ; 64 des 79 POI surfaciques de la
commune testée en ont un.)*

### 9.3 La proposition d'adresse

Le script **dit d'où vient sa proposition** : quelle voie, à quelle distance, sur quel critère.
*Une proposition qu'on ne peut pas vérifier ne se corrige pas de confiance.*

⚠️ `distanceAuTrace` sert à **deux choses sans rapport** — l'anneau d'un polygone d'agglomération
et le tracé d'une voie. Ce sont les mêmes mathématiques : **en garder deux copies serait la faute
exacte des giratoires de la v2.11.**

---

## 10. Garde-fou territorial

Le script **ne travaille qu'en France** (v2.03), et le vérifie sur le pays de la **zone regardée**.

⚠️⚠️ **L'outre-mer n'est pas « la France » dans le modèle Waze** : Guadeloupe, Martinique, Guyane,
Réunion, Mayotte y sont des **pays à part entière**, avec leur propre identifiant et leurs propres
villes. Les bloquer serait un contresens — le code de la route et les règles de nommage y sont les
mêmes.

D'où deux ensembles : `FR_CODES` (13 codes ISO) et `FR_NOMS`, énumérés **par code et par nom, en
anglais comme en français** — car WME nomme les pays selon la langue du profil de l'éditeur — et
comparés **sans accents**.

---

## 11. Contraintes non négociables

1. **Ne jamais enregistrer.** Aucun appel d'enregistrement, jamais, dans aucun chemin.
2. **Ne jamais créer un nom ni un numéro.** Seule la ville peut venir du contour communal.
3. **Ne jamais choisir entre plusieurs candidats.** Exposer et demander.
4. **Toujours dire le doute** quand le verdict repose sur un indice (rocade sans cartouche, position
   de POI par part de surface).
5. **Ne jamais proposer une correction à l'envers.** Avant d'ajouter un contrôle, vérifier ce qu'il
   ferait sur les objets **déjà conformes** d'une famille voisine.
6. **Le franco-français reste dans le référentiel.** Aucune règle nationale dans le moteur ni dans
   l'interface.
7. **`WMEPrefs` est une copie** : corriger la source, puis recopier.
8. **Une pastille de mise à jour ne s'allume que sur une réponse claire**, jamais par précaution —
   elle reste éteinte hors ligne.
9. **Ne pas retirer à l'éditeur ce qu'il a chargé** sans qu'il l'ait demandé (§ 12.3).
10. **Aucun contenu ne quitte le navigateur.**

---

## 12. Modèle de données et persistance

### 12.1 Les trois jeux de données

| Variable | Contenu | Partagé ? |
|---|---|---|
| `agglos` | `{ <INSEE>: [ { ring, label }, … ] }` — les polygones tracés | **oui**, via le dépôt de partage |
| `sansAgglo` | `{ <INSEE>: true }` — communes déclarées sans agglomération | **oui** |
| `traites` | `{ <INSEE>: { <clé d'écart>: true } }` — écarts marqués « traité » | **non, personnel** |

⚠️ `traites` est une **structure objet et non un tableau**, pour que la fusion multi-poste soit une
**union, jamais un écrasement**. Il suit l'éditeur d'un poste à l'autre, pas les autres éditeurs.

### 12.2 Le chargement en cascade

`prefs = WMEPrefs.create({ scriptId, scriptName, schema: 1 })`, avec une reprise **en cascade**
pour que personne ne perde rien — ni au passage à `WMEPrefs`, ni au renommage du script
(« WME Agglo Naming » → « WME Naming Auditor », v2.02) :

1. le stockage courant (`scriptId` actuel) ;
2. sinon le stockage de l'**ancien** `scriptId` ;
3. sinon les emplacements antérieurs.

⚠️ **Garde-fou `prefsPret`** : tant que le chargement initial n'a pas eu lieu, `agglos` et consorts
sont vides — **sauver à ce moment écraserait les données stockées**.

### 12.3 Les options

`options` porte : `seuil` (0,8), `sansAdresse`, `altEnTrop`, `zoomClic` / `zoomNiveau` (17),
`surligner`, `bulleSurvol`, `vue` (7 bascules : tableau et carte se choisissent **séparément** pour
les segments, les adresses, les POI et les panneaux), `autoDep`, `purgeAuto` / `purgeGarde`,
`guidage`, `controles`, `couleurs` (par famille), `panneau` (onglet ouvert **et** replis).

⚡ **Mesure du 09/08** : 12 départements en base chez l'auteur = **4 113 communes, 1 558 011 points,
~97 Mo de heap** mesurés dans Chrome, rechargés à chaque session. D'où l'affichage du poids, et
l'alerte au-delà de `SEUIL_ALERTE_OCTETS = 40 Mo`. **Mais la purge reste décochée** (§ 4).

---

## 13. Les panneaux EB10 et le pré-tracé

Le script **sonde les panneaux** de la commune pour proposer un tracé d'agglomération plutôt que de
le faire tracer entièrement à la main.

`classerPanneaux()` classe chaque panneau par rapport aux polygones existants — dedans / dehors,
avec la distance à l'anneau le plus proche. ⚠️ **Ne sont jugés que les EB10/EB20 tombant dans le
contour INSEE** : l'emprise de la requête déborde largement et ramène les panneaux des communes
voisines, qui n'ont rien à dire du polygone d'ici.

Les panneaux sont regroupés en grappes (`CLUSTER_SEUIL_M = 2000` m : au-delà, deux agglomérations
distinctes), ce qui permet de proposer **plusieurs polygones** — la zone bâtie et les villages
rattachés.

### 13.1 🔴 La couverture varie du simple au triple selon le département

`tools/couverture-eb10.js` mesure **sur combien de communes le chemin facile est réellement ouvert**.
Il a été écrit parce qu'un éditeur demandait à WNA ce que WNA sait déjà faire, et que **l'aide du
script et le mode d'emploi donné disaient l'inverse l'un de l'autre** : *on n'enseigne pas un chemin
sans savoir s'il est ouvert.*

⚠️ **L'outil reproduit la sémantique du script, pas une approximation** : trois états, et « aucun
panneau » n'est **pas** confondu avec « je n'ai pas pu voir ». La réponse de l'API est **plafonnée à
500 items**, et les B14 (limitations de vitesse) saturent le quota bien avant les EB10 : sans le
découpage adaptatif, on perdrait des panneaux **en silence** et on annoncerait une couverture trop
basse avec l'aplomb d'une mesure.

Emprise d'une requête, **mesurée** (elle n'est pas documentée) : `DEMI_LAT_Z13 = 0.1651`,
`DEMI_LON_Z13 = 0.2240`, divisée par deux à chaque niveau de zoom ; zoom 13 → 16 ; plafond 500.

Conséquence acquise : **la couverture va du simple au triple selon le département**, et la source ne
couvre pas l'Île-de-France (86 départements sur 101). **Le guidage est donc porté par l'interface**,
qui propose le sondage puis retombe sur le tracé manuel, plutôt que par un mode d'emploi qui
promettrait un chemin parfois fermé.

---

## 14. Le partage communautaire

Dépôt séparé : `C:\Users\drslu\Projets\WME-Naming-Auditor-Partage` →
`github.com/DrSlump34/WME-Naming-Auditor-Partage`.

- Un fichier par département : `partage/dep-<DEP>.json`, listé dans `index.json`, gabarit dans
  `modele.json`.
- Import dans le script : **☰ Données → Réglages → Sauvegarde & partage → Importer depuis une URL**,
  avec l'URL *raw*.
- **L'import n'écrase jamais le travail local** : une commune déjà tracée n'est pas touchée, seules
  les communes absentes sont ajoutées.
- **Les coches « traité » ne sont jamais partagées.**
- Une vérification automatique (GitHub Actions) contrôle le format avant fusion ; `CONTRIBUTING.md`
  décrit la contribution, `DONNEES-LICENCE.md` la licence des données.

---

## 15. Protocole de vérification

**~30 scripts de test Node** dans `tools/`, sans dépendance :

| Famille | Scripts |
|---|---|
| Zonage et géométrie | `test-zonage.js`, `test-zone-grise.js`, `test-hors-agglo.js`, `test-voie-mitoyenne.js`, `test-selection-zone.js`, `test-cadrage.js` |
| Règles de nommage | `test-guide-fr.js`, `test-cartouches.js`, `test-nom-composite.js`, `test-giratoires.js`, `test-bretelle-forme.js`, `test-dictionnaire.js`, `test-redaction-eclair.js` |
| Adressage et POI | `test-poi.js`, `test-hn-rpp.js`, `test-hn-sur-route.js`, `test-rpp-agglo.js` |
| Panneaux et pré-tracé | `test-sondage-panneaux.js`, `test-pretrace.js`, `couverture-eb10.js` |
| Données et persistance | `test-chargement.js`, `test-fusion-prefs.js`, `test-purge-contours.js`, `test-ville-sans-polygone.js` |
| Interface | `test-ui-sections.js`, `test-bandeau-erreur.js`, `test-guidage.js`, `check-accents-visibles.js` |
| Territoire et mise à jour | `test-territoire.js`, `test-maj.js` |

### 15.1 Les outils d'accentuation

`tools/` contient aussi les scripts Python qui ont servi à accentuer l'interface (v2.05). **Relire
les avertissements en tête de chaque fichier avant de les relancer, et toujours lancer `--dry`
d'abord.**

⚠️ **Les régressions que les essais à blanc ont attrapées ne doivent pas être réintroduites** :

- `SCRIPT_ID + '-ecarts'` accentué en `'-écarts'` — c'est un **nom de calque**, le surlignage cassait ;
- `label: '${etiquette}'` accentué — c'est un **placeholder du `styleContext` OpenLayers**, les
  étiquettes de la carte cassaient **en silence** ;
- `RE_ROCADE` contient « peripherique » : l'accentuer casse la détection des rocades.

Limites connues (**mesurées, pas supposées**) : les templates imbriqués dans une interpolation ne
sont pas traités ; les libellés d'un seul mot sont protégés à tort ; les formes ambiguës
(participe / impératif) ne sont **jamais** automatisables.

### 15.2 Ce que les harnais ne prouvent pas

Ils ne voient pas ce qu'un éditeur comprend d'un report, ni ce que l'API des panneaux répond
vraiment sur une commune donnée, ni le poids réel en mémoire d'une base de contours. **Le geste réel
dans WME, sur une commune réelle, reste la seule preuve de bout en bout** — c'est lui qui a produit
la quasi-totalité des règles citées dans ce dossier.

---

## 16. Publication

Quatre canaux : **GreasyFork 588554**, le dépôt **GitHub**, le fil **Discuss 410907**
(`[Script] WME Naming Auditor — France only`, catégorie **3984**), et le dépôt de partage.

Points de méthode acquis :

- **Le code se charge par le champ fichier `#code-upload`**, puis le textarea est rempli depuis le
  fichier joint dans la page, puis **le champ fichier est vidé** — laisser les deux, c'est deux
  sources pour un même champ.
- **Contrôles après chargement** : version neuve présente, ancienne absente, un marqueur par
  nouveauté, **pas de BOM**, **0 CRLF**, fin en `)();`.
- **Formats des champs GreasyFork** : description en **Markdown**, changelog en **HTML**.
- ⚠️ **Lire la version SERVIE dans WME**, pas seulement celle du fichier local.
- ⚠️ **Le ratio ne suffit pas à prouver qu'une capture a été remplacée** : deux images de ratios
  voisins rendent la même vignette. Charger l'image **en plein format** et lire ses dimensions.
- ⚠️ **Discourse va à la ligne tout seul** : ne jamais couper une ligne à la main dans un post.
- ⚠️ **Discourse rapatrie les images externes** sur son stockage : elles y sont **figées**, mettre à
  jour la capture dans le dépôt ne met pas à jour le post.

---

## 17. Ce qui reste ouvert

- **Aucun autre pays n'est pris en charge.** L'architecture le prévoit (§ 7), rien n'est écrit.
  La description du script le dit explicitement : *« FRANCE UNIQUEMENT (pour l'instant) »*.
- **La couverture EB10 varie du simple au triple selon le département** (§ 13.1) — c'est mesuré,
  et c'est l'interface qui porte le guidage en conséquence.
- **`bretelleForme` attend une mesure sur du terrain réel** avant d'être coché d'office.
- **`hnSurRoute` attend un arbitrage communautaire** (LC + wiki) avant de devenir une règle.

### Annexes du dépôt

| Fichier | Contenu |
|---|---|
| `Recuperer-Communes.html` | Fabrique un fichier GeoJSON de contours depuis un navigateur, **indépendamment du script** |
| `AUDIT-2026-07-26.md` | Audit du code à cette date |
| `PROMPT_ICONE.md` | Le prompt qui a produit l'icône |
| `captures/` | Captures d'écran et la vidéo « zone bâtie et villages rattachés » |
