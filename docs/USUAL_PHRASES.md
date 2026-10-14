# Phrases habituelles et raccourcis choisis

Dans **Mémoire validée**, chaque message accepté propose **Utiliser ce message**
et **Ajouter à mes raccourcis**. Le rôle du choix est explicite : personne
utilisatrice, aidant ou professionnel. Ce choix est enregistré dans PostgreSQL
et audité ; il ne confirme ni ne corrige une interprétation.

Dans les deux vues de communication, ouvrir **Mes phrases habituelles et
raccourcis**. **Mes raccourcis** ne montre que les messages explicitement choisis.
**Toutes mes phrases acceptées** permet de retrouver les autres messages, avec
recherche sur le texte retenu et six cartes par page. Les raccourcis arrivent
en premier ; aucune fréquence d’utilisation ne choisit une phrase à votre place.

**Utiliser cette phrase** affiche un panneau **Ma phrase choisie** et y place le
focus. Il conserve la composition en cours, son identité, l’ordre et les
répétitions de ses touches. Il ne crée aucune nouvelle séquence, relation,
interprétation ou validation. Les mots/dessins liés utilisent l’affichage actuel
du clavier, avec des emplacements indisponibles lorsqu’une référence manque.

**Lire cette phrase** est une action distincte. Elle relit d’abord le message
accepté depuis le PCL, puis utilise la voix française locale disponible dans le
navigateur. Si le texte a changé depuis son affichage, l’écran montre la nouvelle
phrase et demande de la vérifier avant une seconde action de lecture. Un message
refusé ou supprimé ne peut plus être lu par ce parcours. **Masquer cette phrase**
ferme ce panneau et arrête la lecture ; **Actualiser les phrases** le ferme aussi.
La composition reste disponible. Aucun de ces parcours n’appelle un provider IA.

## Sens humain et choix personnel

- Le texte corrigé est prioritaire ; la proposition d’origine ne devient jamais
  le texte à lire d’un message corrigé.
- Une proposition, un refus ou une séquence inachevée ne peut pas être réutilisé
  ou choisi comme raccourci, même avec une confiance de 1.
- Une correction qui change le texte accepté retire le raccourci. Il faut le
  choisir à nouveau après vérification. Une correction identique le conserve.
- Un refus retire le raccourci. Une confirmation ultérieure ne le réactive pas.
- Retirer un raccourci garde le message et ses décisions dans la mémoire.
- Les rôles enregistrés restent déclaratifs ; ils ne sont pas une authentification.

Le raccourci est une préférence booléenne `Interpretation.shortcut`, par défaut
`false`, sur l’identité d’un message accepté. Il n’est pas une nouvelle touche
du clavier ni une copie indépendante de la phrase. La grille et ses repères
stables restent inchangés. La migration additive
`0009_explicit_phrase_shortcuts` initialise uniquement cette préférence à `false`
sur les messages existants. PostgreSQL refuse un raccourci sur un état non accepté.
La descente de migration est refusée tant qu’un raccourci choisi existe.

## API et sauvegarde

| Route | Effet |
| --- | --- |
| `GET /api/v1/profiles/{profile_id}/phrases/{interpretation_id}` | Message actuellement accepté et séquence source ; lecture seule |
| `PATCH /api/v1/profiles/{profile_id}/phrases/{interpretation_id}/shortcut` | Choix explicite du raccourci avec audit |

Le PATCH exige `selected`, `expected_selected` (booléens stricts),
`expected_text` (texte retenu affiché, jusqu’à 4 000 caractères) et `actor_role`.
Le verrou du profil sérialise choix, corrections et purge. Un texte changé,
un message non accepté ou un choix incompatible renvoie 409, sans reproduire le
contenu personnel. Le même état demandé avec le même texte peut être réessayé
sans doubler l’audit. Une cible étrangère ou absente renvoie 404.

Les sauvegardes **versions 2 et 3** ont `shortcut` obligatoire dans chaque
interprétation. L’export courant est en v3 pour conserver aussi l’organisation
des pages. La restauration conserve les choix dans
le nouveau profil et remappe les références. Les anciens fichiers **version 1**,
sans ce champ, restent acceptés : ils restaurent tous les messages sans raccourci.
Une ancienne application ne lit pas les fichiers d’une version qu’elle ne connaît pas.
L’empreinte canonique des anciennes demandes v1 reste identique : leurs reçus
de restauration continuent à protéger une reprise, même après une purge.

## Vérification

Les tests PostgreSQL vérifient lecture sans mutation, isolation des profils,
correction prioritaire, audit sans validation supplémentaire, reprise après
rechargement, répétitions, refus, corrections ultérieures, ancienne migration,
contrainte SQL et restauration v1/v2. Les tests frontend vérifient le filtrage,
le texte envoyé lors du choix et les liens qui ne transportent que l’UUID.

Le parcours navigateur sur une base fictive vérifie recherche, pagination,
ajout et persistance du choix, passage mémoire/communication, brouillon conservé,
correction et refus avant lecture, profil vide et cible étrangère. Les rendus
ordinateur et mobile sont inspectés et le mobile ne déborde pas horizontalement.
La voix est simulée pour vérifier le texte demandé et l’absence de lecture
automatique ; la qualité audio et la disponibilité d’une voix locale restent
à essayer sur les appareils utilisés. Aucun profil déployé n’est modifié.
