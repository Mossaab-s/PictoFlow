# Validation fonctionnelle du POC — 15 octobre 2026

L'objectif est de vérifier **composer → proposer → choisir/corriger → retenir →
retrouver → retirer** sur des situations concrètes. La PR #46 fournit déjà ce
parcours à l'écran. Cet incrément vérifie plusieurs familles de messages et
corrige deux problèmes observés, sans migration ni changement du clavier.

## Comparaison réelle avec Groq

Neuf compositions fictives ont été essayées avant et après les corrections,
avec le provider compatible configuré (`qwen/qwen3.8-27b`, `json_schema`,
température 0,2). Deux séries intermédiaires de neuf appels isolaient le changement
du contrôle lexical, puis la première version du prompt : **36 appels au total**, espacés de dix secondes hors
latence du modèle. Le [rapport synthétique JSON](validation/poc-scenarios-20261015.json)
conserve les textes reçus et proposés, leurs différences et les empreintes des
sources candidates.

| Situation | Touches, dans l'ordre | Proposition après correction |
| --- | --- | --- |
| Demande | Maman → Boire → Eau | Maman, je voudrais boire de l’eau. |
| Refus d'une action | Non → Manger | Je ne veux pas manger. |
| Émotion choisie | Content | Je suis content. |
| Répétition | Boire → Boire | Boire, boire ! |
| Deux personnes, rôles inconnus | Maman → Manger → Papa | Maman, manger, Papa. |
| Personne explicitement choisie | Moi → Boire → Eau | Je voudrais boire de l’eau. |
| Refus seul | Non | Non. |
| Accord | Oui → Manger | Oui, je voudrais manger. |
| Relation ambiguë | Maman → Aimer → Papa | Maman, aimer, Papa. |

Avant correction, « Moi → Boire → Eau » recevait une formulation correcte de
Groq, mais le contrôle lexical rejetait toute reformulation d'une touche
constituée seulement d'un mot grammatical. Le PCL proposait donc littéralement
« Moi → Boire → Eau ». Le contrôle accepte désormais les formes explicites
Moi/je/j', Toi/tu, Nous et Vous, avec présence et répétitions vérifiées.
Changer de personne, supprimer Eau, perdre un Boire ou enlever Non reste refusé.
Les autres libellés composés seulement de mots grammaticaux restent conservés
tels quels ; cette évolution n'est pas un analyseur grammatical général.

Le second problème concernait les rôles : « Maman → Aimer → Papa » devenait
« Maman, j'aime Papa », et « Maman → Manger → Papa » devenait une demande du
locuteur aux deux personnes. Ces phrases passent le contrôle lexical sans
établir l'intention voulue. Le prompt demande maintenant une formulation
partielle lorsque plusieurs personnes sont nommées sans rôle explicite, avec
deux exemples cohérents. Les deux réponses finales ci-dessus suivent cette
instruction. Le contrôle lexical **ne prouve toujours pas qui agit**, et un
autre appel du modèle peut se comporter différemment.

La suite complète a détecté que la première version allongée du prompt dépassait
la limite de 4 000 caractères de PRISM. Le prompt final a été raccourci, puis
les tests du provider et la comparaison Groq ont été rejoués. Cette limite reste
appliquée : aucune donnée du message ni du schéma n'est tronquée pour la contourner.

Huit compositions sur neuf conservaient une proposition du provider avant les
changements ; neuf sur neuf en conservent une lors du passage final. Ce sont des
constats de filtrage sur ces appels, **pas un taux de justesse sémantique**. Toutes
les propositions restent non validées. Les fragments ambigus sont volontairement
moins fluides pour laisser la personne choisir son sens.

## Ce qui est vérifié dans le PCL persistant

`backend/tests/integration/test_poc_scenarios.py` exécute sept parcours via
l'API réelle et PostgreSQL jetable : demande, négation, émotion, répétition,
deux personnes, Moi et relation ambiguë. Les réponses du transport compatible
sont ici **simulées et structurées**, pour reproduire les décisions de façon
stable sans clé ni appel externe. Les touches utilisent les dessins intégrés
adaptés ; Moi est une touche textuelle dans cette fixture.

Chaque parcours vérifie que :

- même une proposition de confiance 0,99 reste absente de la mémoire validée ;
- une confirmation conserve le texte proposé, une correction conserve le texte
  humain, y compris « Je veux boire encore » ou « Maman aime Papa » ;
- la séquence garde l'ordre et les répétitions des références de touches ;
- une nouvelle composition identique ne reçoit pas l'ancienne validation ;
- retrouver une phrase ne provoque ni appel IA, ni écriture d'audit ;
- les corrections admissibles deviennent des exemples seulement lors d'une
  nouvelle demande explicite ; celles qui ajoutent ou omettent des mots restent
  dans la mémoire humaine, sans devenir automatiquement des exemples IA ;
- une proposition ultérieure reste non validée, même avec un exemple humain ;
- aucun autre profil ne peut lire ou valider le message ;
- le retrait enlève le message de la mémoire validée et interdit sa réutilisation ;
- choisir un sens de phrase ne crée aucune relation sémantique générale.

La CI **PCL functional POC** continue de vérifier le parcours navigateur de
composition/correction, le panneau de mémoire, le nouvel essai, le rechargement,
le retrait et les pannes sur des données fictives, avec le provider désactivé.
Elle ne mesure pas le comportement réel de Groq.

## Refaire les essais

Dans `backend/`, les fixtures sont exécutables sans service ni clé :

```powershell
python -m app.ai.evaluation --output ../.local/ai-evaluation.json
python -m app.ai.evaluation --scenario demande_moi --scenario ambiguite_relation
```

Le banc comporte désormais **22 scénarios déterministes** et **14 scénarios
appelables en mode réel**. La sélection `--scenario` est répétable. Avec une
configuration privée valide, cette commande choisit deux appels réels :

```powershell
python -m app.ai.evaluation --live --interval 10 --scenario demande_moi --scenario ambiguite_relation --output ../.local/ai-live-focused.json
```

Le mode réel consomme du quota. Il n'utilise que les profils synthétiques en
mémoire de l'évaluateur, sans charger PostgreSQL ni Redis. Pour la comparaison
rapportée ici, les sources candidates sont chargées dans un processus de test
séparé sur le serveur : les fichiers applicatifs, les services, la configuration
du provider et les profils réels restent inchangés.

Pour l'API persistante, utiliser PostgreSQL jetable selon [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md),
puis `python -m pytest tests/integration/test_poc_scenarios.py`.

## Valider l'utilité avec la personne

Reprendre le [parcours à l'écran](POC_VALIDATION.md) dans un profil fictif, pour
les cinq familles demande, refus, émotion, répétition et ambiguïté. Une personne
choisit le sens attendu avant de demander une proposition, puis observe :

1. Est-ce que le dessin et le mot permettent de composer le bon message ?
2. La proposition correspond-elle à ce qu'elle voulait dire ?
3. Peut-elle refuser ou corriger facilement, seule ou avec son accompagnant ?
4. Voit-elle exactement ce qui a été retenu, puis retrouvé au nouvel essai ?
5. Le souvenir aide-t-il sans imposer l'intention du message suivant ?

Noter la composition, le sens attendu, la réponse, le choix humain et la gêne
rencontrée. Pour un message ambigu, essayer deux intentions distinctes :
« Maman aime Papa » et « Maman, j'aime Papa ». Aucune ne doit être considérée
comme connue avant le choix humain. Les tests automatisés valident le mécanisme ;
ces observations restent à faire pour valider son utilité.
