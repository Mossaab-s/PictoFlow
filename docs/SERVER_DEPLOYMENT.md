# Déploiement sur un serveur Linux

Le manifeste `deploy/docker-compose.server.yml` installe l'administration Next.js,
FastAPI, PostgreSQL et Redis dans le projet Docker `pictoflow-server`.
Seul le port de l'administration est publié. Les migrations doivent terminer
avant le démarrage de l'API. Les quatre services redémarrent avec Docker ; la
mémoire PCL reste dans le volume `pictoflow-server_postgres_data`.

Le manifeste démarre par défaut en HTTP sur un réseau local de confiance.
Les comptes personnels sont disponibles depuis la PR #43. Le profil optionnel
`https` et la procédure de [HTTPS local](LOCAL_HTTPS.md) permettent de préparer
leur activation sur une adresse privée, avec certificats persistants et
redirection des anciennes adresses HTTP.
Le mode sans IA reste la valeur par défaut du manifeste. Un provider externe se
configure côté serveur dans `.env.server`. PRISM reste indépendant.
Le mode multi-compte préparé dans [ACCESS_CONTROL.md](ACCESS_CONTROL.md) reste
désactivé par défaut. Il doit être activé après installation de HTTPS et création
de l’administrateur ; ajouter le code seul ne protège pas l’instance LAN.

## Instance validée le 12 octobre 2026

- Administration : [http://10.0.0.121:3000](http://10.0.0.121:3000).
- Livraison : `/home/mossaab/pictoflow/releases/20261012-02`, accessible par
  le lien `/home/mossaab/pictoflow/current` ; images taguées `20261012-02`.
- Configuration : `/home/mossaab/pictoflow/.env.server`, mode `0600`.
- Sauvegarde initiale : `/home/mossaab/pictoflow/backups/initial-20261012.dump`,
  mode `0600` ; le catalogue de l'archive a été relu avec `pg_restore --list`.
- Les quatre services sont sains ; l'API et l'administration ont été redémarrées
  puis vérifiées. Le schéma déployé est conforme aux modèles Alembic/SQLAlchemy.
- Le smoke test isolé passe : **327 tests dans chacun des deux modes Disabled
  et FakeProvider**, avec vérification HTTP des providers sélectionnés par
  l'environnement, PostgreSQL et Redis réels. Ses volumes ont été supprimés.
- Les services PRISM présents sur le serveur restent opérationnels.
- Groq est connecté via le provider `openai-compatible`, à l'URL
  `https://api.groq.com/openai/v1`, avec le modèle `qwen/qwen3.8-27b`.
  Le catalogue authentifié et deux appels réels avec des données fictives ont
  été vérifiés : interprétation avec refus structuré, puis simplification avec
  proposition. Aucun de ces appels de vérification ne modifie le PCL.

L'instance démarre sans profil de démonstration. Les sources transférées viennent
du checkout local, y compris le travail non commité ; aucune publication GitHub
n'est nécessaire pour reproduire cette livraison depuis l'archive.

## Configurer un provider externe

Ajouter ces valeurs dans le fichier privé `.env.server` sur le serveur :

```ini
PICTOFLOW_AI_PROVIDER=openai-compatible
PICTOFLOW_PROVIDER_BASE_URL=https://api.groq.com/openai/v1
PICTOFLOW_PROVIDER_MODEL=qwen/qwen3.8-27b
PICTOFLOW_PROVIDER_TIMEOUT_SECONDS=30
# Ajouter PICTOFLOW_PROVIDER_API_KEY avec la clé, uniquement sur le serveur.
```

La clé n'est transmise qu'au conteneur backend, et n'est jamais incluse dans
l'administration, le service de migration ou l'archive des sources. Le modèle
doit correspondre à l'identifiant exact du catalogue du fournisseur.
Le raccordement Groq utilise HTTPS avec vérification des certificats.

Depuis le répertoire de livraison actif, avec les droits Docker :

```sh
docker compose --env-file /home/mossaab/pictoflow/.env.server \
  -f deploy/docker-compose.server.yml up -d --no-deps --wait backend
```

Vérifier ensuite [l'état du provider](http://10.0.0.121:3000/admin/providers).
Pour retrouver le mode sans IA, définir `PICTOFLOW_AI_PROVIDER=disabled`, retirer
la clé du fichier privé, puis recréer le backend avec la même commande.
La configuration précédant l'activation Groq est conservée en mode `0600` dans
`/home/mossaab/pictoflow/.env.server.before-groq`.

## Préparer une livraison

Depuis le checkout local, qui peut contenir du travail non commité :

```sh
python deploy/package_release.py pictoflow-release.tar.gz
```

L'archive contient les sources, les tests et la documentation. Elle exclut les
fichiers `.env`, les environnements Python, les dépendances Node, les caches,
Git et les outils locaux. Transférer l'archive par SSH/SFTP dans un nouveau
répertoire `~/pictoflow/releases/<release>/`, puis l'extraire.

Créer une seule fois le fichier de configuration, hors du répertoire de livraison :

```sh
python3 deploy/init_server_env.py ~/pictoflow/.env.server \
  --bind-address 10.0.0.121 --port 3000 --release 20261012-01
```

Le fichier est créé en mode `0600`, avec un mot de passe PostgreSQL aléatoire
qui n'est pas affiché. Un fichier existant est préservé. Il ne contient aucun
mot de passe SSH. Le compte exécutant les commandes suivantes doit avoir accès
au démon Docker ; sur le serveur actuel, utiliser `su -`.

```sh
docker compose --env-file /home/mossaab/pictoflow/.env.server \
  -f deploy/docker-compose.server.yml build
docker compose --env-file /home/mossaab/pictoflow/.env.server \
  -f deploy/docker-compose.server.yml up -d --wait --wait-timeout 180
```

Pointer `~/pictoflow/current` vers la livraison uniquement après ce succès.
Pour une mise à jour, choisir un nouveau tag `PICTOFLOW_RELEASE`, conserver le
mot de passe existant et sauvegarder la base avant toute migration.

## Exploitation

Pour les sauvegardes complètes chiffrées, le timer quotidien et la répétition de
restauration isolée, voir [SERVER_BACKUPS.md](SERVER_BACKUPS.md). Les commandes
manuelles ci-dessous restent utiles avant une intervention ; leurs dumps ne sont
pas chiffrés et doivent rester privés.

Depuis le répertoire de livraison actif, avec les droits Docker :

```sh
docker compose --env-file /home/mossaab/pictoflow/.env.server \
  -f deploy/docker-compose.server.yml ps
docker compose --env-file /home/mossaab/pictoflow/.env.server \
  -f deploy/docker-compose.server.yml logs --tail 100 backend admin migrate
```

Sauvegarder la base avec un fichier privé, hors de l'archive des sources :

```sh
umask 077
mkdir -p /home/mossaab/pictoflow/backups
docker compose --env-file /home/mossaab/pictoflow/.env.server \
  -f deploy/docker-compose.server.yml exec -T postgres \
  pg_dump -U pictoflow -d pictoflow -Fc \
  > /home/mossaab/pictoflow/backups/pictoflow-$(date +%Y%m%d-%H%M%S).dump
```

Conserver les sauvegardes et `.env.server` lors des mises à jour. Ne pas utiliser
`down --volumes` sur le projet du serveur : cette option supprime sa mémoire
persistante. Un retour à une ancienne image ne restaure pas une ancienne base ;
une migration incompatible exige une restauration de sauvegarde coordonnée.

Les photos personnelles de la migration `0005_personal_photos` sont stockées
dans PostgreSQL avec leurs représentations. Une sauvegarde complète inclut leurs
pixels ; aucun répertoire média séparé n'est à transférer. Faire les essais de
restauration sur une instance isolée et vérifier la lecture d'une photo connue.
Le downgrade de cette migration refuse une table contenant des photos ; ne pas
effacer ces données pour faciliter un retour applicatif. Voir
[PERSONAL_PHOTOS.md](PERSONAL_PHOTOS.md) pour leur suppression contrôlée.

## Validation des conteneurs

Le smoke test utilise un projet Docker distinct, une base jetable et un port
local attribué automatiquement. Il construit l'image de développement, applique
les migrations et lance les tests dans les modes IA désactivée et FakeProvider.
Son nettoyage concerne uniquement ses propres volumes.

```sh
python3 deploy/smoke_test.py
```

Sources pour le comportement Compose : [déploiement sur un serveur](https://docs.docker.com/compose/how-tos/production/)
et [ordre de démarrage et migrations](https://docs.docker.com/compose/how-tos/startup-order/).
