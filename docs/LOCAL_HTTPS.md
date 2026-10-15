# HTTPS et comptes sur le réseau local

Le profil Compose `https` ajoute Caddy devant Next.js, sans modifier le PCL ni
transmettre les secrets PostgreSQL ou IA au frontal. Une autorité locale conserve
ses certificats dans le volume `pictoflow-server_https_data`. Elle renouvelle les
certificats du serveur ; les appareils doivent approuver son certificat public.
Ce comportement est décrit dans la [documentation Caddy](https://caddyserver.com/docs/automatic-https#local-https).

## Configuration

Après sauvegarde PostgreSQL, conserver les identifiants existants et ajouter dans
le fichier privé `.env.server` :

```ini
COMPOSE_PROFILES=https
PICTOFLOW_HTTPS_ADDRESS=10.0.0.121
PICTOFLOW_HTTPS_LEGACY_PORT=3000
PICTOFLOW_BIND_ADDRESS=127.0.0.1
PICTOFLOW_ADMIN_PORT=3001
PICTOFLOW_AUTH_ORIGIN=https://10.0.0.121
# Garder false jusqu'à la création de l'administrateur et l'essai TLS.
PICTOFLOW_AUTH_ENABLED=false
```

Les ports LAN 80 et 3000 redirigent vers une destination HTTPS fixe, en conservant
chemin et paramètres. Ils ne servent aucune donnée applicative. Le port 443 sert
l'application ; le port HTTP interne 3001 reste sur la boucle locale du serveur.
Les ports 80, 443 et 3000 doivent être libres à l'adresse choisie. Ne pas publier
Next.js sur une adresse LAN en parallèle. Le profil est mémorisé dans le fichier
d'environnement pour que les commandes Compose suivantes conservent le frontal.
Le backend et PostgreSQL ne publient aucun port sur le LAN.

Depuis le répertoire de livraison, avec les droits Docker :

```sh
docker compose --env-file /home/mossaab/pictoflow/.env.server \
  -f deploy/docker-compose.server.yml up -d --wait --wait-timeout 180
```

## Approuver le certificat sur les appareils

Exporter uniquement le certificat **public** de l'autorité locale :

```sh
docker compose --env-file /home/mossaab/pictoflow/.env.server \
  -f deploy/docker-compose.server.yml exec -T https \
  cat /data/caddy/pki/authorities/local/root.crt > pictoflow-local-ca.crt
openssl x509 -in pictoflow-local-ca.crt -noout -fingerprint -sha256
```

Transférer ce fichier par le canal SSH de confiance. Comparer son empreinte avec
celle affichée sur le serveur avant de l'installer. Ne jamais exporter `root.key`,
les clés intermédiaires ou le volume Caddy vers les appareils.

Sur Windows, PowerShell permet une installation limitée à l'utilisateur courant :

```powershell
Import-Certificate -FilePath .\pictoflow-local-ca.crt -CertStoreLocation Cert:\CurrentUser\Root
```

Sur iPhone/iPad, installer le certificat comme profil puis activer sa confiance
complète dans les [réglages des certificats Apple](https://support.apple.com/fr-fr/102390).
Sur Android, installer le certificat CA dans les [paramètres de sécurité](https://support.google.com/pixelphone/answer/2844832?hl=fr) ;
les règles peuvent varier selon l'appareil ou sa gestion par une organisation.
Sur Firefox, vérifier la [confiance dans le magasin système](https://support.mozilla.org/fr/kb/se-fier-certificats-racines-tiers)
si le certificat n'est pas reconnu.

Ouvrir ensuite `https://10.0.0.121`, sans ignorer une alerte de certificat.
Un appareil sans cette autorité reçoit une erreur TLS : le HTTPS local n'est pas
automatiquement approuvé sur les autres postes.

## Créer l'administrateur et activer les comptes

Suivre la commande interactive de [gestion des comptes](ACCESS_CONTROL.md#activer-après-la-mise-en-place-de-https).
Créer un mot de passe propre à l'application, différent de celui du serveur.
Une fois HTTPS vérifié et l'administrateur créé, définir
`PICTOFLOW_AUTH_ENABLED=true` et recréer le backend :

```sh
docker compose --env-file /home/mossaab/pictoflow/.env.server \
  -f deploy/docker-compose.server.yml up -d --no-deps --wait backend
```

Vérifier le formulaire de connexion, la connexion administrateur, le refus du PCL
sans session et les attributions d'un compte limité. Les cookies de session doivent
rester `Secure`, `HttpOnly`, `SameSite=Strict` et ne jamais être journalisés.
Déconnecter les navigateurs partagés pour effacer leurs anciennes copies locales.

## Exploitation et retour arrière

Conserver les volumes `https_data` et `https_config` lors des mises à jour et
redémarrages. Le volume `https_data` contient les clés de l'autorité : le sauvegarder
chiffré, avec accès opérateur uniquement, séparément des exports de profils.
Sa perte exige une nouvelle installation de confiance sur les appareils.
Ne pas employer `down --volumes` sur le projet serveur.

Une sauvegarde PostgreSQL complète inclut les comptes et les droits ; un export
de profil PCL ne les inclut pas. Après activation, garder les comptes activés lors
d'un retour à des images compatibles. Si HTTPS échoue, réparer le frontal depuis
SSH plutôt que réexposer les données en HTTP ou désactiver les comptes.

Le test `python deploy/test_local_https.py` utilise un projet Docker jetable, une
autorité et un serveur fictifs. Il vérifie un certificat IP réellement approuvé,
le refus sans autorité, les redirections même avec un Host forgé, les en-têtes de
session/CSRF et la conservation de l'autorité après redémarrage. Il ne touche pas
aux volumes du serveur.
