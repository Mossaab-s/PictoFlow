# Organiser son clavier en pages

Depuis **Clavier**, utiliser **Les pages de mon clavier** pour créer une page
personnelle : Personnes, Besoins, Activités, ou un autre nom choisi. Chaque page
appartient au profil. Ses noms n'établissent aucune catégorie ou relation sémantique.
Les catégories de recherche de la bibliothèque de dessins restent indépendantes.

Pour ajouter une touche déjà validée à une page, ouvrir ses réglages de place,
choisir **Page** et **Place**, puis **Prévisualiser le déplacement** et
**Confirmer le déplacement**. Le mot, l’image, le sens et la zone sont conservés.
Les places commencent à 1. Une place occupée dans cette page et cette zone est
refusée ; aucune autre touche ne se déplace. Choisir une autre place pour résoudre
le conflit. La case 1 de Personnes et la case 1 de Besoins peuvent contenir deux
touches différentes. La photo ou le dessin, le mot et le concept sont conservés.

**Accueil** contient les touches sans page, notamment les nouvelles touches
validées tant qu'aucun placement n'est choisi. Ce nom est réservé. Le renommage
d'une page conserve son identité, l'ordre des pages et les places de ses touches.
**Monter** et **Descendre** changent explicitement l’ordre des pages, dans
l’éditeur et les deux vues de communication. Accueil reste en premier.
Un réordonnancement ne change ni les touches ni leurs positions. Les pages
imbriquées restent une évolution distincte.

## Retirer une page

Ouvrir **Retirer la page…**, choisir la destination des touches (Accueil ou
une autre page active), puis **Prévisualiser le retrait**. L’aperçu montre chaque
mot/dessin, sa page et place d’origine, et sa place de destination. Cocher la
confirmation explicite, puis **Confirmer le retrait de la page**. Annuler
l’aperçu ne change aucune donnée.

Les touches transférées sont ajoutées **après la dernière place occupée de
leur zone** dans la destination. Les autres touches et les cases libres restent
en place. Les positions réservées et les touches encore placées provisoirement
sont prises en compte pour éviter une collision ou un glissement. Une touche
hors du clavier garde ce statut ; son transfert ne la valide pas. Une page vide
peut aussi être retirée après confirmation.

La page est archivée et disparaît de la navigation. Son identité, son nom et son
historique restent conservés. Aucune touche, photo, séquence, interprétation ou
validation n’est supprimée. Le nom peut être utilisé pour une nouvelle page
active ; il s’agit alors d’une autre identité. Les positions provisoires des
autres touches sont enregistrées à leurs coordonnées actuelles lorsqu’un
déplacement les rendrait instables.

Si le clavier, un dessin ou le nom d’une page a changé depuis l’aperçu, la
confirmation est refusée avec 409. Le clavier est relu ; préparer un nouvel
aperçu avant de confirmer. Après une réponse réseau incertaine, vérifier l’état
actualisé : aucune écriture n’est rejouée automatiquement. Dans un autre onglet
de communication déjà ouvert, recharger pour voir l’organisation actuelle.

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
le profil. Les pages ont un `sort_order` et un statut `active`/`archived`.
Le nom est unique parmi les pages actives d’un profil. La création, le renommage,
le réordonnancement, les déplacements et le retrait avec transfert sont
transactionnels. L'effacement explicite de la mémoire d'un profil inclut ses pages.

- `GET /api/v1/profiles/{profile_id}/keyboard-groups` : pages actives du profil, dans l’ordre choisi.
- `POST /api/v1/profiles/{profile_id}/keyboard-groups` : `label` et `actor_role`.
- `PATCH /api/v1/profiles/{profile_id}/keyboard-groups/{group_id}` : nouveau `label`, `actor_role`, et `expected_label` pour protéger un nom affiché devenu périmé.
- `PUT /api/v1/profiles/{profile_id}/keyboard-groups/order` : liste complète `group_ids`, ordre lu `expected_group_ids`, `actor_role`.
- `POST /api/v1/profiles/{profile_id}/keyboard-groups/{group_id}/removal-preview` : `destination_group_id` obligatoire, UUID ou null ; lecture seule.
- `POST /api/v1/profiles/{profile_id}/keyboard-groups/{group_id}/remove` : destination, `preview_token`, rôle et `confirm: true` (booléen strict).
- `POST /api/v1/profiles/{profile_id}/keyboard/{block_id}/move-preview` : destination et `position` (à partir de 0) ; lecture seule.
- `POST /api/v1/profiles/{profile_id}/keyboard/{block_id}/move` : destination, position, `preview_token`, `actor_role`.
- `PUT /api/v1/profiles/{profile_id}/keyboard/{block_id}` : paramètres habituels,
  plus `group_id` (UUID de page ou null pour Accueil).

Une ancienne requête omettant `group_id` conserve la page actuelle lors d'un
placement personnel. Passer explicitement null retire la touche de sa page.
Choisir la zone stable conserve son caractère global. Les noms sont limités à
80 caractères, uniques parmi les pages actives du profil avec comparaison exacte ; Accueil est réservé
indépendamment des majuscules. Les erreurs n'exposent aucun contenu personnel.

Le jeton de l’aperçu lie l’opération au profil et à l’état courant des pages,
touches, représentations et positions, y compris les positions projetées.
Le serveur le recalcule sous le même verrou de profil avant toute écriture.
Toutes les positions et l’audit sont validés ensemble ; une erreur annule
l’ensemble. Un transfert écrit uniquement la présentation et l’audit, sans
nouvelle décision de validation ni appel IA. Le changement explicite de zone
ou de stabilité conserve le parcours de placement humain existant.

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

La migration additive `0010_keyboard_organization` reprend l’ordre de création
des pages existantes, les marque actives et conserve toutes les positions.
Le downgrade est refusé si une page a été archivée ou si son ordre choisi
diffère de cet ordre initial. Une ancienne application n’affiche pas correctement
les pages archivées ni l’ordre choisi ; privilégier une version compatible.

Les sauvegardes sont exportées en **v3** : ordre et statut des pages sont
obligatoires, pages archivées et historique compris. Les fichiers **v1/v2**
restent restaurables dans leur ordre de création, avec pages actives. Les
empreintes des anciennes demandes restent identiques pour préserver leurs
reçus de reprise, même après purge. Une position liée à une page archivée
rend un fichier v3 invalide. Voir [Sauvegarde de profil](PROFILE_BACKUP.md).

Les tests couvrent les places distinctes, les collisions, les repères stables
globaux, l'isolation API et les clés étrangères, le renommage sans déplacement,
la conservation des séquences ordonnées, la compatibilité des anciennes requêtes,
les conflits de noms, le rollback si l'audit échoue, l'effacement de mémoire et
la comparaison des migrations aux modèles SQLAlchemy.

Le navigateur est vérifié sur une base jetable : créer Personnes et Besoins,
placer Maman et Boire chacun en case 1, renommer Personnes en Mes proches,
composer les deux mots depuis leurs pages et reprendre le message après
rechargement. Les quatre repères stables restent visibles dans les deux pages.

Le parcours d’organisation vérifie aussi le réordonnancement, les déplacements
avec aperçu, le maintien des positions provisoires, une photo, un aperçu devenu
périmé, le retrait d’une page remplie et d’une page vide, la réutilisation d’un
nom, le brouillon répété conservé et la restauration v3. Les rendus ordinateur
et mobile sont inspectés sur une base fictive, sans débordement horizontal.
La suite comporte 537 tests backend avec PostgreSQL/Redis, et 35 tests
frontend, plus Ruff, Prettier, TypeScript et compilation Next.js.
