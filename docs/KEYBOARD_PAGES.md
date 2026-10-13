# Organiser son clavier en pages

Depuis **Clavier**, utiliser **Les pages de mon clavier** pour créer une page
personnelle : Personnes, Besoins, Activités, ou un autre nom choisi. Chaque page
appartient au profil. Ses noms n'établissent aucune catégorie ou relation sémantique.
Les catégories de recherche de la bibliothèque de dessins restent indépendantes.

Pour ajouter une touche déjà validée à une page, ouvrir ses réglages de place,
choisir **Zone**, **Page** et **Place**, puis **Enregistrer la place**.
Les places commencent à 1. Une place occupée dans cette page et cette zone est
refusée ; aucune autre touche ne se déplace. Choisir une autre place pour résoudre
le conflit. La case 1 de Personnes et la case 1 de Besoins peuvent contenir deux
touches différentes. La photo ou le dessin, le mot et le concept sont conservés.

**Accueil** contient les touches sans page, notamment les nouvelles touches
validées tant qu'aucun placement n'est choisi. Ce nom est réservé. Le renommage
d'une page conserve son identité, l'ordre des pages et les places de ses touches.
Cette V1 permet l'ajout et le renommage ; la suppression, le réordonnancement et
les pages imbriquées restent des évolutions distinctes.

## Repères stables et communication

Les repères stables sont communs à toutes les pages. Ils gardent leurs positions
et leurs cases libres ; aucun groupe ne peut leur être attribué. Pour transformer
un repère stable en touche personnelle d'une page, changer explicitement sa zone
et sa place. Les restrictions sur la promotion de nouvelles suggestions PCL en
repères stables restent applicables.

Dans **Communiquer**, les boutons Accueil et les noms des pages permettent de
changer de vocabulaire. Les repères stables restent présents. On peut choisir
Maman dans Personnes puis Boire dans Besoins : ce sont deux sélections dans le
même message, dans cet ordre. Changer de page ne termine pas le message, ne
supprime aucune sélection et ne lance aucun appel IA. Les répétitions restent
possibles. Le rechargement reprend le message composé ; la navigation repart
sur Accueil. Les grilles de touches restent paginées à l'intérieur des pages.

## Persistance et API

Les pages sont stockées dans `keyboard_group`. `keyboard_position.group_id`
est une référence nullable vers une page du même profil. Une case est unique
par profil, page, zone et position, y compris pour Accueil (NULLS NOT DISTINCT).
Les positions stables exigent `group_id IS NULL`. Les références de pages,
placements et événements d'audit sont protégées par des clés étrangères avec
le profil. La création, le renommage, les placements et leur historique sont
transactionnels. L'effacement explicite de la mémoire d'un profil inclut ses pages.

- `GET /api/v1/profiles/{profile_id}/keyboard-groups` : pages du profil, dans leur ordre de création.
- `POST /api/v1/profiles/{profile_id}/keyboard-groups` : `label` et `actor_role`.
- `PATCH /api/v1/profiles/{profile_id}/keyboard-groups/{group_id}` : nouveau `label` et `actor_role`.
- `PUT /api/v1/profiles/{profile_id}/keyboard/{block_id}` : paramètres habituels,
  plus `group_id` (UUID de page ou null pour Accueil).

Une ancienne requête omettant `group_id` conserve la page actuelle lors d'un
placement personnel. Passer explicitement null retire la touche de sa page.
Choisir la zone stable conserve son caractère global. Les noms sont limités à
80 caractères, uniques par profil avec comparaison exacte ; Accueil est réservé
indépendamment des majuscules. Les erreurs n'exposent aucun contenu personnel.

Les pages ne sont ni une mémoire validée de sens ni des instructions envoyées
au provider. La construction des requêtes IA demeure bornée aux mots choisis et
aux liens sémantiques validés du profil.

## Migration et retour de version

La migration `0006_keyboard_groups` conserve toutes les positions existantes dans
Accueil, avec les repères stables globaux ; elle ne déplace ni ne renumérote de touche.
Les pages et leur audit sont inclus dans les sauvegardes PostgreSQL complètes.
Une migration descendante est refusée tant que des pages existent, pour éviter
de perdre l'organisation personnelle et son historique implicitement.

Une ancienne version backend ne connaît pas les places distinctes par page et
peut refuser un clavier qui utilise la même place dans plusieurs pages. Après
utilisation des pages, privilégier une correction avec un backend compatible.
Un retour à une base antérieure exige une restauration coordonnée de sauvegarde,
en tenant compte des communications enregistrées depuis cette sauvegarde.
Ne pas lancer automatiquement l'ancien service de migration contre une révision
Alembic qu'il ne connaît pas.

## Vérifications

Les tests couvrent les places distinctes, les collisions, les repères stables
globaux, l'isolation API et les clés étrangères, le renommage sans déplacement,
la conservation des séquences ordonnées, la compatibilité des anciennes requêtes,
les conflits de noms, le rollback si l'audit échoue, l'effacement de mémoire et
la comparaison des migrations aux modèles SQLAlchemy.

Le navigateur est vérifié sur une base jetable : créer Personnes et Besoins,
placer Maman et Boire chacun en case 1, renommer Personnes en Mes proches,
composer les deux mots depuis leurs pages et reprendre le message après
rechargement. Les quatre repères stables restent visibles dans les deux pages.
