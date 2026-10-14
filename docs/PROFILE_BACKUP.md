# Sauvegarder et restaurer un profil

L’onglet **Sauvegarde** d’un profil permet de télécharger un fichier JSON
PictoFlow. Depuis la liste des profils ou cet onglet, **Restaurer une sauvegarde**
ouvre le parcours de restauration.

1. Choisir le fichier téléchargé, jusqu’à **32 Mio** (affichés « 32 Mo »).
2. Vérifier le nom, la date, les touches validées/proposées, les pages,
   les photos, les messages acceptés et les décisions humaines.
3. Choisir le nom du nouveau profil, son rôle de validation et cocher la
   confirmation explicite. Le nom est prérempli ; l’effacer crée un profil sans nom.
4. Restaurer puis ouvrir le clavier obtenu pour le vérifier.

Chaque restauration crée **un nouveau profil**. Les profils existants restent
intacts. Toutes les écritures, y compris les photos et l’historique, sont
effectuées dans une seule transaction PostgreSQL.

## Contenu du fichier v1

Le format `pictoflow-profile`, version entière `1`, contient `exported_at`,
le profil source et les collections obligatoires `records` :

- `concepts`, `representations`, `blocks` et `relations` ;
- `groups` et `positions` : pages, zones, cases libres et repères stables ;
- `sequences`, dans l’ordre des sélections, répétitions comprises ;
- `interpretations`, y compris les corrections, propositions et refus ;
- `gaps`, avec leurs signatures de séquences ;
- `photos`, en base64, avec SHA-256, dimensions et date ;
- `validations` et `audit`, sans tronquer l’historique.

Les licences et provenances des représentations sont conservées. Les photos
stockées dans PostgreSQL sont intégrées octet pour octet. Une photo dont les
pixels ont été supprimés reste absente du fichier ; sa représentation archivée
et son historique restent conservés. Les références de médias externes sont
conservées, sans téléchargement de leurs fichiers.

Le fichier ne contient ni clé API, ni configuration serveur, ni état Redis.
Les préférences d’affichage et la voix du navigateur restent propres à l’appareil.
Les séquences en cours sont copiées mais aucune référence de brouillon du
navigateur n’est créée automatiquement pour le nouveau profil.

Le fichier contient des données personnelles en clair : le conserver dans un
emplacement personnel. La validation de sa structure et des photos ne certifie
pas son origine. Restaurer confirme le fichier choisi ; cela ne transforme pas
une proposition IA en mémoire validée. Les états, dates, corrections et rôles
historiques sont conservés, y compris un ancien rôle non renseigné.

## Contrats et intégrité

Les UUID du profil et de ses objets sont recréés par type d’entité. Toutes les
références structurées, y compris les références des snapshots d’historique,
les pages, les photos, sessions et contextes, suivent cette nouvelle identité.
Les signatures des séquences sont recalculées pour le nouveau profil.
Les mots, intentions, textes, clés canoniques et références d’acteurs ne sont
pas modifiés, même lorsqu’ils contiennent un UUID dans du texte libre.

L’export prend le verrou du profil utilisé par les écritures PCL. L’import
vérifie les statuts, références, positions, unicité, dates, décisions et pixels
JPEG normalisés avant d’écrire. Les photos ne sont pas réencodées. Une erreur
annule l’ensemble de la restauration. Limites : 10 000 lignes par collection,
50 000 lignes au total, fichier de 32 Mio, requête de restauration de 32 Mio
plus 1 Kio d’enveloppe. Les corps sont bornés pendant la lecture du flux,
même sans `Content-Length`. Les champs inconnus, champs persistés manquants,
clés JSON dupliquées et nombres non finis sont refusés.

Le bouton **Réessayer la même restauration** réutilise la demande exacte et son
identifiant dans la page ouverte. Un reçu technique persistant et un verrou
transactionnel PostgreSQL empêchent deux créations pour cette même demande.
Un identifiant déjà utilisé avec un autre contenu renvoie 409. Le reçu reste
présent après la purge explicite de la mémoire : réessayer ne la recrée pas.
Le fichier et la demande restent uniquement en mémoire dans le navigateur ;
fermer/recharger la page termine cette reprise. Vérifier la liste des profils
avant de commencer une nouvelle restauration après une interruption.

## API

| Route | Effet |
| --- | --- |
| `GET /api/v1/profiles/{profile_id}/backup` | JSON à télécharger, `no-store` |
| `POST /api/v1/profiles/restore-preview` | Fichier JSON brut ; aperçu sans écriture et sans IA |
| `POST /api/v1/profiles/restore` | Nouveau profil, réponse 201 |

L’enveloppe de restauration contient `request_id` (UUID), `actor_role`
(`user`, `caregiver`, `professional`), `confirm: true`, `display_name`
(nom ou `null`) et `snapshot` (objet du fichier). Les erreurs restent techniques
et ne reproduisent pas le contenu personnel : 413 pour la taille, 422 pour un
fichier invalide, 409 pour un conflit, 503 si PostgreSQL est indisponible.
Un profil absent à l’export renvoie 404.

Les tests couvrent la restitution de chaque collection, les UUID réutilisés dans
des tables différentes, les répétitions, les décisions anciennes sans rôle,
les photos supprimées/archivées, les fichiers altérés, les refus, le rollback et
la protection du reçu après purge. Le navigateur vérifie téléchargement,
aperçu, confirmation, ouverture du clavier et coexistence avec le profil initial.
Un fichier de 12 Mio traverse aussi le proxy de restauration ; une autre route
le refuse à sa limite habituelle et la connexion suivante reste utilisable.
Quatre demandes identiques lancées en parallèle sur la base de démonstration
renvoient aussi un seul nouveau profil.

La migration additive `0008_profile_restore_receipts` crée uniquement le reçu
technique, sans modifier les données existantes. Le downgrade est refusé tant
qu’un reçu existe ; supprimer ce reçu ferait perdre la protection contre le
rejeu d’une mémoire purgée.

Les sauvegardes automatiques du serveur, l’authentification, le chiffrement
des archives et l’import de fichiers de banques externes restent des travaux
distincts. Ce parcours est une sauvegarde manuelle d’un profil PCL.
