# Composer pendant une coupure

Dans les deux vues de communication, ouvrir **Mon clavier pour les coupures**,
puis **Préparer mon clavier** pendant que le serveur est accessible. Cette
action choisie conserve une copie des touches validées, pages, placements,
dessins et photos utilisés par ce profil dans ce navigateur. Elle ne valide
aucun élément et ne lance pas le provider IA.

Ce premier incrément permet de communiquer dans **l’écran déjà ouvert** pendant
une coupure. La réouverture complète de l’application sans réseau n’est pas
implémentée. Les service workers nécessaires à un cache de l’application
demandent un contexte sécurisé, HTTPS ou localhost ; l’adresse LAN actuelle
est en HTTP. Voir [les exigences du navigateur](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
Cette extension viendra avec le travail sur HTTPS et le cache de l’application.

## La copie et son message local

La date de préparation reste visible. La copie peut être plus ancienne que le
PCL actuel : ce n’est pas une nouvelle source de vérité. Les cases libres, pages,
repères stables et tailles d’affichage restent ceux de cette présentation.
Les photos sont incluses comme les pixels JPEG normalisés déjà conservés dans
PostgreSQL ; les dessins sont intégrés au code. La simple lecture ne demande
pas de ressource distante ni de formulation IA.

Choisir les touches dans **ce clavier local** compose **Mon message local**,
avec leur ordre et leurs répétitions, dans la limite de 32 sélections.
**Annuler la dernière touche locale**, **Effacer le brouillon local** et
**Lire mes mots locaux** fonctionnent pendant la coupure. La voix utilise les
mêmes réglages locaux et le même arrêt que le reste de l’écran. Son moteur doit
être disponible sur l’appareil ; voir [Accessibilité et voix](COMMUNICATION_ACCESSIBILITY.md).
**Enregistrer mes mots en texte** télécharge les mots affichés, sans interprétation.

Le message serveur en cours reste séparé : ses identifiants et sa séquence ne
sont pas modifiés par cette composition. La copie et son brouillon sont conservés
par profil dans IndexedDB. Après retour de la connexion et rechargement, ouvrir
à nouveau le panneau retrouve le brouillon. Il n’est pas partagé entre appareils.

Si le stockage est indisponible ou plein, un message explique que les données
restent uniquement dans l’écran ouvert. Garder cet écran ouvert et enregistrer
ses mots en texte avant de le quitter. Le navigateur peut également évincer ses
données locales ; cette copie ne remplace pas une sauvegarde PCL.

## Enregistrer au retour de la connexion

La reconnexion n’envoie rien automatiquement. Cocher **Je souhaite terminer et
enregistrer ce message sur le serveur**, choisir le rôle avec **J’enregistre en
tant que**, puis **Enregistrer le message local** envoie une demande explicite.
Le serveur contrôle le profil, relit le clavier sous son verrou, compare la
révision de la copie et vérifie toutes les touches avant d’enregistrer une
séquence terminée dans une transaction unique.

L’enregistrement conserve les mots sélectionnés, leurs identités, leur ordre et
leurs répétitions. Il n’accepte aucun sens personnel, ne crée pas d’interprétation
et n’appelle pas l’IA. La séquence et l’événement d’import entrent dans PostgreSQL
ensemble ; un échec tardif ne laisse pas une partie du message.

Après succès, **Ouvrir le message enregistré** permet d’ouvrir la séquence dans
le parcours habituel. Si un message serveur est encore ouvert, utiliser d’abord
**Nouveau message** : l’import n’écrase pas ce message en cours. On peut ensuite
demander une proposition et la valider humainement avec le parcours habituel.
**Nouveau brouillon local** conserve le clavier préparé pour une autre composition.

## Réponse perdue et conflits

Avant l’envoi, le navigateur conserve une identité de demande et son contenu.
Pendant un envoi non confirmé, ce contenu ne peut pas être modifié ou supprimé.
**Vérifier l’envoi** reprend cette même demande uniquement sur action choisie.
Si le serveur l’a déjà enregistrée, il rend la même séquence sans doublon ni
nouvel audit. Un autre contenu ou rôle avec cette identité reçoit un refus.
Sans stockage local, cette protection reste limitée à l’écran ouvert.

Si le clavier a changé, le serveur répond 409 sans enregistrer de séquence. Le
brouillon et ses anciens mots restent disponibles à l’écran et en fichier texte.
Copier ou enregistrer les mots, effacer ce brouillon, **Actualiser la copie du
clavier**, puis recomposer et confirmer la nouvelle sélection. Les modifications
de mots, sens, validation, représentation/photo, page ou placement sont contrôlées
par la révision ; même un changement de présentation impose cette nouvelle
préparation. Il n’y a pas de fusion ou de substitution silencieuse.

Deux onglets ne peuvent pas écraser leurs modifications locales : chaque écriture
IndexedDB compare la version lue dans une transaction. En cas de conflit, utiliser
**Relire le brouillon local** avant de reprendre. Cette lecture ne rejoue aucun
envoi. Une copie endommagée demande un effacement explicite ; si un autre onglet
l’a réparée entre-temps, l’effacement ancien est refusé.

## Effacer et sauvegarder

Cocher **J’efface la copie locale et son brouillon de ce profil dans ce navigateur**,
puis **Effacer la copie locale** supprime les mots, photos et brouillon locaux du
profil. Les autres profils et le PCL serveur restent conservés. Un marqueur de
version sans contenu personnel empêche un ancien onglet de réécrire la copie
effacée. Un envoi dont l’issue est inconnue doit d’abord être vérifié.

L’effacement du PCL serveur ne peut pas effacer une copie située dans un navigateur
déconnecté. Effacer aussi les copies locales sur les appareils concernés. La
reconnexion ne valide pas les touches d’une ancienne copie : un clavier supprimé
ou modifié provoque le refus décrit ci-dessus.

Les brouillons non envoyés ne font pas partie d’une sauvegarde serveur.
Les séquences importées et leur audit font partie de l’archive PCL v3 existante ;
aucune migration ni changement de version d’archive n’est ajouté ici. Restaurer
une archive crée un nouveau profil avec de nouveaux identifiants, auquel aucune
ancienne copie locale n’est automatiquement attachée.

## Contrats et vérifications

- `GET /api/v1/profiles/{profile_id}/communication-snapshot` : copie cohérente
  sous verrou du profil, touches validées et médias actuellement choisis uniquement.
  Les placements réservés des touches refusées restent pris en compte lors de
  la projection, sans exposer ces touches. Limite de 20 MiB de pixels normalisés
  cumulés ; une copie trop volumineuse reçoit 413.
- `POST /api/v1/profiles/{profile_id}/offline-drafts` : `request_id`,
  `expected_revision`, `block_ids` ordonnés, `actor_role`, `confirm: true` strict.
  Une à 32 touches. La demande choisit l’identité de la séquence ; son empreinte
  est conservée dans l’audit atomique d’import. Les identités déjà utilisées ne
  peuvent pas remplacer une séquence existante. 409 pour un clavier/contenu périmé,
  404 pour un profil absent, 422 pour un contrat invalide.

Les tests backend PostgreSQL couvrent la copie sans écriture, les profils séparés,
les cases réservées, les photos normalisées et leur remplacement, l’import
ordonné répété, les contrôles de révision, le contrat strict, le doublon, la réponse
perdue et l’annulation complète lors d’un échec d’audit. Les tests frontend
couvrent les données invalides, les bornes, le gel de l’envoi, l’isolation et
les écritures/effacements concurrents sur IndexedDB simulé.

Le navigateur est testé sur une base fictive : coupure réelle du réseau du contexte,
photos visibles, lecture locale simulée, composition répétée, message serveur
conservé, reconnexion sans rejeu, rechargement, réponse perdue après engagement
serveur puis vérification sans doublon, conflit entre onglets, refus d’une ancienne
copie et nouvelle préparation, effacement explicite. Les collections de sens et
validation ne changent pas ; aucun appel IA n’est lancé. Les rendus tablette/mobile
et contrôles axe A/AA sont vérifiés. La réouverture totalement hors connexion,
la qualité audio réelle, l’éviction du stockage et les usages humains demandent
des essais supplémentaires sur appareil.
