# Comprendre ce que le PCL apprend

Dans « Ce que mon PCL retient », la lecture actuelle du serveur distingue la
proposition en attente, la phrase confirmée, la correction retenue et le refus.
Une panne de lecture remplace le bilan par une erreur ; elle ne confirme pas
une mémorisation supposée à partir de l'état local.

Après acceptation, « Ce que ce choix a changé » explique la disponibilité du
texte dans la mémoire et ses suggestions. Après correction, la formulation
initiale est consultable séparément : les suggestions utilisent la correction.
« Voir les décisions humaines » présente les dates, rôles déclarés et actions
enregistrés. Aucun rôle n'est déduit lorsqu'il manque.

Un souvenir retrouvé pour les mêmes touches dispose de « Pourquoi ce souvenir
revient » et de son historique humain. Il repose sur les identifiants, l'ordre,
les répétitions et le contexte structuré, sans déduire l'intention actuelle.

Une acceptation ne crée ni relation sémantique, ni dessin, ni déplacement, ni
entraînement du provider IA. Un refus reste traçable et retire ce texte des
sources acceptées ; il n'efface pas les autres souvenirs du profil.

Le parcours navigateur `pcl-learning.mjs` vérifie correction, explication,
historique humain, souvenir retrouvé, retrait et panne de lecture sur base fictive.
