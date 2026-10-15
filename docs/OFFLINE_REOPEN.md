# Réouvrir le clavier sans réseau

Cette évolution ajoute un écran autonome `/offline`, utilisable après une
préparation explicite sous HTTPS (ou sur localhost pour les essais).

1. Dans la communication, ouvrez « Mon clavier pour les coupures » et préparez
   la copie habituelle des touches validées.
2. Dans « Réouvrir sans réseau », choisissez une phrase secrète distincte
   d'au moins 15 caractères et confirmez-la. Préparez la réouverture protégée.
3. Ouvrez « Mon écran hors connexion » dans un nouvel onglet. Vérifiez votre
   copie et gardez ce lien en favori avant de couper le réseau.
4. Même après fermeture de l'onglet, ouvrez `/offline`, choisissez la copie et
   saisissez sa phrase secrète. Composez et lisez vos mots avec une voix locale
   disponible. Chaque changement du brouillon est enregistré dans la copie protégée.
5. Au retour du réseau, choisissez le rôle humain, cochez la demande
   d'enregistrement puis « Vérifier mes accès et enregistrer ». Si nécessaire,
   reconnectez-vous dans PictoFlow en ligne avant de réessayer.

Une copie appartient au compte qui l'a préparée. Le serveur doit vérifier une
session actuelle et son accès au profil avant l'import ; la phrase secrète ne
donne aucun droit serveur. Un autre compte ne peut pas enregistrer ce brouillon
depuis cet écran. Le mode de développement sans comptes reste distinct.

L'import crée seulement une composition terminée, sans interprétation ni
validation automatique. Le même identifiant d'envoi est conservé après une
réponse perdue. Un clavier modifié ou un conflit exige une nouvelle copie ; le
brouillon reste lisible. Aucun envoi automatique à la reconnexion n'a lieu.

## Conservation locale

Le service worker conserve uniquement le document générique et les fichiers
publics immuables de l'application. Il ne met en cache aucune API, session,
page de profil ou photo personnelle. Une préparation incomplète n'active pas
le nouveau cache. L'image Docker inclut le service worker public.

La copie du clavier, ses photos et son brouillon sont chiffrés ensemble dans
IndexedDB avec AES-GCM, une clé dérivée par PBKDF2/SHA-256 (250 000 itérations),
un sel aléatoire et un nouvel IV à chaque écriture. La clé est non exportable et
reste en mémoire de l'onglet ; la phrase secrète n'est jamais enregistrée ou
envoyée. Les identifiants du compte/profil et la date restent visibles dans les
métadonnées locales. Les conflits entre onglets empêchent un ancien brouillon
d'écraser un changement récent.

« Verrouiller ma copie » ferme le contenu déchiffré. La déconnexion de PictoFlow
efface aussi les copies protégées et les caches de l'écran local ; les autres
onglets se verrouillent. L'effacement local ne supprime pas le PCL serveur.
Un appareil déjà hors ligne ne reçoit pas une révocation distante : le contenu
préparé reste accessible avec sa phrase secrète jusqu'à son effacement local.

Cette copie est indépendante du brouillon de l'écran de communication habituel.
Elle n'est pas remplacée silencieusement lors d'une nouvelle préparation. En cas
d'oubli de la phrase secrète, effacez la copie locale et préparez-en une nouvelle
en ligne. Le navigateur peut retirer ses données locales ou refuser le stockage :
ce mode n'est pas une sauvegarde et doit être essayé sur l'appareil concerné.

## Vérifications

Les tests unitaires couvrent secret incorrect, altération, séparation des profils,
absence de mots/clés en clair, rotation de l'IV, concurrence, suppression et
déconnexion. Le test du worker interdit toute interception des API et des médias.
Le parcours CI `offline-reopen.mjs` couvre une nouvelle navigation sans réseau,
réouverture du brouillon, erreur d'identité, réponse d'import perdue, mobile et
effacement entre onglets. Le contrôle de déconnexion utilise une vue de compte
fictive ; les droits et sessions réels sont couverts séparément par les tests API.

Références d'implémentation : [dérivation des clés](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)
et [service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
