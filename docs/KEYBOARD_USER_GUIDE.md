# Créer un clavier et communiquer

Cette première interface utilise des **touches textuelles**. Depuis un profil,
ouvrir **Clavier** pour préparer le vocabulaire ou **Communiquer** pour composer
un message. Le serveur doit être mis à jour avec cette livraison pour afficher
ces nouveaux écrans.

## Préparer ses touches

1. Ouvrir un profil, puis l'onglet **Clavier**.
2. Ajouter un sens personnel, par exemple « Boire », ou choisir un concept
   existant dans le formulaire de création de touche.
3. Choisir le texte affiché et cliquer sur **Créer la touche à vérifier**.
4. Vérifier le sens et le libellé, choisir le rôle de la personne qui valide,
   puis **Valider la touche** ou **Écarter cette touche**.
5. La touche validée apparaît dans le clavier. Pour fixer sa place, choisir une
   zone et un numéro, puis **Enregistrer la place**.

Les places commencent à 1 dans l'interface. Une place occupée est refusée sans
déplacer une autre touche. Les **repères stables** conservent leurs cases libres.
Les grandes grilles sont paginées. Les nouvelles suggestions PCL ne peuvent
pas être promues en repères stables dans ce parcours V1.

**Modifier le texte** corrige le libellé d'une touche validée sans modifier son
concept ni sa signification. Chaque changement laisse un historique. La création
du sens et celle de sa touche sont distinctes : le sens reste disponible même
si la création de la touche échoue.

## Composer et vérifier un message

1. Ouvrir **Communiquer** et sélectionner les touches dans l'ordre souhaité.
   Les répétitions sont conservées, dans la limite de 32 sélections.
2. Utiliser **Annuler la dernière touche** ou **Effacer le message** si nécessaire.
3. Cliquer sur **Terminer mon message**. La séquence conservée est alors
   immuable ; **Nouveau message** permet d'en commencer une autre.
4. Pour obtenir une proposition, préciser éventuellement un contexte, puis
   cliquer sur **Proposer une phrase**. La sélection seule ne déclenche aucun
   appel IA.
5. Choisir **C'est ce que je veux dire**, **Valider ma correction** ou
   **Ce n'est pas mon sens**. Seule une confirmation ou correction humaine
   ajoute l'interprétation à la mémoire validée.

Le refus d'interprétation conserve les mots sélectionnés. Sans IA, une proposition
littérale reste disponible sans prétendre déduire un sens personnel. Une seule
proposition par séquence peut être acceptée à la fois. Une interprétation acceptée
peut être écartée à nouveau, avec conservation de son historique.

## Reprise et lecture

Le rechargement dans le même onglet retrouve le message courant et les
propositions connues. Le navigateur conserve seulement leurs identifiants :
les textes et états sont relus dans le PCL. Une référence effacée du PCL est
abandonnée. En cas d'indisponibilité pendant la reprise, l'écran demande de
recharger avant de reprendre les écritures. Aucun envoi n'est rejoué automatiquement.

**Lire mes mots** et **Lire cette phrase** utilisent une voix française locale
du navigateur lorsqu'elle existe. La lecture exige un clic et ne lance aucun
service vocal externe ; son absence laisse la communication textuelle disponible.

Les identifiants fonctionnent aussi sur l'origine HTTP du réseau local grâce à
[getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues).
Les voix sont filtrées avec [localService](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).

## Validation

Le parcours navigateur a été vérifié sur un profil fictif dans une base jetable :
création d'un sens et d'une touche, validation, position stable avec une case
libre, sélection ordonnée, annulation, reprise, proposition littérale et correction.
Les tests backend vérifient les lectures par identifiant et l'isolation des profils.
Les tests frontend couvrent les cases stables, la pagination bornée, les collisions,
les identifiants sur HTTP et les références de reprise sans contenu personnel.

L'accessibilité et les interactions doivent encore être testées avec les personnes
concernées. Les pictogrammes, l'édition des représentations visuelles et le
fonctionnement complet hors connexion restent des étapes ultérieures.
