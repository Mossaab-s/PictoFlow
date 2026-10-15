# Revue des six incréments fonctionnels

Ces PR sont toutes en **draft**. Elles sont empilées pour que chaque diff porte
sur sa tâche ; les relire et fusionner dans cet ordre :

| PR | Fonction à vérifier | Essai principal |
| --- | --- | --- |
| [#48](https://github.com/Mossaab-s/PictoFlow/pull/48) | Suggestions Mots / Phrases | Accepter « Je veux boire de l’eau », retrouver tous ses mots, proposer puis confirmer ou rejeter. |
| [#49](https://github.com/Mossaab-s/PictoFlow/pull/49) | Apprentissage expliqué | Corriger une proposition, voir la différence retenue et les décisions humaines, refaire les mêmes touches. |
| [#50](https://github.com/Mossaab-s/PictoFlow/pull/50) | Sens personnels | Créer « Ours » avec un sens personnel distinct et son dessin ou sa photo ; vérifier puis relire ce sens pendant la composition. |
| [#51](https://github.com/Mossaab-s/PictoFlow/pull/51) | Mot manquant | Commencer un message, ajouter et valider un mot depuis l’éditeur, reprendre la même composition puis choisir la nouvelle touche. |
| [#52](https://github.com/Mossaab-s/PictoFlow/pull/52) | Usages du clavier | Accepter deux messages avec la même touche ; examiner son usage puis choisir explicitement sa place. |
| [#53](https://github.com/Mossaab-s/PictoFlow/pull/53) | Réouverture hors connexion | Préparer la copie protégée, fermer l’onglet, couper le réseau, réouvrir `/offline`, composer puis enregistrer au retour du réseau. |

Les descriptions et guides associés précisent les limites. Aucune proposition
n'est acceptée automatiquement. Les essais CI utilisent des profils fictifs et
un provider désactivé ; aucun déploiement ni modification des profils de
l'instance active n'est effectué par cette série.

La suite locale de l'ensemble passe avec **636 tests backend PostgreSQL/Redis**
et **63 tests frontend**, avec Ruff, Prettier, TypeScript et compilation Next.js.
Les contrôles GitHub de chaque PR donnent l'état des parcours navigateur et de
la stack conteneurisée. Leur réussite technique ne remplace pas l'essai avec
la personne qui communique et son aidant.

Après une fusion en squash ou un rebase, la PR suivante doit être rebasée sur
`main` pour conserver un diff limité à sa tâche. Une fusion avec commit de
merge conserve directement l'ascendance de la pile. Les branches de la série
ne sont pas supprimées pendant la revue.
