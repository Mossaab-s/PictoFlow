# Qualité des propositions IA

Dans l’administration d’un profil, **Qualité IA** affiche un bilan en lecture
seule. La personne continue à composer, lire ses mots et valider ses messages
dans les écrans habituels.

## Ce que compte le bilan

`GET /api/v1/profiles/{profile_id}/ai-quality` fournit des nombres et une date,
sans mots, phrases, photos, identifiants de messages ni secrets du provider.

Chaque demande d’interprétation terminée enregistre un reçu technique dans
l’audit PostgreSQL, dans la même transaction que ses propositions. Une panne
d’écriture annule les deux. Demander à nouveau une interprétation compte comme
une nouvelle tentative, même pour la même séquence ; plusieurs candidats dans
une réponse ne créent qu’une tentative.

Le reçu `interpretation_attempt`, sur la séquence, contient
`new_state.presentation.ai_quality` version 1 : provider, cause du retour
littéral, nombre de candidats reçus et retenus, nombre d’exemples de corrections.
Il ne contient pas de réponse brute, de contexte ou de clé. Les sauvegardes v3
conservent ces reçus ; restauration et effacement suivent ceux du profil.
Aucune migration n’est nécessaire.

| Cause | Comportement |
| --- | --- |
| `disabled` | IA désactivée : présentation des mots choisis, sans appel |
| `model_refusal` | Le modèle répond `not_understood` |
| `unfaithful_words` | Aucun candidat ne conserve les mots selon le contrôle lexical |
| `low_confidence` | Aucun candidat fidèle ne passe le seuil configuré |
| `unavailable` | Échec de transport ou réponse HTTP indisponible |
| `invalid_payload` | Réponse invalide, incomplète ou trop grande |

Dans ces cas, les mots restent proposés dans leur ordre, avec source `pcl`,
sans devenir un sens validé. L’indisponibilité peut avoir plusieurs causes ; ce
bilan ne permet pas à lui seul de distinguer un quota, une panne ou un timeout.
L’IA désactivée n’est pas comptée comme une proposition du provider.

Les causes des anciens essais ne sont **pas reconstituées**. Le début du suivi
correspond au premier reçu enregistré. Séparément, le bilan montre l’état actuel
de toutes les interprétations du profil et le nombre historique d’actions
humaines. Une correction suivie d’un rejet représente deux actions et une phrase
actuellement rejetée. Ces compteurs ne sont pas un taux de justesse du modèle.

## Corrections utilisées comme exemples

Le constructeur de requêtes sélectionne au plus **trois textes de 256 caractères**
dans les dix corrections humaines correspondantes les plus récentes. Ils sont
transmis comme `request.correction_examples`, et seulement si :

- le profil et la suite exacte d’identifiants de touches correspondent, avec
  ordre et répétitions conservés ; la séquence passée est terminée et différente ;
- le contexte enregistré de la séquence correspond et aucun contexte libre
  supplémentaire n’a été déclaré pour l’appel courant ;
- l’interprétation est toujours `corrected`, sa dernière décision typée est
  une correction humaine, et son texte correspond à cette décision ;
- aucun audit des touches ou concepts sélectionnés n’est postérieur à cette
  correction ; ce choix conservateur peut aussi écarter un exemple après une
  modification de présentation ;
- le texte satisfait le contrôle lexical des mots **actuellement** sélectionnés.

Les textes sont dédupliqués, du plus récent au plus ancien. Une simple
confirmation, une proposition non validée, une correction rejetée, un message
d’un autre profil ou une correction qui ajoute un mot ne devient pas un exemple.
Les exemples n’élargissent pas le vocabulaire autorisé, ne créent pas de relation,
ne transmettent pas de photo et ne valident jamais une nouvelle proposition.
La confiance du modèle ne remplace pas le choix humain.

PRISM conserve sa limite de requête de 4 000 caractères. Un petit ensemble de
corrections passe par le même contrat ; une requête trop grande est refusée
avant l’appel et donne un retour littéral. Aucun mot, exemple ou schéma n’est
tronqué pour contourner cette limite.

Le contrôle de fidélité est une heuristique lexicale française : il détecte des
ajouts, omissions, répétitions perdues et modifications de négation. Il ne
prouve ni les rôles des personnes ni le sens voulu. Des paraphrases légitimes
peuvent être écartées ; elles restent utilisables après un choix humain dans le
PCL, même lorsqu’elles ne sont pas réutilisées comme exemples IA.

## Évaluation reproductible

Depuis `backend/`, dans l’environnement Python installé :

```powershell
python -m app.ai.evaluation --output ../.local/ai-evaluation.json
```

Les **22 scénarios déterministes** traversent le constructeur de requêtes,
les providers Fake, le contrôle de mots, la politique de confiance et les
propositions littérales : demandes simples, personnes, lieu, négation,
répétition, aide, émotion choisie, correction, omissions, émotion inventée,
refus, faible confiance, JSON invalide et indisponibilité. Le stockage est un
profil synthétique en mémoire, sans accès à PostgreSQL ou Redis. La CI exécute
cette commande sans clé ni appel externe et conserve son rapport JSON.

Pour une évaluation réelle **choisie**, avec la configuration privée du backend :

```powershell
python -m app.ai.evaluation --live --interval 10 --output ../.local/ai-live.json
```

Cela effectue quatorze appels synthétiques au provider compatible ou PRISM configuré,
espacés de dix secondes par défaut. `--interval` accepte 0 à 60 secondes.
Le mode hors ligne ignore la configuration externe ; le mode réel peut consommer
du quota. Il ne charge et ne modifie aucun profil réel. Ne pas placer une clé
dans la commande ou dans le dépôt.

Le rapport distingue les textes reçus du provider, ceux effectivement proposés,
les contrôles de fixtures et les causes de retour aux mots. Un retour littéral
est une sortie protégée, pas une preuve de réussite sémantique. Le rapport
indique toujours qu’une revue humaine du sens est nécessaire. En mode réel,
le code de sortie ne déclare pas une précision du modèle ; vérifier le bilan
et les phrases synthétiques.

`--scenario` sélectionne un scénario et peut être répété pour limiter les appels.
Le rapport affiche aussi l'état de décision, la source des candidats et le point
à examiner humainement. Les essais du 15 octobre, la correction Moi/je et les
formulations prudentes pour plusieurs personnes sont détaillés dans
[POC_SCENARIOS.md](POC_SCENARIOS.md), avec une comparaison synthétique avant/après.

## Essais réels du 14 octobre 2026

Un premier passage Groq, isolé du PCL et de la configuration en service, a retenu
huit propositions sur dix. Pour « Boire, Boire », le modèle a supprimé une
répétition : le contrôle a conservé « Boire → Boire ». Un appel a rencontré une
indisponibilité, sans que sa cause HTTP ait été enregistrée lors de ce passage.
Le nouvel essai isolé du cas avec correction a répondu HTTP 200 et fourni une
proposition ; aucun résultat n’a été validé automatiquement.

Un exemple explicite de répétition a ensuite été ajouté au prompt : le nouvel
appel réel a répondu HTTP 200 avec « Boire, boire ! », conservant les deux mots.
Le garde-fou reste actif pour les réponses futures.

Le dernier contrôle des deux cas sur le prompt final a obtenu HTTP 200 pour
« Boire, boire ! » et « Papa, je voudrais dormir. », avec un exemple corrigé
dans la seconde requête. Le backend en service n’a pas été modifié.

Ces essais servent à diagnostiquer le comportement observé. Ils ne donnent pas
un taux de qualité général et ne remplacent pas les essais avec la personne.
