# Essayer le PCL : composer, choisir un sens, le retrouver

La priorité actuelle est la validation fonctionnelle du POC. Le parcours doit
permettre de constater ce que le PCL conserve après un choix humain, sans
confondre un souvenir personnel et une nouvelle proposition de l'IA.

## Un essai simple

1. Préparer un profil fictif avec quelques touches et leurs dessins, puis les
   valider dans l'éditeur. Par exemple : « Moi », « Boire », « Eau ».
2. Dans **Je communique**, choisir les touches dans l'ordre et terminer le message.
   **Ce que mon PCL retient** indique qu'aucun sens n'est encore validé pour ce
   nouveau message. Les souvenirs antérieurs correspondant aux mêmes touches
   peuvent déjà apparaître séparément.
3. Demander une proposition de phrase, puis choisir **C'est ce que je veux dire**
   ou saisir le sens souhaité et **Valider ma correction**. Le panneau relit la
   mémoire du profil et affiche la phrase effectivement conservée. Une correction
   reste prioritaire sur la proposition d'origine.
4. Choisir **Refaire un essai avec les mêmes touches**. Une nouvelle composition
   est créée, avec le même ordre et les mêmes répétitions. Elle ne reçoit pas de
   validation automatique et aucune proposition IA n'est demandée.
5. Sous **Déjà dit avec ces touches**, retrouver la phrase précédente. Choisir
   **Retrouver cette phrase** pour l'afficher dans **Ma phrase choisie**, puis la
   lire si une voix française locale est disponible. La phrase est relue depuis
   le PCL avant son affichage ; la nouvelle composition reste conservée.
6. Recharger l'écran : la composition et les souvenirs restent disponibles.
   Retirer ensuite l'ancienne interprétation de la mémoire validée et utiliser
   **Vérifier la mémoire** : elle ne doit plus être proposée comme souvenir accepté.

Cet essai fonctionne aussi avec l'IA désactivée. Les mots sont alors proposés tels
quels ; la personne peut les reformuler et enregistrer son choix. Une proposition
du provider n'est donc pas nécessaire pour observer la mémoire du PCL.

## Ce que l'essai démontre

Le PCL conserve une phrase acceptée pour un profil et peut la retrouver pour une
suite exacte de touches. Il ne déduit pas que cette phrase représente forcément
l'intention d'aujourd'hui. Le contexte libre peut être différent ; la personne
garde le choix. Les contextes structurés distincts ne sont pas regroupés.
Les touches sont identifiées par leurs références, comme dans la mémoire existante :
si leur dessin ou leur mot a changé, leur affichage actuel ne réécrit pas la phrase
historique. Un souvenir retrouvé reste à vérifier avant utilisation.

Il n'y a pas d'entraînement du modèle en direct, de règle sémantique générale
créée à partir de cette seule validation, ni de partage avec un autre profil.
La réutilisation d'un souvenir ne crée pas de nouvelle validation ou de relation.
Les mécanismes d'exemples de correction pour une future demande IA conservent
leurs règles propres, décrites dans [AI_QUALITY.md](AI_QUALITY.md).

Un réseau indisponible ne doit pas afficher un succès de lecture : le panneau
explique qu'il n'a pas pu vérifier la mémoire et permet de réessayer. Si la copie
des touches s'interrompt, le nouveau message partiel est conservé pour reprise ;
il ne récupère pas la validation du message précédent.

## Points à observer avec les personnes

- Est-ce que le dessin et le mot permettent de trouver la bonne touche ?
- La phrase proposée respecte-t-elle les mots et le sens souhaité ?
- La correction est-elle facile à faire ou à accompagner ?
- La personne comprend-elle ce qui a été conservé et ce qui reste à choisir ?
- Retrouver un message déjà exprimé réduit-il l'effort sans imposer son sens ?

Faire les premiers essais avec des profils fictifs et des situations choisies.
Les résultats automatisés démontrent le fonctionnement du parcours ; les essais
avec les personnes restent nécessaires pour valider son utilité.

## Vérification reproductible

La CI **PCL functional POC** lance PostgreSQL, l'API et l'interface sur une instance
jetable, puis `admin/tests/e2e/pcl-learning.mjs` avec Chromium. Elle vérifie la
correction conservée, la copie avec répétitions, le souvenir retrouvé sans nouvel
appel IA ni validation, le rechargement, le retrait, une panne de lecture et une
copie interrompue. Les captures ne contiennent que des données fictives.
