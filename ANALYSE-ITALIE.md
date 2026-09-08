# WNA — Portage vers l'Italie · Analyse préalable

**Date** : 2026-09-08 · **Demandeur** : Silvio, Country Coordinator IT

## ⏸️ ÉTAT AU 08/09 AU SOIR — v2.40.00, non publiée

| | |
|---|---|
| ✅ Garde-fou généralisé | il demande « quel référentiel sert ce territoire », plus « est-ce la France » |
| ✅ 19 constantes nationales versées | le moteur ne lit plus **aucune** globale française |
| ✅ `REFERENTIELS.IT` écrit | vocabulaire, types, 12 contrôles ; 9 contrôles FR volontairement absents |
| ✅ `tools/test-italie.js` | 34 vérifications rejouant les **exemples du wiki** |
| ⏳ 7 questions à Silvio | message prêt, 3 prioritaires (§ 6) |
| ⏳ Contrôles neufs IT | `fari`, sigle sans espace, chiffres romains, ordinaux, fractions — ils touchent `verifierForme`, qui est commune |
| ⏳ i18n | 714 chaînes, pas commencé |
| ⏳ Essai réel | le référentiel n'a **jamais tourné sur la carte** |

⛔ **NE PAS PUBLIER** : la description de l'en-tête dit encore « FRANCE UNIQUEMENT », et
c'est volontaire tant que les questions restent ouvertes et que rien n'a été essayé en vrai.

**868 vérifications sur 29 fichiers, 0 échec.**

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
| Contours communaux | `geo.api.gouv.fr` (service interrogeable) | **ISTAT, en fichier** — 7 899 communes, pas d'API |
| Quel département sous les yeux | `geo.api.gouv.fr/communes?lat&lon` | ❌ aucun équivalent → **choix manuel de la province** |
| Pré-tracé depuis les panneaux | `api.wazefrance.com/rs` (jeu du Ministère de l'Intérieur **FR**) | ❌ aucun équivalent connu → **tracé manuel** |

✅ **Le tracé manuel n'est pas un pis-aller** : l'architecture le gère déjà (`sonderPanneaux` rend
`aucun` / `incertain`, ce qui grise le bouton **avec sa raison**), et c'est déjà le quotidien de
l'Hérault (28 % de couverture EB10, mesuré le 28/08).

✅ **Le chargement par fichier GeoJSON existe déjà** (`clesNom` / `clesCode` du référentiel,
outil `Recuperer-Communes.html`) : c'est exactement la forme sous laquelle ISTAT publie.

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

1. **Le fichier des communes.** Le wiki renvoie à « Denominazione dei comuni ISTAT **05.05.2017** ».
   Les fusions de communes sont nombreuses depuis. **Quelle liste fait foi aujourd'hui ?**
   ⇒ Sans elle, rien ne fonctionne : c'est la base de tout le zonage.
2. **Les giratoires.** Le guide *Rotatorie* ne traite que du tracé, jamais du nom. En France un
   giratoire est **sans nom**. **Et en Italie ?**
3. **Les panneaux de *centro abitato*.** Existe-t-il un jeu de données ouvert qui les recense ?
   ⇒ Il a mentionné de lui-même un script italien de HN « *basé sur des données officielles* » :
   la question est donc naturelle, et la réponse décide du pré-tracé automatique.

### ⏳ Les 4 à garder pour plus tard (finition)

4. Le wiki emploie **trois** façons de marquer l'obsolète. Convention officielle ?
5. L'exemple SS494, marqué « *non è più valido* » — que devient-il ?
6. **Voies communales `SC`** : forme abrégée obligatoire, comme les `C6` français ?
7. **Régions bilingues** : seconde langue **obligatoire** en AN, ou facultative ?

---

## 7. Sources

Les deux textes normatifs : **Denominazione delle strade** (376292) · **Centro abitato & City
Boundary** (376277).
Catégorie : `waze.com/discuss/c/wazeopedia/italy-wazeopedia/5205` — 13 sujets rapatriés.
