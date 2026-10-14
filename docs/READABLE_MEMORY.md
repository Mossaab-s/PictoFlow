# Mémoire lisible

L’onglet **Mémoire** présente les messages, touches et relations du profil sous
forme de cartes. Il utilise les partitions PCL existantes, sans appeler un
provider IA et sans enregistrer de validation.

## Lire la mémoire

- **Mémoire validée** montre les messages confirmés ou corrigés, les touches
  validées et les relations validées.
- **Propositions à vérifier** montre uniquement les éléments encore proposés.
  Un score de confiance ne change pas leur état.
- Les refus, interprétations non comprises et éléments archivés restent dans
  l’historique ; ils ne redeviennent pas des messages utiles.
- La recherche accepte les accents et plusieurs mots. Le filtre choisit
  messages, touches, relations ou tout. Chaque liste affiche dix cartes par page.
- **Actualiser** relit la mémoire depuis PostgreSQL. Les chargements périmés sont
  annulés lors d’un changement de profil ou de partition.

Un message corrigé affiche la **phrase retenue**. La proposition d’origine est
consultable séparément. La date de la carte est celle de la proposition ; les
dates de confirmation/correction se trouvent dans ses décisions humaines.

Les touches d’une séquence gardent leur ordre, leurs répétitions et leurs cases
indisponibles. Les libellés et images montrés sont ceux du clavier actuel :
la séquence conserve des UUID, pas une capture historique du dessin ou du mot.
Une représentation archivée ou supprimée ne provoque pas de chargement d’une
ancienne photo. Les images restent locales et limitées au profil concerné.

Les cartes de touches montrent leur concept ou intention personnelle et leurs
repères stables. Les relations affichent les deux concepts et leur sens de
lecture, ainsi que leurs compteurs de confirmations et refus. Une lecture ne
crée ni relation ni validation implicite.

## Décisions humaines

**Voir les décisions humaines** charge les événements de validation réels de
l’élément, vingt par page, du plus récent au plus ancien. Chaque décision montre
l’action, le rôle enregistré, la date et le texte de correction éventuel.

Un ancien rôle absent reste **Rôle non renseigné**. L’absence d’événements est
indiquée ; aucun rôle n’est déduit de la source d’un audit ou du provider.
L’interface ne présente pas ces rôles comme une authentification de l’acteur.
Les références techniques d’acteur ne sont pas envoyées par cette API.

## API de lecture

`GET /api/v1/profiles/{profile_id}/feedback`

Paramètres obligatoires : `target_type` (`interpretation`,
`communication_block`, `semantic_relation`) et `target_id` (UUID).
Paramètres facultatifs : `limit` (1–100, défaut 20), `before` (UUID du dernier
événement de la page précédente).

Réponse : `items` (décisions) et `next_cursor` (UUID ou `null`). Le curseur est
lié au profil, au type et à l’objet demandé. La pagination compare date et UUID
pour conserver les événements de même date et éviter les doublons lorsque de
nouvelles décisions arrivent. Une cible ou un curseur étranger renvoie 404 ;
une requête invalide renvoie 422 sans reproduire son contenu.

Cette livraison n’ajoute pas de migration et conserve le contrat de `/memory`.
Les tests couvrent correction prioritaire, partitions, isolation, répétitions,
concepts manquants, rôles anciens, pagination des décisions et absence d’écritures.
Le parcours HTTP de la nouvelle page, des deux partitions, images et décisions
est vérifié sur une base jetable. La compilation Next.js, TypeScript et les tests
frontend sont vérifiés. La vérification visuelle native a été bloquée par
Computer Use, qui ne pouvait pas identifier l’URL du navigateur avec suffisamment
de certitude ; les interactions avec cette fenêtre ont été arrêtées.

La réutilisation d’un message pour communiquer et les raccourcis choisis sont
le point suivant du plan. Cette étape fournit la lecture et la recherche.
