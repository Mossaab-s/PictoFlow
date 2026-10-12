# État du prototype V1 — 12 octobre 2026

Le parcours métier PCL est implémenté localement, avec API REST, administration
initiale et providers IA optionnels. Une instance de test est déployée sur
[10.0.0.121:3000](http://10.0.0.121:3000), avec une base persistante dédiée.

| Issues | État local |
| --- | --- |
| #1–#2 | Noyau PCL et espace sémantique |
| #3–#6 | Mémoire séparée, séquences, validation/correction/rejet, confiance/refus |
| #7–#10 | Semantic Gaps, blocs contrôlés, projection du clavier, audit |
| #11–#13 | Frontière IA, scénario complet déterministe, représentations/provenance |
| #14–#16 | FastAPI, PostgreSQL/Alembic, Redis transitoire |
| #17 | Administration Next.js/TypeScript et client API central |
| #18–#21 | Contrats, providers Disabled/Fake/compatible/PRISM |
| #22 | Compose dev et serveur ; smoke test Docker exécuté sur 10.0.0.121 |
| #23–#24 | Observabilité sans contenu brut et isolation des profils |

La validation locale utilise PostgreSQL et Redis réels, des endpoints IA simulés
et une démonstration navigateur connectée à une base temporaire. Les migrations
sont vérifiées en montée/descente et comparées aux modèles SQLAlchemy.
La compilation Next.js, TypeScript et les contrôles de format sont exécutables
avec les commandes documentées.

Dernière vérification : **327 tests backend passent dans chacun des deux modes
Disabled et FakeProvider**, dans Docker sur le serveur, avec PostgreSQL et Redis
réels ; les contrôles Ruff, la compilation Next.js et TypeScript passent aussi.
La création d'un concept depuis l'administration a été vérifiée dans le navigateur,
sur le profil fictif de la base temporaire.

Le socle V1 est fusionné dans `main` via la PR #25, avec contrôles GitHub verts.
La livraison suivante ajoute un éditeur de touches textuelles et un écran de
communication avec reprise et validation explicite ; voir le
[guide utilisateur](KEYBOARD_USER_GUIDE.md). Elle reste à fusionner et déployer.
Les issues restent ouvertes pour suivre la revue et les prochaines étapes.

## Lire et essayer

- [Mémoire, séquences et validation](COMMUNICATION_MEMORY.md)
- [Gaps, blocs, clavier, représentations et audit](ADAPTIVE_WORKFLOW.md)
- [Providers HTTP optionnels](HTTP_PROVIDERS.md)
- [API et observabilité](API_OBSERVABILITY.md)
- [Administration](../admin/README.md)
- [Créer son clavier et communiquer](KEYBOARD_USER_GUIDE.md)
- [Développement local et Compose](LOCAL_DEVELOPMENT.md)
- [Déploiement et sauvegardes sur serveur](SERVER_DEPLOYMENT.md)

Pour une démonstration jetable sans Docker, depuis `backend/` :

```powershell
.venv\Scripts\python scripts/test_with_postgres.py --bin-dir ../.local/pgsql/bin --redis-server ../.local/redis/Redis-8.10.2-Windows-x64-msys2/redis-server.exe --serve 8000 --seed-demo
```

Puis lancer `npm run dev` dans `admin/`. Le helper crée une base et un profil
fictifs, sans modifier de profil existant ; Ctrl+C arrête les services temporaires
et efface uniquement leurs données de démonstration. Les binaires portables sont
propres à ce poste ; ailleurs, indiquer leurs chemins ou utiliser Compose.

## Limites de cette livraison

Docker Engine n'est pas disponible sur ce poste. Les images, le démarrage,
les migrations et les deux modes locaux ont été vérifiés sur le serveur Linux
avec le smoke test, dans un projet isolé ensuite nettoyé.
Les intégrations compatibles/PRISM sont testées sur des réponses HTTP simulées.
Groq est aussi connecté sur le serveur, avec `qwen/qwen3.8-27b` : deux appels
réels sur des données fictives passent les contrats de réponse. La connexion
native PRISM reste à vérifier avec une instance configurée.

L'authentification, l'interface utilisateur finale, l'accessibilité finale,
les essais avec les personnes concernées et la préparation à la production
restent hors du périmètre des issues de ce premier prototype.
