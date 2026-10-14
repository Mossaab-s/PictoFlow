# Communication au clavier et lecture vocale

Ces réglages sont communs à l’espace `/communication/{profile_id}` et à la vue
**Communiquer** de l’administration. Ils concernent la présentation et la
lecture ; ils ne modifient ni les positions du clavier ni les validations PCL.
Le parcours prioritaire pour cet incrément est **clavier et souris**.

## Parcours au clavier

Les liens **Aller au message** et **Aller au clavier** donnent un accès direct
aux deux régions. Le focus est visible et les commandes sont utilisables avec
**Tab / Maj+Tab**, puis **Entrée** ou **Espace** sur les boutons.
Les cases libres ne sont pas des commandes et restent ignorées dans ce parcours.
Les pages personnelles et les écrans de touches restent accessibles par leurs
boutons habituels ; aucun déplacement spatial de touche n’est ajouté.

Après une sélection enregistrée, le focus revient à la touche, ce qui permet de
répéter un mot. Une action qui rend son bouton indisponible, par exemple
**Terminer mon message**, donne le focus au titre du message. Si la personne a
déjà déplacé le focus pendant la requête, la fin de l’action ne le reprend pas.
Le message est annoncé comme une région mise à jour, avec son ordre et ses
répétitions. Il reste lisible avant toute formulation IA.

Les commandes de communication ont une cible d’au moins 48 pixels CSS de haut.
Les liens d’accès rapide et boutons ont aussi une largeur minimale de 48 pixels.
Le contraste des textes secondaires et des limites des touches est renforcé
dans les deux vues. **Réglages d’affichage → Contraste renforcé** propose une
présentation plus marquée. Les modes de couleurs imposées du système conservent
un indicateur de focus et la page sélectionnée.

Ces dimensions dépassent le minimum de 24 × 24 pixels du critère
[WCAG 2.2 — taille des cibles](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
Les contrôles de texte suivent le principe de
[contraste minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
Les essais automatiques décrits ci-dessous ne constituent pas une certification
WCAG de l’application complète.

## Choisir une voix

Ouvrir **Réglages de lecture vocale**, choisir une **Voix française locale** et
le débit **Lent**, **Normal** ou **Rapide**. **Essayer cette voix** lit uniquement
la phrase de démonstration « Bonjour, voici ma voix pour communiquer. ».
Modifier un réglage ne déclenche jamais de lecture.

**Lire mes mots** lit les mots sélectionnés, dans leur ordre, avec leurs
répétitions, avant ou après la fin du message. **Lire cette phrase** conserve le
parcours de lecture des phrases habituelles et des propositions visibles. La
lecture ne demande ni formulation IA ni nouvelle validation.

Seules les voix dont `localService` est vrai et la langue française sont
éligibles. Cette propriété distingue un service local d’un service distant ;
voir la [documentation du navigateur](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).
Chaque demande recontrôle les voix actuellement disponibles. Une voix choisie
qui disparaît utilise temporairement une autre voix française locale, avec un
message dans les réglages ; choisir **Voix locale par défaut** remplace ce choix.
La voix distante ou une voix d’une autre langue n’est jamais choisie comme
solution de repli.

La liste peut arriver après l’ouverture de l’écran. Si aucune voix française
locale n’apparaît, installer une voix française dans les réglages de l’appareil,
puis rouvrir le navigateur. La présence et la qualité de ces voix dépendent du
système et du navigateur ; PictoFlow n’installe aucun moteur vocal.
Sans API vocale ou sans voix compatible, les mots et la composition restent
disponibles à l’écran.

## Arrêter et reprendre

**Arrêter la lecture** devient disponible dès la demande, même si le moteur n’a
pas encore démarré. Son bandeau reste visible lors du défilement pendant une
lecture. **Échap**, lorsque le focus est dans l’écran de communication, arrête
aussi la lecture. Une nouvelle demande remplace la précédente.

Le changement de voix/débit, le départ de l’écran, son masquage ou l’ouverture
d’un nouveau message arrêtent la lecture. Les événements tardifs d’une lecture
annulée ne relancent rien et ne perturbent pas la suivante. Si le moteur ne
démarre pas sous dix secondes ou signale une erreur, un message propose de
vérifier le son et la voix installée. Une nouvelle lecture reste une action
choisie ; aucun texte n’est rejoué automatiquement.

## Conservation des réglages

La taille existante garde son format v1. Deux autres clés versionnées séparées
par profil sont ajoutées dans `localStorage` : contraste et identité de
voix/débit. Elles ne contiennent aucun mot, image, sens, ni historique de lecture.
Les choix restent propres à ce navigateur, ne sont pas synchronisés entre
appareils et ne sont pas ajoutés à la sauvegarde PCL.

Une valeur invalide revient aux réglages par défaut. Si le stockage est bloqué,
les choix fonctionnent pour l’écran courant et un message explique qu’ils ne
seront pas conservés. Recharger ou revenir dans l’autre vue reprend les choix
conservés et le message identifié dans l’onglet, sans lecture automatique.
La composition nécessite toujours l’accès au serveur ; l’usage hors connexion
est le point suivant du plan.

## Vérifications et essais sur un appareil

Les tests frontend couvrent la sélection strictement locale, le repli contrôlé,
les réglages invalides/séparés par profil, le texte répété, les différents débits,
l’arrêt avant démarrage, les événements tardifs, les erreurs et le délai de
démarrage sans rejeu. Exécution depuis `admin/` :

```powershell
npm test
npm run format:check
npm run build
npm run typecheck
```

Le parcours navigateur sur PostgreSQL jetable et des données fictives vérifie
Tab/Entrée/Espace, pages et cases libres, conservation du focus, message répété,
reprise après rechargement, arrêt et Échap, liste de voix tardive ou disparue,
repli et choix par défaut, nettoyage au départ, isolation des réglages, stockage
bloqué et API vocale absente. Les collections PCL de présentation et de sens
restent identiques pendant ces réglages et lectures. Aucun appel IA n’est lancé.

Les contrôles axe WCAG A/AA passent sur les rendus ordinateur, 768 × 1024 et
320 × 800, dans les contrastes habituels et renforcés. Les cibles sont mesurées
et les rendus inspectés. Le moteur vocal est simulé pour tester les événements
de façon déterministe : ces essais ne vérifient pas le son réellement entendu.

Pour un essai réel avec la personne et son aidant :

1. Parcourir les pages, sélectionner deux fois un même mot, annuler la dernière
   touche puis terminer le message uniquement avec Tab/Entrée/Espace.
2. Essayer les voix locales, ajuster le débit, lire les mots puis arrêter avec
   le bouton et Échap ; vérifier le volume, la prononciation et la fatigue.
3. Changer le contraste et la taille, vérifier les repères, puis recharger et
   passer entre préparation et communication pour contrôler la reprise.
4. Essayer un lecteur d’écran réel et les réglages de zoom/couleurs du système.

Les essais humains, le son réel, NVDA/VoiceOver et les besoins de balayage ou de
contacteur restent à vérifier avec les personnes concernées. Cet incrément
n’implémente pas le balayage/contacteur.
