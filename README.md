# WME Naming Auditor

Userscript pour l'éditeur de cartes Waze (WME). Il audite le **nommage des segments** — nom principal et noms alternatifs — en s'appuyant sur les **contours communaux officiels** et sur un **polygone d'agglomération** tracé à la main, puis liste les écarts à la règle.

> **État : lecture seule.** Le script n'écrit rien dans la base Waze. Il diagnostique, il ne corrige pas encore.

## Le principe

La règle française de nommage bascule à l'entrée d'agglomération (panneau EB10) :

- **en agglomération** : la ville est renseignée, le nom de rue est le nom principal, le numéro de route passe en alternatif ;
- **hors agglomération** : le nom principal ne porte **pas** de ville, le numéro de route devient le nom principal, et le nom de rue passe en alternatif **avec** la ville.

Le script ne peut pas voir les panneaux. Il déduit donc la zone de deux géométries :

1. le **contour communal** (fichier GeoJSON chargé par l'éditeur) délimite le périmètre d'analyse et fournit le nom de commune ;
2. le **polygone d'agglomération**, tracé à la main à l'intérieur, sépare l'agglomération du reste.

Un segment à cheval est tranché par un **seuil de longueur réglable** (80 % par défaut). Entre les deux, aucune correction n'est proposée : le segment est signalé comme **à couper**, puisque le bon nommage dépend de l'endroit de la coupure.

Le script ne **crée** jamais un nom ni un numéro : il réorganise ce qui est déjà saisi. Seule la ville peut venir d'ailleurs — du contour communal.

## Mise en route

1. Installer `WME-Naming-Auditor.user.js` dans Tampermonkey (accepter l'autorisation d'accès à `geo.api.gouv.fr`).
2. Dans WME, ouvrir la fenêtre par le bouton 🏙️ de la barre d'icônes.
3. Cocher un ou plusieurs départements et cliquer sur **Télécharger et charger** : les contours arrivent directement, sans passer par un fichier.
4. Choisir une commune, tracer son agglomération, analyser.

Les contours peuvent aussi venir d'un **fichier GeoJSON** que vous fournissez — utile hors ligne, ou pour employer une autre source que celle proposée. L'outil `Recuperer-Communes.html` fabrique ce fichier depuis un navigateur, indépendamment du script.

## Ce qui est contrôlé

Chaque contrôle s'active ou se désactive séparément, dans l'onglet du panneau latéral.

| Contrôle | Objet |
|---|---|
| Nommage agglo / hors agglo | le cœur : ville, nom principal, alternatifs |
| Cartouches | les numéros de route doivent porter leur écusson |
| Bretelles | jamais de ville |
| Voies ferrées, pistes, ferries | jamais de ville ; nom principal vide, alternatif admis |
| Rocades et périphériques | jamais de ville |
| Abréviations | `Av.`, `Bd.`, `Rte`… interdits |
| Contractions | `St-`, `R. Poincaré`… interdits |
| Majuscule initiale | nom commençant par une minuscule |
| Fonction ou direction | `Voie de bus`, `… : Marseille` |

Les segments dans une situation strictement identique sont regroupés en un seul report ; un clic les sélectionne tous.

## Autres pays

Le moteur ne connaît aucune règle nationale. Tout le franco-français est isolé dans un **référentiel** (`REFERENTIELS.FR`) qui décrit le vocabulaire des numéros de route, les types de voies sans adressage, les clés du fichier de contours, l'état cible du nommage et la liste des contrôles. Ajouter un pays revient à écrire un second référentiel, sans toucher au moteur ni à l'interface — celle-ci se construit à partir de ce qu'il déclare.

## Données de contours

`Recuperer-Communes.html` interroge l'API Découpage administratif de l'État (`geo.api.gouv.fr`), dont les contours proviennent d'**Admin Express (IGN)** et du Code Officiel Géographique de l'**INSEE**. À ne pas confondre avec les nombreux jeux de contours dérivés d'OpenStreetMap, sous licence ODbL.

Le fichier reste sur le poste de l'éditeur : le userscript ne fait aucun appel réseau.

## Licence

MIT — voir `LICENSE`.
