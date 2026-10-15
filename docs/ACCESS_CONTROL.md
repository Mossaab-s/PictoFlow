# Comptes personnels et accès par profil

Cet incrément prépare le mode multi-compte demandé. Il est désactivé par défaut
pour conserver l’instance de test pendant sa préparation. **Il ne protège le
serveur qu’une fois activé**, après configuration de HTTPS et création du premier
administrateur. La PR #43 est déployée ; le frontal et sa procédure d'activation
sont décrits dans [LOCAL_HTTPS.md](LOCAL_HTTPS.md).

## Parcours

La personne se connecte avec son identifiant et sa phrase de passe, puis retrouve
uniquement ses profils autorisés. La communication dédiée garde son clavier,
ses mots, sa voix et la validation des phrases. Les commandes de préparation
s’affichent seulement lorsque le compte possède cet accès.

Dans **Comptes et accès**, un administrateur peut créer un compte personnel,
choisir ses profils, retirer un accès, désactiver le compte ou remplacer son mot
de passe. Le navigateur ne peut pas créer un administrateur. Il faut passer par
la console du serveur pour ajouter un autre administrateur.

| Action | Communiquer | Préparer et communiquer | Administrateur |
| --- | --- | --- | --- |
| Voir ses profils, touches et mémoire | Profils attribués | Profils attribués | Tous |
| Composer, lire, demander une phrase | Oui | Oui | Oui |
| Confirmer, corriger ou rejeter une phrase | Oui | Oui | Oui |
| Importer explicitement son brouillon local | Oui | Oui | Oui |
| Modifier touches, pages, concepts, relations et raccourcis | Non | Oui | Oui |
| Exporter une sauvegarde ou effacer le PCL du profil | Non | Oui | Oui |
| Créer ou restaurer un profil | Non | Non | Oui |
| Gérer comptes et attributions, voir le provider | Non | Non | Oui |

Un nouveau compte n’a aucun profil attribué. Les changements d’attribution et
d’état du compte utilisent la valeur précédemment lue ; un écran périmé reçoit
409 et doit être actualisé. Désactiver le dernier administrateur ou son propre
compte administrateur est refusé. Le rôle déclaré « utilisateur / aidant /
professionnel » dans une validation ne donne **aucun droit d’accès**.

L’API vérifie la session et les attributions à chaque requête, indépendamment
des boutons affichés. Une session déjà ouverte perd donc son accès dès la
prochaine requête après révocation. Un profil non attribué répond comme un
profil absent. Les permissions serveur ne dépendent jamais d’un rôle fourni
dans le corps d’une requête. Ce choix suit le contrôle par requête et le refus
par défaut décrits par [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

## Sessions et mots de passe

Les phrases de passe comportent 15 à 256 caractères, sans troncature ni règle
arbitraire de composition. Elles sont stockées avec Argon2id via `argon2-cffi`,
avec un sel aléatoire et les paramètres `m=19456`, `t=2`, `p=1`. Les choix de
longueur et de hachage s’appuient sur [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
et [Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
La bibliothèque assure le hachage, la vérification et la détection des paramètres
à renouveler ; voir sa [documentation](https://argon2-cffi.readthedocs.io/en/stable/howto.html).

La session utilise un jeton aléatoire de 256 bits. Seule son empreinte SHA-256
est stockée en base. Le cookie est `HttpOnly`, `SameSite=Strict`, `Secure` sous
HTTPS, sans domaine partagé, avec le préfixe `__Host-` en HTTPS. Le navigateur
ne stocke aucun jeton d’authentification dans `localStorage`. Les réponses
personnelles ont `Cache-Control: no-store`. Les sessions expirent après huit
heures par défaut, sans prolongation automatique, et sont révoquées à la
déconnexion, lors d’un changement de mot de passe ou d’une désactivation.
Ces mécanismes reprennent les principes de [gestion des sessions OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

Chaque écriture authentifiée exige l’origine exacte de l’application et un
jeton CSRF dérivé de la session. La connexion exige aussi l’origine attendue.
Les erreurs de connexion ne distinguent pas compte absent, inactif ou mauvais
mot de passe. Les tentatives sont limitées en PostgreSQL : cinq par identifiant
avant attente, et cent au total par fenêtre de quinze minutes. Une connexion
réussie réinitialise le compteur de l’identifiant. Ce plafond global est adapté
au prototype avec quelques personnes ; le contrôle par adresse et les autres
protections d’une exposition publique restent à préparer avec le frontal HTTPS.

## Déconnexion, onglets et copies locales

Un navigateur partage le même compte entre ses onglets. Le changement de compte
et la déconnexion sont signalés aux autres onglets. Une réponse reçue pour
l’ancienne session ne doit pas remplir l’écran du compte suivant.

**Se déconnecter et effacer les copies locales** ferme l’accès affiché, efface
la base locale de claviers/brouillons et les références de message du navigateur.
Un autre onglet doit être fermé si le stockage bloque l’effacement ; une erreur
est affichée plutôt qu’un succès supposé. Les préférences de présentation et
de voix peuvent rester : elles ne contiennent pas de message.

Si le réseau est coupé, le navigateur reste verrouillé, y compris après un
rechargement une fois le réseau revenu. Une nouvelle connexion remplace la
session précédente. La fermeture de la session **sur le serveur** ne peut pas
être confirmée pendant la coupure : l’écran le précise. Le marqueur local de
verrouillage ne contient aucune identité ni aucun jeton. Si le navigateur bloque
la persistance locale, la révocation serveur demeure la protection durable et
doit être vérifiée au retour du réseau.

Un écran déjà ouvert peut encore composer son brouillon local pendant une
coupure. Une révocation serveur ne peut pas effacer à distance des données déjà
téléchargées sur un appareil déconnecté. Le partage d’un appareil doit donc
inclure la déconnexion choisie et l’effacement de ses copies.

## Activer après la mise en place de HTTPS

La migration `0011_accounts_and_access` ajoute les tables de comptes, sessions,
attributions, limitation des connexions et journal des accès. Elle n’altère
aucune donnée PCL et ne crée aucun compte ou mot de passe par défaut. Un downgrade
refuse d’effacer des tables d’accès contenant des données.

Après sauvegarde de la base, application de la migration et installation du
frontal HTTPS, créer le premier administrateur dans une console interactive,
depuis le répertoire de livraison sur le serveur :

```sh
docker compose --env-file /home/mossaab/pictoflow/.env.server \
  -f deploy/docker-compose.server.yml exec backend \
  python -m scripts.manage_accounts create-admin mon-identifiant --name "Nom affiché"
```

La console demande deux fois le mot de passe, avec saisie masquée. Ne pas le
mettre dans la commande, un fichier versionné ou une variable d’environnement.
Le script est également disponible localement depuis `backend/`.

Configurer ensuite dans l’environnement privé du backend :

```ini
PICTOFLOW_AUTH_ENABLED=true
PICTOFLOW_AUTH_ORIGIN=https://adresse-reelle-de-pictoflow
PICTOFLOW_AUTH_SESSION_HOURS=8
PICTOFLOW_DEBUG=false
```

Utiliser l’origine réellement ouverte dans le navigateur, avec son port éventuel.
Le backend refuse un mode authentifié sans HTTPS en production. L’exception HTTP
est limitée à une origine de boucle locale en développement/test. Une origine
avec chemin, identifiants, requête ou port invalide est refusée. Les migrations
restent exécutables avant l’activation.

Recréer le backend, ouvrir la connexion par HTTPS, tester d’abord un compte sans
attribution, puis attribuer un profil et vérifier la séparation des accès. Sur
un navigateur ayant déjà préparé des copies locales, se déconnecter explicitement
pour les effacer avant de partager l’appareil.
Recharger aussi les anciens onglets afin qu’ils utilisent la version avec
connexion et effacement coordonné.

Pour récupérer un compte depuis la console du serveur :

```sh
python -m scripts.manage_accounts reset-password mon-identifiant
```

Cette commande remplace le mot de passe et révoque ses sessions. Aucun endpoint
de récupération anonyme ou d’inscription publique n’est fourni.

## Sauvegardes et provenance

Les comptes, empreintes de mot de passe, sessions et attributions sont séparés
du PCL. Ils ne passent jamais par le provider IA. Les sauvegardes de profil v3
ne les exportent pas et une restauration ne recopie aucun droit d’accès. Il faut
attribuer explicitement le profil restauré. La sauvegarde PostgreSQL complète
du serveur est nécessaire pour récupérer les comptes.

Les validations créées par une session authentifiée enregistrent sa référence
de compte côté serveur ; le client ne peut pas la choisir. Les décisions
historiques restaurées conservent leur provenance antérieure. Le journal d’accès
enregistre création de compte, connexions, changement d’état/de mot de passe et
attributions, sans mot de passe ni contenu de message. Une entrée
`request_authorized` décrit une autorisation de requête, pas la réussite de la
modification PCL qui suit ; l’audit métier reste dans sa transaction habituelle.

Les essais couvrent l’API réelle, les routes PCL sans session, CSRF, origines,
cookies, attributions, révocation, erreurs de connexion, récupération et le
parcours navigateur sur une base jetable. L’authentification multifacteur,
l’auto-récupération et une exposition publique ne font pas partie de cet incrément.
