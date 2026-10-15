# Observer le rythme de saisie

Dans l’écran de communication, la personne peut activer « Enregistrer les
intervalles entre mes prochaines touches ». Le choix est désactivé par défaut,
vaut pour l’écran ouvert et ne déclenche aucune interprétation IA.

Le navigateur mesure les intervalles entre deux sélections explicites avec une
horloge monotone. Il distingue le temps passé à attendre la réponse d’enregistrement
précédente, pendant lequel le clavier était indisponible. Le rapport montre les
durées brutes, les attentes et la médiane hors attente. Ce sont des observations
déclarées par le navigateur, pas une mesure clinique ou une preuve d’intention.
La première touche démarre une mesure ; elle ne reçoit pas de durée inventée.

Le mode de sélection clavier ou pointeur est conservé. Un nouvel écran, un autre
message, une erreur, une annulation de touche, un effacement, la désactivation de
l’observation ou le passage en arrière-plan interrompent la paire de mesures.
Les gestes déjà enregistrés restent consultables si une touche est ensuite annulée.
Les intervalles supérieurs à 24 heures ou incohérents démarrent une nouvelle mesure.

L’observation fait partie du même audit PostgreSQL que la sélection. Une sélection
échouée n’enregistre pas d’observation. Le rapport est limité à 1 000 événements
et indique s’il est partiel. Il reste limité au profil autorisé, est supprimé avec
sa mémoire et est conservé dans sa sauvegarde. Les anciennes séquences ne reçoivent
aucun temps reconstruit depuis leurs horodatages serveur. Les copies hors connexion
ne collectent pas encore cette mesure.

## Étape suivante, après les observations

Aucune règle « rapide = colère » n’est créée. Les durées ne sont pas envoyées au
provider, ne modifient pas les propositions et n’attribuent aucun état d’esprit.
Comparer aux habitudes personnelles, distinguer les appareils et demander à la
personne de confirmer une éventuelle association constituent une prochaine étape,
à partir d’observations réelles. Une association confirmée devra rester explicable,
révisable et propre au profil.
