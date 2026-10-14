# Suite du développement après la bibliothèque de dessins

## Ordre de travail actuel, après la PR #35

Chaque point passe par une PR, puis par un déploiement après sa fusion.

1. **Sauvegarde et restauration d’un profil** : PR #36 fusionnée et déployée,
   voir [PROFILE_BACKUP.md](PROFILE_BACKUP.md). Fichier versionné incluant le PCL,
   clavier, pages, photos et historique ; restauration dans un nouveau profil.
2. **Mémoire lisible** : PR #37 fusionnée et déployée ; cartes de messages avec
   leurs mots/dessins, corrections prioritaires, relations et décisions humaines
   paginées, recherche et séparation des propositions. Voir [READABLE_MEMORY.md](READABLE_MEMORY.md).
3. **Phrases habituelles** : PR #38 fusionnée et déployée ; retrouver/réutiliser un
   message validé, avec des raccourcis explicitement choisis et conservés dans
   la sauvegarde. Voir [USUAL_PHRASES.md](USUAL_PHRASES.md).
4. **Organisation des pages** : PR #39 fusionnée et déployée ; ordre choisi,
   aperçu des déplacements et retrait contrôlé avec transfert des touches,
   en conservant les repères stables. Voir [KEYBOARD_PAGES.md](KEYBOARD_PAGES.md).
5. **Accessibilité et voix** : PR #40 fusionnée et déployée ; accès clavier,
   focus, contrastes et cibles, choix/débit d’une voix française locale,
   arrêt contrôlé et essais navigateur. Priorité clavier/souris confirmée.
   Voir [COMMUNICATION_ACCESSIBILITY.md](COMMUNICATION_ACCESSIBILITY.md).
   Le son réel, les lecteurs d’écran et le balayage/contacteur restent à
   vérifier avec les personnes concernées.
6. **Reprise hors connexion** : PR #41 fusionnée et déployée ; copie choisie
   du clavier validé, photos et brouillon local pendant une coupure dans l’écran
   ouvert, import explicite atomique, contrôle de révision et refus des conflits.
   Voir [OFFLINE_COMMUNICATION.md](OFFLINE_COMMUNICATION.md).
   La réouverture totalement hors connexion demandera le cache de l’application
   avec HTTPS ; elle reste à livrer avec la préparation du serveur.
7. **Qualité IA** : incrément en préparation ; bilan par profil des tentatives,
   refus et décisions humaines, 18 scénarios reproductibles et usage borné des
   corrections humaines pour la même suite de touches. Voir [AI_QUALITY.md](AI_QUALITY.md).
8. **Préparation à la production** : authentification, droits par profil, HTTPS,
   sauvegardes automatiques et essais de restauration serveur.

Les PR #31 à #35 sont fusionnées et déployées : photos, pages, communication
dédiée, noms des profils et corrections de fidélité des propositions IA.
PRISM reste un provider de test avancé optionnel, à vérifier sur une instance
réelle. PictoFlow fonctionne avec les providers Disabled/Fake et compatible.

Les sections ci-dessous conservent les détails des étapes précédentes.

La livraison courante ajoute 28 dessins recherchables et la création d'une
touche personnelle en un formulaire, suivie de sa validation. Le prompt de
formulation est déployé via la PR #30. Chaque incrément
suivant passe par une PR, puis par un déploiement après fusion.

## 1. Photos personnelles

La PR #31, fusionnée et déployée, implémente le parcours décrit dans
[PERSONAL_PHOTOS.md](PERSONAL_PHOTOS.md), avec stockage PostgreSQL atomique et
suppression contrôlée. Elle permet de choisir une photo de Maman, Papa, d'un objet ou d'un lieu familier,
avec aperçu, mot et validation. Stocker les fichiers de façon persistante et
les servir uniquement dans le profil concerné, avec leur provenance et des
limites de format/taille. Prévoir leur sauvegarde et leur suppression contrôlée.
Le fichier et ses métadonnées doivent pouvoir être réconciliés après une panne.
L'affichage dans le message doit suivre la représentation validée, comme pour
les dessins intégrés. Aucun contenu personnel ne passe par le provider IA pour
la simple sélection d'une photo.

## 2. Organisation du clavier de communication

Ajouter des pages ou groupes visibles (personnes, besoins, activités…), avec
noms personnalisables et navigation simple. Distinguer ces groupes personnels
des catégories de recherche de la bibliothèque. Tout déplacement d'une touche
reste explicite et conserve ses repères stables. Prévoir une vue de préparation
et une vue de communication facile à utiliser au quotidien.

La PR #32, fusionnée et déployée, implémente les pages personnelles, le renommage,
le placement explicite et la navigation pendant un message ; voir
[KEYBOARD_PAGES.md](KEYBOARD_PAGES.md). Les repères stables restent communs.
La PR #39, fusionnée et déployée, ajoute le réordonnancement et le retrait avec
transfert contrôlé. Les pages imbriquées restent à cadrer.

## 3. Accessibilité et essais d'usage

La PR #33, fusionnée, ajoute un écran de communication dédié, sans les
menus d'administration, et trois tailles de touches personnelles. Les repères
stables conservent leur grille. La reprise du message fonctionne entre les deux
vues ; voir [COMMUNICATION_DISPLAY.md](COMMUNICATION_DISPLAY.md).

Vérifier les parcours sur tablette et au clavier, les lecteurs d'écran, les
contrastes, la taille des cibles, la fatigue et les erreurs de sélection. Adapter
le nombre de cases et leur taille, puis essayer les parcours avec les personnes
concernées et leurs aidants. Déterminer avec elles les besoins de balayage ou de
contacteur avant de figer ces interactions. La lecture vocale doit rester une
action choisie et utilisable sans proposition IA.

## 4. Profils et reprise sans connexion

La livraison en préparation ajoute les noms personnels des profils, leur
renommage, la recherche et la protection contre l'écrasement d'un changement
récent ; voir [PROFILE_NAMES.md](PROFILE_NAMES.md).

Préparer les droits d'accès et les sauvegardes, puis définir le fonctionnement
hors connexion. Commencer par lire un clavier
déjà validé et composer des mots ; définir séparément la synchronisation et les
conflits avant d'autoriser des modifications hors connexion. PostgreSQL demeure
la source de vérité et une proposition IA reste soumise à validation humaine.
