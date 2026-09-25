# Les bancs

**Tout rejouer** : `node tools/rejouer-bancs.js` (depuis la racine du dépôt ; `-v` pour le détail).
Il lance chaque `tools/test-*.js` et `tools/check-*.js`, et sort avec un code **non nul** au premier
échec. `couverture-eb10.js` est une mesure réseau, lancée à part.

Règles de la maison (audit du 25/09/2026) :

- **Un banc extrait les fonctions du fichier servi** (`WME-Naming-Auditor.user.js`, ou le fichier passé
  en argument) ; il ne recopie jamais une constante ni une formule.
- **Chaque contrôle nouveau a son témoin** : la mutation qui retire le correctif doit le faire échouer.
  Un contrôle qui passe aussi sans le correctif ne prouve rien.
- **Commiter en s'enchaînant sur le code de sortie** :
  `node tools/rejouer-bancs.js > bancs.txt 2>&1 && git commit …`.
  ⚠️ Jamais à travers un `| grep` : le code de sortie d'un tube est celui du DERNIER maillon, et un
  commit est déjà parti ainsi avec un banc rouge.

Outils de **mesure** (pas des bancs) : `couverture-i18n.js` (l'aide traduite en italien),
`couverture-interface.js` (onglet, boîtes, volet), `couverture-eb10.js` (panneaux par département).

## Outils d'accentuation

Ces scripts ont servi a accentuer l'interface (v2.05). Ils sont conserves pour
une reprise eventuelle, mais **relire les avertissements en tete de chaque
fichier avant de les relancer**.

| Script | Role |
|---|---|
| `accentuer.py` | Dictionnaire + passe sur les chaines d'UNE ligne. Contient le dictionnaire partage. |
| `accentuer2.py` | Passe globale : suit les templates literals MULTI-lignes. Importe le dictionnaire du precedent. |
| `accents-manuels.py` | Paires exactes pour les formes grammaticalement ambigues (participe vs imperatif). |
| `accents-a-prepositions.py` | « a » vers « à » quand c'est la preposition, arbitre une par une. |
| `lister-ambigus.py` | Signale les chaines visibles contenant une forme ambigue. |
| `lister-a-isoles.py` | Signale les « a » isoles, avec leur contexte. |
| `mots-restants.py` | Inventaire des mots sans accent encore presents dans le texte visible. |

### Limites CONNUES (mesurees, pas supposees)

1. **Templates imbriques dans une interpolation** : `${sect('x', 'Titre', ` … `)}`
   n'est pas traite par `accentuer2.py` (le contenu de `${...}` est recopie tel
   quel). Les textes de `buildReglages` ont du etre corriges a la main.
2. **Libelles d'un seul mot** : proteges a tort par la regle « identifiant nu »
   de `RE_TECHNIQUE` (« Controles », « Donnees »). Corriges a la main.
3. **Formes ambigues** : jamais automatisables. Voir le bloc en tete de
   `accentuer.py`.

### Regressions que les essais a blanc ont attrapees — ne pas les reintroduire

- `SCRIPT_ID + '-ecarts'` accentue en `'-écarts'` : **nom de calque**, cassait le
  surlignage. D'ou la regle `^-` dans `RE_TECHNIQUE`.
- `label: '${etiquette}'` accentue en `'${étiquette}'` : **placeholder du
  styleContext OpenLayers**, cassait les etiquettes de la carte, en silence.
  D'ou `RE_PROTEGE`, qui protege `${...}` meme hors template.
- `RE_ROCADE` contient « peripherique » : l'accentuer casserait la detection des
  rocades. D'ou l'exclusion des lignes de declaration de regex.
- `'ajoute @grant …'` -> `'ajouté …'` : imperatif pris pour un participe.
- `'delai depasse'` -> `'delai dépasse'` : il fallait « délai dépassé ».

**Toujours lancer `--dry` d'abord et relire le rapport.**
