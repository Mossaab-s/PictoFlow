# Un espace de communication pour le quotidien

Depuis **Clavier**, **Ouvrir la communication** ouvre désormais
`/communication/{profile_id}`. Depuis l'ancienne vue Communiquer, utiliser
**Ouvrir l’espace de communication**. Cet écran montre le message et le clavier
sans la barre latérale, les onglets PCL ni les menus d'administration.
**Retour à la préparation** ouvre l'éditeur du même profil.

Le clavier, ses dessins et photos, les pages personnelles, la lecture locale,
les actions sur le message et la vérification des propositions restent les mêmes.
La validation humaine demeure nécessaire pour mémoriser une interprétation.
L'écran utilise les mêmes API par profil et ne lance pas de proposition IA à son
ouverture. Le retour à la préparation reste accessible ; ce mode n'ajoute ni
verrouillage de l'écran ni droits d'accès.

## Choisir la taille des touches

Dans **Réglages d’affichage**, choisir la taille des touches personnelles et
adaptatives :

| Choix | Cases par écran de chaque zone | Colonnes sur grand écran |
| --- | --- | --- |
| Classique | 12 | 4 |
| Grandes touches | 6 | 3 |
| Très grandes touches | 4 | 2 |

Les grands formats agrandissent aussi les dessins et les mots. Sur les petits
écrans, la grille utilise au maximum deux colonnes. Les commandes de pagination
et de navigation ont une hauteur minimale de 48 pixels CSS et passent à la ligne
si nécessaire. Le nom d'une touche est son nom accessible ; le numéro de place
reste visible sans être annoncé comme faisant partie du mot.

La taille ne modifie aucun placement dans le PCL : une case libre reste libre et
les touches éloignées restent accessibles par pagination. Les repères stables
conservent la grille classique et sa pagination, même si une autre taille est
choisie. Leur page affichée reste également inchangée pendant ce choix. Le
comportement responsive habituel s'applique quand la largeur de l'écran change.

Changer de taille garde la page personnelle choisie et le message en cours ; la
pagination des zones personnelles et adaptatives repart sur leur premier écran.
Ce changement de présentation doit être choisi explicitement en fonction des
besoins de la personne.

## Reprise et conservation du réglage

Le navigateur conserve uniquement un choix de taille versionné, séparé par
profil, dans `localStorage`. Aucun mot, photo ou sens personnel n'y est ajouté.
Ce réglage est commun aux deux vues de communication dans le même navigateur,
mais n'est pas synchronisé entre appareils. Une valeur invalide revient au
format classique. Si le stockage est bloqué, le réglage fonctionne jusqu'au
départ de l'écran et un message l'indique.

Dans le même onglet, passer entre l'écran dédié, la préparation et l'ancienne
vue Communiquer reprend le message à partir des identifiants conservés dans
`sessionStorage`. PostgreSQL reste la source de vérité pour le texte, l'ordre,
les répétitions, le statut et les propositions. Aucun envoi n'est rejoué.
Le rechargement reprend le message et la taille ; la navigation du clavier
repart dans Accueil, comme auparavant.

## Vérifications et portée

Les tests frontend vérifient les repères fixes et leurs cases libres, l'accès à
chaque touche avec chaque taille, les positions très éloignées, le stockage sans
contenu personnel, l'isolation des réglages et les valeurs invalides.

Le parcours navigateur utilise PostgreSQL jetable et des données fictives :
composition depuis deux pages, changement de taille par souris et flèches du
clavier, conservation d'un repère sur le deuxième écran stable, reprise après
rechargement et passage entre les deux vues. Les mises en page sont vérifiées
à 768 × 1024 et 320 × 800. Les essais avec un lecteur d'écran réel, les personnes
concernées et les aidants restent nécessaires. Le balayage et les contacteurs
ne sont pas implémentés dans cet incrément.
