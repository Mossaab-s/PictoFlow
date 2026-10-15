# La mémoire personnelle dans les requêtes IA

Chaque requête d’interprétation peut recevoir jusqu’à **50 associations acceptées
du profil courant** : touches d’origine dans leur ordre, sens personnels actuels,
message confirmé ou corrigé, et nombre de messages distincts correspondants.
Une correction humaine n’est plus exclue de ces références parce qu’elle contient
une paraphrase inconnue du filtre lexical.

La recherche sélectionne les traces qui partagent au moins une touche avec le
message courant. Elle classe d’abord une présélection de 1 000 traces selon le
nombre de touches communes et la récence, puis regroupe les doublons et privilégie
la même suite, la couverture des touches, la proximité de l’ordre, la fréquence
dans cette présélection et la récence. Il s’agit d’une proximité des touches,
pas encore d’une recherche vectorielle de synonymes.

Les sources doivent avoir une décision humaine actuelle et cohérente. Les refus,
propositions, autres profils et le message en cours sont exclus. Une modification
auditée des mots ou concepts depuis leur acceptation exclut l’association ancienne.
Une référence retirée disparaît des prochaines requêtes ; elle n’efface pas les
messages ultérieurs qui ont été acceptés indépendamment.

`PICTOFLOW_AI_MEMORY_EXAMPLES` règle le maximum (50 par défaut, de 1 à 100).
Le contenu sérialisé des exemples est limité à 32 000 caractères. Les longues
références sont omises entières, sans couper une phrase. Le provider PRISM peut
retenir moins d’exemples pour respecter sa requête native de 4 000 caractères.
Les sélections courantes ne sont jamais raccourcies pour faire place à la mémoire.

## Des hypothèses plus souples à vérifier

Le prompt peut réordonner les touches, former plusieurs phrases courtes et
proposer jusqu’à trois lectures. Une référence personnelle proche peut soutenir
une paraphrase ou une intention implicite que le vocabulaire générique ne connaît
pas. La personne garde le choix, la correction et le refus.

Une hypothèse qui ne passe pas le contrôle lexical strict doit être soutenue par
**une** référence dont au moins la moitié des touches distinctes sont communes
dans les deux directions. Son vocabulaire supplémentaire doit venir de cette
référence ou des sens personnels des touches actuelles. On ne mélange pas le
vocabulaire de cinquante vieux messages pour fabriquer un message sans rapport.
Négation, Stop, actions explicites et pronoms sélectionnés restent contrôlés.
Ces contrôles lexicaux ne prouvent ni les rôles ni le sens de la phrase.

Une telle hypothèse est plafonnée au seuil de confirmation et sa référence est
revérifiée avant enregistrement et avant la première acceptation humaine. Un
retrait ou une correction de la référence bloque l’acceptation en attendant un
nouvel essai ; le refus reste possible. Un message déjà accepté devient une trace
indépendante, sans modifier le sens global des concepts ni déplacer les touches.

Dans l’écran de communication, « Sur quoi cette proposition s’appuie-t-elle ? »
montre les références enregistrées pour cet essai. Une ancienne référence retirée
ou modifiée n’est pas remplacée par une référence actuelle et son ancien texte
n’est pas présenté comme encore accepté. L’historique et les sauvegardes conservent
les liens de provenance. La limitation native de PRISM est prise en compte : une
référence qu’il n’a pas envoyée au modèle ne peut pas justifier l’assouplissement.

Exemple : six touches « Maman, Papa, Manger, Maison, Moi, Content » peuvent former
« Maman, Papa, je voudrais manger à la maison. Je suis content. » Une mémoire
acceptée proche « J’aime manger à la maison » peut aussi soutenir une hypothèse
de préférence. Sans cette association personnelle, « Content » n’est pas converti
automatiquement en « Aimer ».

Les modes Suggestions « Mots » et « Phrases » continuent à lire directement la
mémoire, sans appel IA. Aucune référence ne valide automatiquement un nouveau message.
