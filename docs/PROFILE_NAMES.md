# Retrouver les profils par leur nom

Dans **Profils**, saisir un prénom ou un surnom dans **Nom du profil, facultatif**,
puis choisir **Nouveau profil**. Un profil sans nom reste possible. Pour un
profil existant, ouvrir **Renommer le profil**, adapter **Nom de ce profil** puis
choisir **Enregistrer le nom**. Laisser ce champ vide retire le nom affiché.

La recherche accepte le nom avec ou sans accents, ou l'identifiant. Les cartes
donnent accès à **Préparer le clavier**, **Communiquer** et à l'espace PCL depuis
leur titre. Les en-têtes des sections, du clavier et de la communication
affichent également le nom. Le nouvel écran de communication de la PR #33 en
bénéficie aussi.

Le nom est facultatif, limité à 80 caractères, avec suppression des espaces en
début et fin. Plusieurs personnes peuvent porter le même nom : chaque carte
garde son identifiant complet. Un profil sans nom utilise un libellé stable,
**Profil sans nom · identifiant court**, indépendant de l'ordre de la liste.

## Conservation et conflits

Le nom est une métadonnée stockée dans PostgreSQL avec le profil et incluse
dans ses sauvegardes. Le renommage conserve l'identifiant, le clavier, les
pages, les photos, les messages et la mémoire validée. Il ne crée aucun sens ni
événement de validation sémantique. Les noms ne sont pas ajoutés aux requêtes IA
ni aux logs techniques. Ils ne sont pas enregistrés dans le stockage du navigateur.

Chaque changement effectif du nom incrémente la version du profil et actualise
sa date de modification. Enregistrer le même nom avec la version courante est
sans effet. L'effacement de **la mémoire** conserve le profil et son nom ; le
nom peut être retiré explicitement avec le formulaire de renommage.

Si un autre écran a modifié le profil entre-temps, le serveur refuse la version
ancienne avec une réponse 409. Le formulaire relit le nom actuel, conserve la
saisie et demande de vérifier avant de réessayer. Aucun renommage n'est rejoué
automatiquement. Si la relecture échoue, il faut actualiser la page. Après
renommage ou conflit, la recherche est effacée pour garder la carte et la saisie
visibles même si le nouveau nom ne correspond plus au filtre.

## API et migration

- `POST /api/v1/profiles` : accepte désormais un objet facultatif
  `{"display_name": "Prénom"}`. L'ancienne requête sans corps reste valide.
- `GET /api/v1/profiles/{profile_id}` : identité et nom du profil demandé ;
  un profil absent répond 404.
- `PATCH /api/v1/profiles/{profile_id}` :
  `{"display_name": "Nouveau nom", "expected_version": 1}`.
  `display_name: null` retire explicitement le nom. Le champ et la version sont
  requis. Une valeur non nulle vide ou trop longue répond 422 sans exposer la saisie.

La migration additive `0007_profile_display_names` ajoute une colonne nullable
avec limite et contrainte. Elle garde les profils existants sans nom, avec leurs
identifiants, dates et versions actuels. Le retour de migration est refusé tant
qu'un nom est présent : il faut d'abord retirer explicitement les noms pour ne
pas perdre les libellés personnels implicitement. Une ancienne image peut
fonctionner avec la colonne additive, mais ne peut pas afficher les nouveaux
noms ; ne pas relancer son ancien service de migration contre une révision
Alembic qu'il ne connaît pas.

## Vérifications

Les tests couvrent les anciennes requêtes, la lecture ciblée, les noms identiques
dans des profils distincts, les limites, les conflits de version, le rollback
transactionnel, la conservation du clavier et des messages, le retrait explicite,
l'effacement de mémoire, la migration et l'absence de noms dans les requêtes du
provider ou les signaux techniques.

Le navigateur est vérifié sur PostgreSQL jetable avec des profils fictifs :
création, renommage d'un profil déjà peuplé, recherche sans accent, accès au
clavier et à la communication, persistance après rechargement, conflit simulé
depuis un autre écran et conservation du brouillon. L'affichage est aussi
vérifié sur une largeur de 320 pixels CSS.
