# Photos personnelles sur les touches

Depuis **Clavier**, choisir **Photo personnelle**, écrire le mot, importer une
image et vérifier l'aperçu. **Créer la touche à vérifier** conserve un nouveau
sens personnel, sa représentation et la photo dans une seule transaction.
L'option de sens existant permet de réutiliser un concept du même profil.
La touche devient disponible après **Valider le dessin et le mot**.

Pour une touche déjà validée, ouvrir **Choisir une photo pour…**, importer et
cliquer sur **Valider la photo de…**. Le mot, le concept et la position, y compris
les repères stables et les cases libres, sont conservés. La photo sélectionnée
apparaît aussi dans le message composé et après reprise de ce message.

## Formats et conservation

- JPEG, PNG et WebP fixes ; fichiers d'entrée limités à 5 MiB et 20 millions de pixels.
- Décodage réel ; refus des fichiers tronqués, animations et autres formats.
- Orientation EXIF appliquée, réduction proportionnelle à 1024 × 1024 maximum.
- Réencodage JPEG sur fond blanc : EXIF, GPS, commentaires, nom de fichier et
  autres métadonnées ne sont pas conservés. Les transparences deviennent blanches.
- Provenance `personal-photo` ; aucune licence ou autorisation commerciale n'est
  déduite du fichier. La personne doit disposer du droit de l'utiliser.
- Aucun envoi de pixels au provider IA, aucune description automatique de la photo.

Les pixels réduits sont stockés en `bytea` dans la table PostgreSQL `photo_asset`,
avec taille, empreinte SHA256, profil et référence à la représentation du même
profil. Chaque photo stockée est limitée à 2 MiB. Le stockage et la transaction
PCL sont communs : une panne ne laisse ni fichier orphelin ni représentation
sans photo. Les tentatives explicites portant le même identifiant et la même
photo normalisée ne dupliquent pas la touche ou ses validations. Aucune écriture
n'est rejouée automatiquement après un rechargement.

Ce choix convient à ce prototype et simplifie les sauvegardes. Si le volume de
photos exige ensuite du stockage objet, garder la représentation PCL comme
référence, prévoir une migration et la réconciliation des écritures de fichiers.

## Lecture et suppression

La lecture exige le profil et l'identifiant de la représentation. Les références
ne peuvent désigner aucun fichier local ni URL externe. Un autre profil reçoit
404. Une représentation proposée peut être prévisualisée dans l'éditeur ; seules
les représentations validées sont projetées dans le clavier de communication.
Les photos rejetées ou archivées ne sont pas servies. Les réponses JPEG utilisent
`Cache-Control: no-store` et `X-Content-Type-Options: nosniff` ; le proxy admin
conserve le contenu binaire et le type JPEG. Une photo indisponible laisse le mot
lisible avec le repère neutre.

Cette isolation par profil conserve les frontières du prototype ; elle ne remplace
pas l'authentification et les droits d'accès, encore à implémenter avant une
exposition publique. Il n'existe aucun répertoire statique public de photos.

**Photos conservées** affiche les choix du profil. Pour supprimer une photo utilisée,
choisir auparavant un autre dessin ou une autre photo sur toutes ses touches
validées. **Supprimer cette photo** efface les pixels et archive la représentation
dans une même transaction ; les références et l'historique du choix restent
consultables. La suppression est définitive dans la base active. Les copies déjà
présentes dans des sauvegardes suivent la politique de conservation des sauvegardes.
L'effacement explicite de toute la mémoire du profil supprime aussi ses photos.

## API

- `POST /api/v1/profiles/{profile_id}/blocks/photo` : JSON avec `request_id`,
  `label`, `actor_role`, `photo_base64` et éventuellement `concept_id`.
- `PUT /api/v1/profiles/{profile_id}/blocks/{block_id}/photo` : JSON avec
  `request_id`, `actor_role`, `photo_base64`. Exige une touche validée liée à un concept.
- `GET /api/v1/profiles/{profile_id}/representations/{representation_id}/photo` : JPEG.
- `DELETE /api/v1/profiles/{profile_id}/representations/{representation_id}/photo?actor_role=user` :
  suppression explicite d'une photo inutilisée. Le rôle peut aussi être `caregiver` ou `professional`.

Le backend borne la lecture du corps avant son décodage JSON ; le proxy borne
également les requêtes, même sans `Content-Length`. Les erreurs ne renvoient ni
pixels, ni base64, ni diagnostics du décodeur. Les pixels n'entrent pas dans les
instantanés d'audit sémantique ou dans les logs techniques.

## Sauvegarde et migration

La migration additive `0005_personal_photos` ne modifie aucune touche existante.
Les sauvegardes PostgreSQL complètes décrites dans [SERVER_DEPLOYMENT.md](SERVER_DEPLOYMENT.md)
incluent les pixels et leurs métadonnées ; aucun volume de fichiers supplémentaire
n'est nécessaire. Restaurer ensemble la base entière, les représentations et les
photos. Vérifier sur une instance isolée la lecture d'une photo connue et son
empreinte après restauration. Une simple vérification du catalogue `pg_restore --list`
ne constitue pas un essai de restauration.

Le downgrade de cette migration est refusé tant que la table contient des photos,
afin de ne pas effacer des images personnelles implicitement. Une ancienne version
de l'application peut afficher un repère neutre à leur place ; conserver le schéma
et les données lors d'un retour applicatif, ou coordonner une restauration complète.

## Vérifications

Les tests vérifient le décodage, les limites, l'orientation et la suppression des
métadonnées, l'isolation des lectures et remplacements, le refus des références
forgées, les tentatives répétées, le rollback d'une écriture de pixels interrompue,
la conservation des repères stables, la suppression contrôlée, l'effacement de
mémoire et le refus de downgrade contenant des photos. Les migrations restent
comparées aux modèles SQLAlchemy.

Le navigateur est essayé sur une base jetable avec deux fichiers fictifs : import,
aperçu avec mot, création, validation, position stable avec une case libre,
remplacement, affichage dans le message et reprise après rechargement.

Une sauvegarde `pg_dump -Fc` de cette démonstration est aussi restaurée avec
`pg_restore --exit-on-error` dans une base distincte jetable. Les comptages des
14 tables et les deux photos restaurées (contenu SHA256, dimensions, références
de profil/représentation) sont identiques à la base source.

Le décodage et l'orientation utilisent la documentation officielle de
[Pillow Image](https://pillow.readthedocs.io/en/stable/reference/Image.html) et
[ImageOps](https://pillow.readthedocs.io/en/stable/reference/ImageOps.html).
