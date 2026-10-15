# Mot, dessin et sens personnel

Dans l'éditeur, une nouvelle touche possède un mot court, un dessin ou une photo,
et désormais un champ facultatif « Ce que cette touche signifie pour moi ».
Par exemple : mot « Ours », dessin de jouet, sens « Mon doudou pour me rassurer ».
Sans précision, le mot sert de sens comme auparavant.

Le sens est enregistré dans le Concept du profil ; le mot reste le libellé du
bloc et l'image sa Representation. La carte de vérification affiche les trois
avant validation humaine. Une création n'ajoute pas encore la touche au clavier.
Choisir un sens existant utilise ce sens sans le modifier. Réutiliser un identifiant
de création avec un sens différent est refusé, aussi pour une photo.

Pendant la communication, « Le sens personnel de mes touches » permet de relire
les sens du profil en conservant l'ordre et les répétitions du message. Une
demande au provider reçoit déjà ces sens validés, séparés des mots affichés.
Le champ de contexte facultatif précise uniquement la demande actuelle ; il
n'est pas enregistré comme règle personnelle ou contexte permanent. Les souvenirs
ne sont donc pas filtrés selon ce texte libre.

Les suggestions Mots/Phrases restent exclusivement basées sur les phrases
acceptées. Créer un sens personnel ne leur ajoute pas de vocabulaire. Le sens,
comme les touches et photos existantes, est inclus dans la sauvegarde du profil.

Les contrôles PostgreSQL vérifient dessins/photos, validation, distinction
mot/sens dans la requête de formulation, contexte déclaré, isolation et réessais.
