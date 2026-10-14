# État du prototype V1 — 14 octobre 2026

Le parcours métier PCL est implémenté localement, avec API REST, administration
initiale et providers IA optionnels. Une instance de test est déployée sur
[10.0.0.121:3000](http://10.0.0.121:3000), avec une base persistante dédiée.

Les PR #36 et #37 sont fusionnées et déployées dans la livraison `20261014-03`
(commit `d8347db`) : sauvegarde/restauration et mémoire lisible. La prochaine
livraison prépare les phrases habituelles et raccourcis choisis, avec lecture
locale explicite, correction prioritaire et sauvegardes v2 compatibles avec la
restauration v1. Voir [USUAL_PHRASES.md](USUAL_PHRASES.md).

| Issues | État local |
| --- | --- |
| #1–#2 | Noyau PCL et espace sémantique |
| #3–#6 | Mémoire séparée, séquences, validation/correction/rejet, confiance/refus |
| #7–#10 | Semantic Gaps, blocs contrôlés, projection du clavier, audit |
| #11–#13 | Frontière IA, scénario complet déterministe, représentations/provenance |
| #14–#16 | FastAPI, PostgreSQL/Alembic, Redis transitoire |
| #17 | Administration Next.js/TypeScript et client API central |
| #18–#21 | Contrats, providers Disabled/Fake/compatible/PRISM |
| #22 | Compose dev et serveur ; smoke test Docker exécuté sur 10.0.0.121 |
| #23–#24 | Observabilité sans contenu brut et isolation des profils |

La validation locale utilise PostgreSQL et Redis réels, des endpoints IA simulés
et une démonstration navigateur connectée à une base temporaire. Les migrations
sont vérifiées en montée/descente et comparées aux modèles SQLAlchemy.
La compilation Next.js, TypeScript et les contrôles de format sont exécutables
avec les commandes documentées.

Le socle, l'éditeur, les pictogrammes et la correction des propositions Groq
sont fusionnés dans `main` via les **PR #25 à #32**, avec contrôles GitHub verts.
Ils sont déployés sur le serveur dans la livraison **`20261013-06`**, commit
`30c2df9`. Le provider utilise les réponses structurées strictes ; les appels
réels sur des données fictives produisent des propositions françaises valides.
Le déploiement conserve la base et les repères existants.

La PR #29 simplifie la création : un formulaire prépare le mot,
son sens personnel et son dessin dans une seule transaction. La validation
reste explicite. La bibliothèque passe de 14 à **28 dessins**, avec recherche
par mot ou synonyme et catégories ; voir le [guide utilisateur](KEYBOARD_USER_GUIDE.md).
Cette évolution est déployée, avec sauvegarde et vérification des données conservées.

Sa vérification locale passe **356 tests backend**, avec PostgreSQL et Redis
temporaires, et **12 tests frontend**, plus Ruff, Prettier, TypeScript et la
compilation Next.js. Un contrôle CI compare les clés des catalogues Python et
TypeScript. Le parcours navigateur vérifie les recherches, le choix conservé
malgré les filtres, la création et validation de Téléphone et Manger, le choix
d'un sens existant et la reprise du message illustré après rechargement.
Les issues restent ouvertes pour suivre la revue et les prochaines étapes.

La PR #30, fusionnée et déployée dans la livraison **`20261013-04`**, commit
`debb340`, améliore les prompts de formulation : instructions propres
à chaque opération, exemples de communication, sens et liens PCL lisibles,
et absence de schéma dupliqué dans le message utilisateur en mode strict.
Elle passe **359 tests backend** avec PostgreSQL et Redis. Les tests supplémentaires
vérifient les sens lisibles, l'exclusion des liens non validés ou d'un autre profil,
et la séparation entre instructions système et contexte déclaré. Une comparaison
Groq sur des données fictives améliore demandes et négation ; la formulation des
émotions explicitement choisies est également vérifiée. Ces essais ne modifient
ni le PCL ni le provider installé. Voir les [prompts et leur portée](HTTP_PROVIDERS.md#message-formulation-prompts).
Les trois contrôles sur le provider réellement installé donnent « Maman, je
voudrais boire de l’eau. », « Je ne veux pas manger. » et « Je suis content. ».
Les données du PCL et les paramètres du provider sont conservés.

La PR #31 est fusionnée et déployée dans la livraison **`20261013-05`**, commit
`082d835`. Elle ajoute les **photos personnelles** : import avec aperçu,
création d'une touche à valider, remplacement explicite, affichage dans le message
et suppression des anciennes photos inutilisées. Les pixels réduits et leur
représentation sont conservés atomiquement dans PostgreSQL. Les sauvegardes
existantes couvrent aussi les photos ; aucun stockage Redis ni fichier public
n'est ajouté. Voir [PERSONAL_PHOTOS.md](PERSONAL_PHOTOS.md). Le parcours est
aussi vérifié sur le code installé dans une transaction PostgreSQL annulée :
aucun profil ni pixel de démonstration ne reste dans la base du serveur.

Cette évolution passe **378 tests backend** avec PostgreSQL et Redis, **15 tests
frontend**, Ruff, Prettier, TypeScript et la compilation Next.js. Le navigateur
vérifie l'import, l'aperçu, la validation, la position stable, le remplacement et
la reprise d'un message avec photo. Une sauvegarde complète de la démonstration
est restaurée dans une autre base jetable : les comptages des 14 tables et les
empreintes des deux photos sont identiques.

La PR #32, fusionnée et déployée, ajoute les **pages personnelles du clavier** : création,
renommage et placement explicite des touches par page. Les repères stables restent
globaux. Un message peut mélanger des sélections de plusieurs pages, puis être
repris après rechargement. Le nom et les placements d'une page sont conservés
dans PostgreSQL avec audit et isolation par profil. Une ancienne requête de
placement ne retire pas implicitement la touche de sa page. Voir
[KEYBOARD_PAGES.md](KEYBOARD_PAGES.md). La bascule conserve les 21 positions et
la photo déjà présente, avec comparaison des pixels par SHA256. Les contrôles du
code installé couvrent les pages et la compatibilité des photos dans des
transactions annulées, sans laisser d'exemples dans la base du serveur.

La version avec pages passe **392 tests backend** (suite complète de 391 tests
avec PostgreSQL/Redis, puis contrôle supplémentaire du downgrade), **16 tests
frontend**, Ruff, Prettier, TypeScript et la compilation Next.js. Le parcours
navigateur vérifie création, renommage, deux cases 1 sur des pages distinctes,
repères stables communs, composition entre pages et reprise du message.

La PR #33, fusionnée, ajoute l'**espace de communication dédié** et les
**tailles de touches personnelles**, sans migration ni modification des API.
Les repères stables gardent leur grille et leur pagination. Un message peut
être repris entre la préparation, la vue Communiquer et l'écran dédié. Le choix
de taille reste dans le navigateur, séparé par profil et sans contenu personnel.
Voir [COMMUNICATION_DISPLAY.md](COMMUNICATION_DISPLAY.md). Les **19 tests frontend**,
Prettier, TypeScript et la compilation Next.js passent. Le navigateur est vérifié
sur une base PostgreSQL jetable, avec reprise et deux largeurs d'écran.

La livraison en préparation ajoute les **noms des profils**, la création avec
nom facultatif, le renommage, la lecture ciblée et la recherche. Les en-têtes
affichent le nom choisi, avec un libellé stable pour les anciens profils sans
nom. Les identifiants et le contenu PCL restent conservés. Une version périmée
ne peut pas écraser un changement récent. La migration additive conserve les
profils existants et refuse une descente qui supprimerait des noms personnels.
Voir [PROFILE_NAMES.md](PROFILE_NAMES.md). La version passe **415 tests backend**
avec PostgreSQL/Redis, dont les contrôles de migration, rollback et absence de
noms dans les requêtes IA et la télémétrie. Les **21 tests frontend**, la compilation
et le parcours navigateur sont vérifiés avant ouverture de la PR.

## Lire et essayer

La livraison en préparation ajoute la **mémoire lisible** : cartes de messages
acceptés/corrigés, touches illustrées, relations nommées et événements réels de
validation paginés. Les propositions restent distinctes et la consultation ne
modifie pas le PCL. Voir [READABLE_MEMORY.md](READABLE_MEMORY.md). Les **512 tests
backend** avec PostgreSQL/Redis, **28 tests frontend**, Ruff, Prettier, TypeScript
et Next.js passent. Le parcours HTTP sur une base jetable est vérifié ; la
vérification visuelle native est limitée par l’arrêt de Computer Use.

La livraison en préparation ajoute la **sauvegarde/restauration d’un profil**,
décrite dans [PROFILE_BACKUP.md](PROFILE_BACKUP.md). L’export complet est versionné
et la restauration crée un profil distinct dans une transaction, avec remappage
des références, photos inchangées et conservation des décisions humaines.
La reprise d’une même demande est protégée par un reçu PostgreSQL, conservé
après une purge de mémoire. Les tests couvrent la restitution, l’isolation,
les erreurs de fichier et le rollback ; le parcours de téléchargement puis
restauration est vérifié dans le navigateur sur une base jetable sans IA.

- [Mémoire, séquences et validation](COMMUNICATION_MEMORY.md)
- [Lire la mémoire dans l’administration](READABLE_MEMORY.md)
- [Réutiliser une phrase et choisir ses raccourcis](USUAL_PHRASES.md)
- [Sauvegarder et restaurer un profil](PROFILE_BACKUP.md)
- [Gaps, blocs, clavier, représentations et audit](ADAPTIVE_WORKFLOW.md)
- [Providers HTTP optionnels](HTTP_PROVIDERS.md)
- [API et observabilité](API_OBSERVABILITY.md)
- [Administration](../admin/README.md)
- [Créer son clavier et communiquer](KEYBOARD_USER_GUIDE.md)
- [Prochaines étapes](NEXT_STEPS.md)
- [Développement local et Compose](LOCAL_DEVELOPMENT.md)
- [Déploiement et sauvegardes sur serveur](SERVER_DEPLOYMENT.md)

Pour une démonstration jetable sans Docker, depuis `backend/` :

```powershell
.venv\Scripts\python scripts/test_with_postgres.py --bin-dir ../.local/pgsql/bin --redis-server ../.local/redis/Redis-8.10.2-Windows-x64-msys2/redis-server.exe --serve 8000 --seed-demo
```

Puis lancer `npm run dev` dans `admin/`. Le helper crée une base et un profil
fictifs, sans modifier de profil existant ; Ctrl+C arrête les services temporaires
et efface uniquement leurs données de démonstration. Les binaires portables sont
propres à ce poste ; ailleurs, indiquer leurs chemins ou utiliser Compose.

## Limites de cette livraison

Docker Engine n'est pas disponible sur ce poste. Les images, le démarrage,
les migrations et les deux modes locaux ont été vérifiés sur le serveur Linux
avec le smoke test, dans un projet isolé ensuite nettoyé.
Les intégrations compatibles/PRISM sont testées sur des réponses HTTP simulées.
Groq est aussi connecté sur le serveur, avec `qwen/qwen3.8-27b` : deux appels
réels sur des données fictives passent les contrats de réponse. La connexion
native PRISM reste à vérifier avec une instance configurée.

L'authentification, l'interface utilisateur finale, l'accessibilité finale,
les essais avec les personnes concernées et la préparation à la production
restent hors du périmètre des issues de ce premier prototype.
