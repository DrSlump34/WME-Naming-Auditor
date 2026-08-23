# Prompt de génération de l'icône (ChatGPT / Gemini)

Calé sur le style commun à `WME-Closures-Toolkit/icon.png`,
`WME-POI-Event-Updater/Icon.png` et `Fermetures-Hivernales/icon.png` : squircle bleu
en dégradé, plan de carte clair en perspective au bas, objets 3D « soft » en
plastique mat, ombres douces, fond blanc, aucun texte.

⚠️ **Joindre les icônes existantes en référence** si l'outil l'accepte (ChatGPT et
Gemini acceptent des images d'entrée) : c'est ce qui garantit la cohérence de
famille, bien plus que la description écrite.

⚠️⚠️ **Le piège propre à CE script.** WNA parle de **noms de rues** — le sujet est
donc du texte, et c'est exactement ce qu'un générateur d'images ne sait pas écrire.
⇒ Le panneau doit rester **vierge**, son inscription seulement **suggérée par deux
barres grises arrondies**. Demander le nom d'une commune sur le panneau produira une
bouillie de lettres, et l'icône sera à refaire.

---

## Prompt (anglais — à privilégier)

```
A modern app icon in the style of macOS Big Sur / iOS: a squircle (rounded square)
with a smooth vertical blue gradient background, from a bright azure blue at the top
to a deeper royal blue at the bottom. The icon sits on a pure white background with
a soft drop shadow beneath it.

Subject: auditing French street names against town boundaries on a map.

Composition, from back to front:
- At the bottom, a stylised light grey road map plane in slight perspective, with a
  few pale green field patches and thin white roads, exactly like a simplified
  navigation map.
- On that map plane, one closed administrative boundary drawn as a white dashed line
  with a soft blue glow, enclosing a single area — a town limit.
- The focal element, standing upright in the centre: a French town-entrance road sign
  in soft matte 3D — a white rectangular plate with a thick red border, mounted on two
  dark grey posts. The plate carries NO letters: its inscription is only suggested by
  two short rounded light grey bars, like placeholder text.
- In the foreground, tilted over the sign, a magnifying glass: white matte rim and
  handle, pale blue translucent glass with one soft highlight.
- A small soft green check mark in the lower right, discreet, not competing with the
  sign.

Style: flat-3D icon illustration, soft matte plastic materials, gentle ambient
occlusion and soft shadows, no harsh highlights, no outlines except the white road
casing. Clean, friendly, professional. Colours: azure and royal blue, white, light
grey, pale green, one strong red for the sign border, one soft green for the check.

No text, no letters, no numbers, no watermark — the sign plate must stay blank apart
from the two grey placeholder bars. Square 1:1 composition, centred, generous padding
around the squircle.
```

## Prompt (français, si l'outil répond mieux en français)

```
Icône d'application moderne, style macOS Big Sur / iOS : un carré à coins très
arrondis (squircle) avec un dégradé vertical bleu, du bleu azur vif en haut au bleu
roi profond en bas. L'icône est posée sur un fond blanc pur, avec une ombre portée
douce en dessous.

Sujet : l'audit des noms de rues français au regard des limites communales.

Composition, de l'arrière vers l'avant :
- En bas, un plan de carte routière gris clair en légère perspective, avec quelques
  parcelles vert pâle et de fines routes blanches, comme une carte de navigation
  simplifiée.
- Sur ce plan, une limite administrative fermée, tracée en pointillés blancs avec un
  léger halo bleu, qui enclôt une seule zone — une limite de commune.
- L'élément central, dressé au milieu : un panneau routier français d'entrée
  d'agglomération en 3D douce et mate — une plaque rectangulaire blanche à large
  bordure rouge, montée sur deux poteaux gris foncé. La plaque ne porte AUCUNE
  lettre : son inscription est seulement suggérée par deux courtes barres arrondies
  gris clair, comme un texte de substitution.
- Au premier plan, inclinée au-dessus du panneau, une loupe : monture et manche
  blancs et mats, verre bleu pâle translucide avec un seul reflet doux.
- Une petite coche vert tendre en bas à droite, discrète, qui ne concurrence pas le
  panneau.

Style : illustration d'icône en 3D plate, matières plastiques mates et douces,
occlusion ambiante légère et ombres douces, pas de reflets durs, pas de contours sauf
le liseré blanc des routes. Propre, chaleureux, professionnel. Couleurs : bleu azur
et bleu roi, blanc, gris clair, vert pâle, un seul rouge franc pour la bordure du
panneau, un vert doux pour la coche.

Aucun texte, aucune lettre, aucun chiffre, aucun filigrane — la plaque du panneau
doit rester vierge, hormis les deux barres grises de substitution. Composition carrée
1:1, centrée, avec une marge généreuse autour du squircle.
```

---

## Ce qu'il faut vérifier sur le résultat

1. **La plaque est-elle vraiment vierge ?** C'est le contrôle n°1 : les générateurs
   collent des lettres sur tout ce qui ressemble à un panneau, malgré la consigne.
   Des pseudo-mots déformés sur une icône de script de **nommage**, c'est le pire des
   défauts possibles.
2. **Le liseré rouge survit-il à 64 px ?** C'est lui qui dit « panneau d'entrée
   d'agglomération ». S'il disparaît à la réduction, l'icône ne raconte plus rien.
3. **La loupe masque-t-elle le panneau ?** Elle doit se lire comme posée dessus, pas
   comme le cachant. Réduire et regarder : si les deux se confondent en une tache,
   demander une loupe plus petite et décalée.
4. **La limite communale se voit-elle ?** Un simple fond de carte ne dit pas
   « commune » : il faut un contour fermé, distinct des routes.
5. **Pas de texte parasite** ailleurs dans l'image.
6. **Fond réellement blanc**, pas gris ni transparent — comme les autres icônes.
7. **Cohérence de famille** : poser les quatre icônes côte à côte à la même taille.
   Si celle-ci jure, c'est en général la saturation du bleu ou la dureté des ombres.

## Ensuite

Réduire en 512, 256, 128 et 64 px et garder toutes les tailles : Discord affiche
petit, GreasyFork affiche grand.

⚠️ **Où elle servira** — à recenser avant de dire que c'est fait (cf.
[[captures-ecran-userscripts]]) : le dépôt GitHub, la fiche GreasyFork, et le post
Discord `📜・scripts`. ⚠️ Sur GreasyFork, **une image jointe appartient à une
version** : elle ne se remplace qu'en publiant, comme la capture d'écran.
