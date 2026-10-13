# Créer un clavier et communiquer

Une touche affiche un **grand dessin au-dessus du mot**. Depuis un profil,
ouvrir **Clavier** pour préparer le vocabulaire ou **Communiquer** pour composer
un message. Le serveur doit être mis à jour avec cette livraison pour afficher
ces nouveaux écrans.

## Préparer ses touches

1. Ouvrir un profil, puis l'onglet **Clavier**.
2. Rechercher un dessin par mot (les accents sont facultatifs) ou par catégorie.
   « repas » trouve Manger et « portable » trouve Téléphone. Le dessin choisi
   reste sélectionné même si la recherche ne le montre plus.
3. Choisir le dessin, écrire ou adapter le texte proposé, vérifier l'aperçu,
   puis cliquer sur **Créer la touche à vérifier**.
4. Vérifier le sens, le dessin et le mot, choisir le rôle de la personne qui valide,
   puis **Valider le dessin et le mot** ou **Écarter cette touche**.
5. La touche validée apparaît dans le clavier. Pour fixer sa place, choisir une
   zone et un numéro, puis **Enregistrer la place**.

Les places commencent à 1 dans l'interface. Une place occupée est refusée sans
déplacer une autre touche. Les **repères stables** conservent leurs cases libres.
Les grandes grilles sont paginées. Les nouvelles suggestions PCL ne peuvent
pas être promues en repères stables dans ce parcours V1.

La bibliothèque comprend **28 dessins**, répartis en besoins quotidiens,
personnes, activités et objets, réponses et demandes, émotions, lieux et
déplacements, animaux et nature. Aux premiers exemples (Toilettes, Jouet,
Livre, Maman, Papa, Stop, Oui, Non, Aimer, Voiture, Chat, Soleil, Boire et Dormir)
s'ajoutent Téléphone, Manger, Eau, Aide, Maison, École, Dehors, Marcher, Chien,
Musique, Content, Triste, Mal et Douche. Ce sont des dessins vectoriels
intégrés à l'application ; aucune image externe n'est chargée. Le choix du
dessin appartient à la personne qui prépare et valide la touche. Le mot seul
ne déclenche aucune association automatique à un dessin.

**Ajouter un dessin** permet de compléter une ancienne touche textuelle.
**Modifier le dessin** propose un aperçu et exige **Valider le nouveau dessin**.
Le mot, le concept et la place de la touche sont conservés. Chaque choix est une
représentation propre au profil, stockée dans PostgreSQL avec son historique.
Un dessin absent, rejeté, archivé ou non pris en charge laisse le mot lisible
avec un repère neutre « ? » ; il peut être choisi à nouveau depuis l'éditeur.

**Modifier le texte** corrige le libellé d'une touche validée sans modifier son
concept ni sa signification. Chaque changement laisse un historique.

Par défaut, le nouveau sens personnel, le dessin et la touche à vérifier sont
créés ensemble : si l'écriture échoue, aucun élément incomplet n'est conservé.
Un identifiant de création évite les doublons lors d'une nouvelle tentative
explicite avec le même mot et le même dessin dans le formulaire courant. Un
rechargement relit les touches ; aucune écriture n'est rejouée automatiquement.
**Utiliser un sens déjà présent (facultatif)** permet de réutiliser un concept
existant. Le choix du dessin ne fusionne jamais deux sens d'après leurs mots.

## Composer et vérifier un message

1. Ouvrir **Communiquer** et sélectionner les touches dans l'ordre souhaité.
   Le dessin et le mot apparaissent aussi dans le message composé.
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

Si le modèle renvoie une réponse inexploitable, un message l'indique et vos mots
restent disponibles. Vous pouvez les lire tels quels, préciser le contexte ou
réessayer. La réponse invalide n'est pas ajoutée à la mémoire.

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

Le parcours avec dessins est aussi vérifié sur une base jetable : création et
confirmation d'une touche Livre, sélection et reprise d'un message illustré,
ajout d'un dessin à une ancienne touche Boire. La confirmation du dessin et du
mot est atomique ; les tests vérifient le retour à l'état initial si l'écriture
échoue, l'isolation et la conservation des repères stables lors d'un changement.

Le formulaire simplifié est vérifié dans le navigateur : recherche sans accent,
synonyme, catégorie, conservation du choix filtré, absence de soumission depuis
la recherche, création et validation de Téléphone et Manger, réutilisation d'un
sens existant et rejet d'une variante, reprise du message illustré après
rechargement. Les tests backend couvrent le retour à l'état initial d'une
création interrompue, les tentatives répétées et l'isolation des profils.

L'accessibilité et les interactions doivent encore être testées avec les personnes
concernées. L'import de photos ou de banques externes de pictogrammes, la
personnalisation des dessins et le fonctionnement complet hors connexion
restent des étapes ultérieures.
