# Suite du développement après la bibliothèque de dessins

La livraison courante ajoute 28 dessins recherchables et la création d'une
touche personnelle en un formulaire, suivie de sa validation. Le prompt de
formulation est déployé via la PR #30. Chaque incrément
suivant passe par une PR, puis par un déploiement après fusion.

## 1. Photos personnelles

La livraison en préparation implémente le parcours décrit dans
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

## 3. Accessibilité et essais d'usage

Vérifier les parcours sur tablette et au clavier, les lecteurs d'écran, les
contrastes, la taille des cibles, la fatigue et les erreurs de sélection. Adapter
le nombre de cases et leur taille, puis essayer les parcours avec les personnes
concernées et leurs aidants. Déterminer avec elles les besoins de balayage ou de
contacteur avant de figer ces interactions. La lecture vocale doit rester une
action choisie et utilisable sans proposition IA.

## 4. Profils et reprise sans connexion

Donner des noms aux profils, préparer les droits d'accès et les sauvegardes,
puis définir le fonctionnement hors connexion. Commencer par lire un clavier
déjà validé et composer des mots ; définir séparément la synchronisation et les
conflits avant d'autoriser des modifications hors connexion. PostgreSQL demeure
la source de vérité et une proposition IA reste soumise à validation humaine.
