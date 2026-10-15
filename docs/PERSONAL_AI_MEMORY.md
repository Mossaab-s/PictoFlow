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

Cette première étape fournit les références au provider. L’assouplissement du
prompt et du contrôle des hypothèses fait l’objet d’un incrément séparé. Les modes
Suggestions « Mots » et « Phrases » continuent à lire directement la mémoire,
sans appel IA. Aucune référence ne valide automatiquement un nouveau message.
