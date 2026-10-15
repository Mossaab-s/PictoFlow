# Sauvegarde chiffrée et répétition de restauration serveur

Cet incrément prépare la sauvegarde complète du serveur. Son installation et le
timer passent par le déploiement après fusion de la PR. Il complète les exports
de profils : PostgreSQL contient aussi les comptes, mots de passe hachés, droits,
sessions et photos ; la configuration privée et les clés HTTPS sont sauvegardées
séparément dans le même fichier chiffré.

## Contenu et garanties

`deploy/server_backup.py backup` produit un répertoire privé avec `backup.age` et
un reçu de taille/empreinte SHA256. Le fichier age contient une archive ZIP :

- `database.dump` : PostgreSQL au format custom, toutes les tables applicatives ;
- `server.env` : la configuration privée, avec les secrets du serveur ;
- `caddy.tar` : les certificats et clés HTTPS, lorsque le profil `https` est actif ;
- `sources.tar.gz` : l'archive exacte de la livraison déployée ;
- `manifest.json` : livraison, identifiants des images, empreintes des composants
  et empreintes de chaque table calculées dans le même instantané que le dump.

Le dump et les clés ne sont pas écrits en clair sur le disque pendant la sauvegarde :
les composants passent dans le flux ZIP puis dans `age`. L'export PostgreSQL emploie
un instantané partagé, décrit dans la [documentation pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html).
Une utilisation concurrente reste possible. Un changement de livraison, de
configuration ou de conteneur pendant l'export fait échouer cette copie.

Le répertoire terminé est publié atomiquement. Une erreur ne remplace pas la
dernière bonne copie et n'entraîne aucune rotation. Un verrou refuse deux exports
simultanés. La rotation conserve les 14 dernières copies terminées par défaut ;
elle ne concerne que les répertoires reconnus par leur nom et leur reçu. Les
sauvegardes manuelles de déploiement et les fichiers étrangers sont conservés.
Le journal et le reçu ne contiennent aucun message, identifiant personnel ou secret.

## Préparer la clé de récupération

Installer `age` et `age-keygen` depuis les paquets du système ou la
[distribution officielle](https://github.com/FiloSottile/age#installation).
Sur le poste opérateur, créer une identité de récupération :

```sh
age-keygen -o pictoflow-recovery.agekey
age-keygen -y pictoflow-recovery.agekey > pictoflow-recipients.txt
```

Conserver **`pictoflow-recovery.agekey` hors du serveur**, dans un emplacement
privé sauvegardé. Seul `pictoflow-recipients.txt`, qui contient la clé publique
native `age1…`, est nécessaire aux sauvegardes automatiques. Le script n'accepte
ni identité privée ni plugin dans ce fichier. La séparation destinataire/identité
est décrite dans le [manuel age](https://github.com/FiloSottile/age/blob/main/doc/age.1.html).
Perdre l'identité de récupération rend les sauvegardes indéchiffrables.

## Configurer le serveur après fusion

Avec les droits opérateur/Docker, installer `age` et `openssl`, créer le répertoire
de destination en mode `0700`, puis déposer la liste de destinataires publics dans
`/home/mossaab/pictoflow/private/backup-recipients.txt`.
Créer `/home/mossaab/pictoflow/backup-config.json` en mode `0600` :

```json
{
  "version": 1,
  "project": "pictoflow-server",
  "destination": "/home/mossaab/pictoflow/backups/automatic",
  "recipients_file": "/home/mossaab/pictoflow/private/backup-recipients.txt",
  "retain": 14
}
```

Le script utilise le lien `current` et `.env.server` existants. Il ne les modifie
pas, ne recrée aucun service applicatif et ne change aucun droit de profil.
Il vérifie l'appartenance des conteneurs au projet et le paquet source par rapport
au manifeste de livraison. Conserver l'archive `releases/pictoflow-<version>.tar.gz`.

Tester une première exécution :

```sh
python3 /home/mossaab/pictoflow/current/deploy/server_backup.py backup \
  --root /home/mossaab/pictoflow
python3 /home/mossaab/pictoflow/current/deploy/server_backup.py status \
  --root /home/mossaab/pictoflow --max-age-hours 36
```

`status` renvoie un code non nul après un échec, si la dernière copie est trop
ancienne ou si son fichier ne correspond plus au reçu. Le statut JSON est aussi
conservé dans la destination ; il permet de raccorder un outil de supervision.
Aucun e-mail ou service de notification n'est configuré automatiquement.

Installer les unités de `deploy/systemd/` dans `/etc/systemd/system/`, puis :

```sh
install -m 0644 deploy/systemd/pictoflow-backup.service /etc/systemd/system/
install -m 0644 deploy/systemd/pictoflow-backup.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/pictoflow-backup.service /etc/systemd/system/pictoflow-backup.timer
systemctl daemon-reload
systemctl start pictoflow-backup.service
systemctl enable --now pictoflow-backup.timer
systemctl list-timers pictoflow-backup.timer
journalctl -u pictoflow-backup.service --since yesterday
```

Le timer lance une sauvegarde quotidienne à **03 h, heure de Paris**, avec au
plus dix minutes de décalage. Une exécution manquée est rattrapée au redémarrage,
selon le comportement [systemd.timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).
Adapter les chemins des unités pour une autre installation. Si la destination
change, adapter aussi `ReadWritePaths` dans le service.

La destination initiale est sur le même serveur : elle protège contre une erreur
applicative, pas contre la perte de ce disque. Prévoir une copie indépendante des
répertoires terminés, par exemple sur un NAS ou un disque externe, **avec leur reçu**.
Si un stockage distant est monté comme destination, ajouter une dépendance de
montage à l'unité pour éviter d'écrire sur le disque local quand le montage manque.
La copie hors machine et ses identifiants ne sont pas configurés par cet incrément.

## Répéter la restauration sans toucher au service

Sur un poste Linux avec Docker, `age`, `openssl` et l'image officielle
`postgres:18-bookworm` déjà disponible, copier un répertoire de sauvegarde terminé
et disposer de l'identité privée en mode `0600`. Exécuter :

```sh
python3 deploy/server_backup.py restore-check \
  --backup /chemin/prive/pictoflow-20261015T030000Z-01234567 \
  --identity /chemin/prive/pictoflow-recovery.agekey \
  --report /chemin/prive/restauration-verifiee.json
```

Le script vérifie le reçu, déchiffre dans un répertoire temporaire privé, vérifie
les composants et les paires certificat/clé, puis restaure le dump dans un nouveau
conteneur PostgreSQL. Il compare toutes les tables et chaque ligne de l'instantané,
y compris comptes, droits, validations, clavier et octets des photos.
Le conteneur n'a **aucun réseau, port publié, montage de l'hôte ou volume persistant**.
Il tourne comme utilisateur PostgreSQL, avec système de fichiers racine en lecture
seule, capacités retirées et ressources bornées. Le nom de cible est généré ;
aucun nom de base ou de conteneur de production ne peut être passé à cette commande.
Le conteneur et le temporaire déchiffré sont retirés à la fin, même après un échec
géré. Une interruption brutale de l'hôte peut exiger leur nettoyage opérateur.

La répétition est limitée à PostgreSQL 18 et 512 Mio de données temporaires,
avec un plafond mémoire du conteneur de 1 Gio. Adapter et retester cet outil si
la base dépasse cette taille. Elle ne vérifie pas la disponibilité des images
applicatives sur une autre machine ni le son réel ou l'accès d'un appareil.
Ne restaurer que des archives issues d'une source opérateur de confiance : un dump
contient du code SQL exécutable, comme le rappelle [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html).

Faire cet essai après installation, après une évolution du schéma, puis
régulièrement sur une copie hors serveur. Il est explicite car le timer n'a pas
accès à la clé privée de récupération. `deploy/test_server_backup.py` l'exécute en
CI sur des comptes, une photo et une communication fictifs, avec essais de rotation,
concurrence, fichier altéré et export incomplet.

## Récupération après perte du serveur

1. Vérifier une copie indépendante avec `restore-check` avant toute bascule.
2. Préparer un serveur neuf et une installation Docker isolée ; ne jamais
   restaurer sur l'instance encore utilisée. Déchiffrer l'archive dans un répertoire
   opérateur `0700` avec `age --decrypt --identity … --output recovery.zip backup.age`.
3. Récupérer les seuls fichiers vérifiés par le manifeste : sources et configuration
   privée. La livraison doit conserver son schéma compatible avec le dump ; les
   identifiants d'images sont inclus mais leurs couches ne sont pas dans l'archive.
   Construire ou récupérer les images correspondantes avant de poursuivre.
4. Démarrer uniquement PostgreSQL dans le **nouveau** projet, puis charger le dump
   avec `pg_restore --exit-on-error --single-transaction --no-owner --no-acl`.
   Vérifier les empreintes comme dans la répétition avant de démarrer l'application.
5. Reconstituer le volume Caddy neuf avec `caddy.tar` avant de lancer le frontal,
   en conservant les permissions privées. Ne pas le remplacer sur le serveur actif.
   Adapter adresse HTTPS et origine de connexion si l'adresse du serveur change.
6. Révoquer les sessions restaurées (`DELETE FROM auth_session` sur la **base
   restaurée**), conserver les comptes activés et vérifier la connexion administrateur,
   les attributions et un parcours de communication avant de rediriger les appareils.
7. Effacer les fichiers déchiffrés temporaires et remettre en place les sauvegardes.

Ce guide et la répétition préparent une récupération opérateur. Aucune commande
automatique de remplacement de la base active n'est fournie.
