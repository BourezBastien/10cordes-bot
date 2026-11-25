# Audit 08 · Pratiques d'ingénierie d'ARCHIVE-9 et transposition dans 10cordes-bot

**Objet** : étude en lecture seule du dépôt `C:\Users\Bastien\Documents\Projects\ARCHIVE-9` (commit `6469159`), puis transposition de ses pratiques d'ingénierie (chaîne d'intégration, refroidissement des modèles, journal des décisions, corrections de mémoire, sonde et extinction). Le second dépôt de référence, `discord-agent` (commit `4fea724`), a été relu pour le même objet.

**Méthode** : lecture directe des fichiers de configuration et des sources concernés, deux fois pour les modules transposés (refroidissement, décisions, corrections, extinction). Rien n'a été exécuté ni modifié dans ces deux dépôts. Aucun fichier n'en a été copié : chaque mécanisme est réimplémenté dans notre stack (Spraxium, Prisma, Zod).

**Limites** : les deux dépôts sont sans licence. Ce document décrit des mécanismes lus dans leur code, pas leur comportement observé : rien de ce qui est dit ici ne vaut pour leur exécution réelle. ARCHIVE-9 repose sur l'SDK `ai` et sur Drizzle ; là où sa logique tient à ces bibliothèques (`APICallError.isInstance`), la nôtre lit la nature de l'erreur.

Chaque fait cite son fichier et sa ligne. Sauf mention contraire, les chemins d'ARCHIVE-9 sont relatifs à la racine de son dépôt, les nôtres à `apps/bot/src/`.

## 1. Ce qu'est ARCHIVE-9

Un monorepo pnpm (`apps/bot`, `apps/web`, `packages/ai`, `packages/config`, `packages/core`, `packages/db`), Node 26, PostgreSQL 18, Drizzle pour la base, déployé par un compose de cinq services : `postgres`, `bot`, `web`, `tunnel`, `backup` (`docker-compose.yml:3-122`). C'est un assistant de serveur Discord à un seul serveur (`DISCORD_GUILD_ID`, `docker-compose.yml:42`), avec un site web derrière un tunnel Cloudflare.

## 2. Axe 1 : la chaîne d'intégration continue

Tout tient dans un workflow de 116 lignes (`.github/workflows/ci.yml`).

| Mécanisme | Fait |
|---|---|
| Un seul lot à la fois | `concurrency` : un groupe par workflow et référence, `cancel-in-progress: true` (`:8-10`) |
| Droits minimaux | `permissions: contents: read` pour tout le workflow (`:12-13`) |
| Base réelle pour les tests | un service `postgres:18-alpine` avec son contrôle `pg_isready`, `TEST_DATABASE_URL` passé au job (`:18-32`) |
| Couverture exigée | `pnpm test:coverage` (`:43`) |
| Secrets | un job `secrets` à part : `fetch-depth: 0`, puis `gitleaks/gitleaks-action@v3` (`:45-53`) |
| Les images après les secrets | `images` a `needs: [check, secrets]` (`:57`) : une image ne se construit pas sur un historique qui fuit |
| Essai d'image | l'image est lancée sans variable : elle doit refuser sur la validation de l'environnement (`:91-97`) |
| Un contrôle pour la protection de branche | un job final `image`, `if: always()`, vert seulement si les images ont réussi (`:110-116`) |

**Dépendances** (`.github/dependabot.yml`) : trois écosystèmes, chacun hebdomadaire. npm groupe les versions mineures et correctives (`minor-and-patch`, `update-types: [minor, patch]`, `:7-11`) ; les majeures restent une par dépendance. GitHub Actions (`:13-18`) et Docker (`:20-25`) sont groupées et préfixées.

**Secrets** (`.gitleaks.toml`) : la configuration par défaut, étendue d'une seule liste blanche globale, « placeholder IDs used in tests and examples », sur trois identifiants fictifs (`:4-6`).

**Couverture** (`vitest.config.ts`) : fournisseur v8, seuils par dossier et non pour tout le dépôt : `packages/core/src/**` et `packages/ai/src/**` à 80 % de lignes, de fonctions, de branches et d'instructions (`:11-14`). Hors décompte : les tests, les utilitaires de test, `main.ts` (`:10`). `passWithNoTests: true` (`:6`).

## 3. Axe 2 : refroidissement par modèle

`packages/ai/src/cooldowns.ts`, 100 lignes, une classe.

| Mécanisme | Fait |
|---|---|
| Clé | l'identifiant du modèle, seul (`:42`, `:52`) |
| État | une map des refroidissements `{ at, reason }`, une map des budgets de jetons `{ remaining, resetsAt }` (`:34-35`) |
| Durées par défaut | limite de débit 60 s, crédit épuisé 1 h, erreur serveur 30 s, réseau 15 s (`:24-29`) |
| Plus long refroidissement | un refroidissement plus long en cours n'est jamais raccourci (`:52-56`) |
| Durée annoncée | `Retry-After` en secondes, sinon `x-ratelimit-reset-requests`, sinon le défaut (`:78-84`) ; durées façon Groq `1m26.4s`, `2h3m` (`:4-15`) |
| Après une erreur | 429 puis 402 puis 5xx refroidissent ; un autre statut HTTP ne refroidit pas et rend `http_<statut>` ; une sortie invalide ne refroidit pas (`invalid_output`) ; toute autre erreur est un incident réseau (`:74-100`) |
| Avant l'erreur | les en-têtes d'une réponse réussie sont lus : plus de requêtes restantes donne `daily_quota` jusqu'à la réinitialisation ; les jetons restants forment un budget (`:58-71`) |
| Consultation | `blockedReason(id, jetonsEstimés)` rend la raison, dont `token_budget` quand le budget restant est trop petit pour l'appel (`:42-50`) |

Les tests (91 lignes) couvrent chaque branche : `retry-after`, repli sur l'en-tête puis le défaut, classification de 402, 5xx, autre HTTP, sortie invalide et réseau, quota journalier, budget de jetons, en-têtes absents et plus long refroidissement (`cooldowns.test.ts:28-83`).

## 4. Axe 3 : journal des décisions

**Table** (`packages/db/migrations/0012_decisions.sql:1-20`) : `run_id`, `message_id`, `channel_id`, `channel_name`, `guild_id`, `author_id`, `outcome`, `reason`, `addressed`, `in_agents`, `interest`, `content`, `details` (jsonb), `created_at`. Deux index : `created_at`, puis `(outcome, created_at)`.

**Écriture et purge** (`packages/db/src/repositories/decisions.ts`) : `recordDecision` insère, contenu tronqué à 500 caractères (`:21-23`) ; `purgeDecisions(db, avant)` supprime les lignes antérieures à une date et rend leur nombre (`:25-28`).

**Ce que dit une ligne** : la décision de répondre ou non. Les issues sont `ignored`, `silent`, `replied`, `reacted`, `offline` (`:12`), avec l'intérêt porté au message (`interest`) et l'appartenance à la catégorie des agents (`in_agents`). Ce n'est pas le détail des outils appelés, c'est la trace de la porte d'entrée.

## 5. Axe 4 : corrections qui tiennent

**Tables** : `fact_corrections` (`packages/db/migrations/0009_fact_corrections.sql:1-13`), puis une colonne `new_content` (`0011_correction_new_content.sql:1`). Clé étrangère vers le membre, en cascade, et vers le fait, mise à null si le fait disparaît.

**Le mécanisme** (`packages/db/src/repositories/learning.ts`) :

1. Retirer ou réécrire un fait se fait en transaction. Réécrire crée le nouveau fait (confiance 0,95, `:315`), marque l'ancien `supersededBy` (`:318`) et écrit la correction (`:319`). L'ancien reste dans l'historique.
2. `recentCorrections` rend les dix dernières corrections de chaque membre, « for the analysis not to learn them again » (`:324-339`) : la correction est montrée au modèle qui analyse, pour qu'il ne réapprenne pas le fait retiré.
3. `summariesToRefresh` trouve les membres dont la synthèse a été écrite avant leur dernière correction : « it still shows what they removed » (`:341-349`).
4. La suppression d'un membre emporte ses corrections (`repositories/profiles.ts:42`). Un rôle web en ajout seul peut écrire des corrections, pas modifier le reste (`packages/db/src/web-role.ts:11`).

## 6. Axe 5 : sonde et extinction

**Sonde** (`apps/bot/src/health.ts`) : un serveur HTTP à part, un seul chemin `/health`, 200 `ok` ou 503 `unhealthy`, 404 ailleurs (`:5-19`). Le contrôle est fourni au démarrage : le client Discord est prêt et la base répond au ping (`apps/bot/src/main.ts:202-206`).

**Image** (`docker/bot.Dockerfile`) : utilisateur `node` (`:20`), `HEALTHCHECK` toutes les 30 s, 30 s de démarrage tolérés, `wget` sur la sonde (`:23-24`). Lancement direct par `node` (`:25`), donc node reçoit les signaux.

**Extinction** (`apps/bot/src/main.ts:210-223`) : sur `SIGTERM` ou `SIGINT`, arrêt du pipeline, de la présence, des tâches et du déclencheur de requêtes, fermeture de la sonde, `discord.destroy()`, fermeture de la base, `exit(0)`. Le déclencheur de requêtes arrête de planifier (`apps/bot/src/requests.ts:86-89`) : un lot en cours n'est pas attendu. Aucun délai de grâce, aucun compte de ce qui a été abandonné.

**Compose** : `mem_limit` par service (384 Mo pour le bot, `docker-compose.yml:64`), réseau de base `internal: true` (`:128-130`), démarrages conditionnés à la santé (`:36-38`, `:72-73`), service de sauvegarde quotidien `pg_dump` avec rétention (`:99-122`).

## 7. Axe 6 : tableau comparatif

| Dimension | ARCHIVE-9 | 10cordes avant | 10cordes après |
|---|---|---|---|
| Secrets en CI | job dédié, tout l'historique, action officielle | aucun | job dédié, tout l'historique, binaire épinglé et empreinte contrôlée, rapport rédigé |
| Dépendances | trois écosystèmes, mineures et correctives groupées | rien | npm et GitHub Actions, hebdomadaires, groupées ; une PR automatique ne touche jamais `pnpm-workspace.yaml` |
| Couverture | 80 % sur deux paquets, par dossier | aucune mesure | 80 % plancher sur `packages/shared`, mesuré à chaque `pnpm test` |
| Refroidissement | par modèle, quatre causes, budget de jetons préventif | un état par fournisseur, pour l'affichage seul | par serveur, fournisseur et modèle ; le routeur l'applique |
| Journal | décision de répondre, contenu de 500 caractères, purge par date | rien | une ligne par demande traitée : intention, motif, raisonnement, tours, outils, échecs, issue, étapes, jetons, durée ; 14 jours |
| Mémoire | corrections en transaction, montrées à l'analyse, synthèses à refaire | ajout seul, pas de correction | outil `memory.correct`, journal marqué périmé, fiche réécrite par un contrôle en code |
| Sonde | `/health` sur un port à part | `/healthz`, non branchée sur l'image | `/healthz` sous `HEALTHCHECK`, 503 dès le début de l'extinction |
| Extinction | tout fermer, `exit(0)`, rien attendu | crochets en parallèle, file non vidée | vidange dans un délai de grâce, base fermée en dernier |
| Image | utilisateur `node`, mémoire limitée | root, pas de `exec` | `exec node`, `init`, délai de grâce de Docker au-dessus de celui du bot |

## 8. Transposition retenue

**Pris, et livré dans ce lot :**

1. **Un job de secrets sur tout l'historique** (`.github/workflows/ci.yml`). Deux écarts voulus : le binaire est téléchargé de la release officielle, épinglé à une version et contrôlé par son empreinte, sans action tierce ni jeton ; le rapport et le journal sont rédigés. Vérifié sur un dépôt jetable : un faux jeton fait échouer le scan, et sa valeur n'apparaît dans aucune sortie.
2. **Dependabot hebdomadaire, groupé** (`.github/dependabot.yml`). Ajouté, et absent de la référence : une PR automatique qui touche `pnpm-workspace.yaml` est refusée. pnpm y écrit ses exceptions d'âge minimum en résolvant une version trop récente, et ce fichier est notre politique de chaîne d'approvisionnement.
3. **Un plancher de couverture** (`packages/shared/vitest.config.ts`). Sur le paquet qui porte les contrats validés par le bot et le dashboard, ceux qu'une régression casse sans bruit. Son écriture a fait remonter un défaut : la capacité native `web.search` était classée dans la famille `custom`.
4. **Refroidissement par modèle** (`providers/model-cooldown.policy.ts`, `model-cooldown.store.ts`, `capability-router.service.ts`). Quatre causes, la durée annoncée par le fournisseur, le plus long refroidissement conservé, le modèle mis de côté en dernier dans les tentatives. Ajouté : un plafond de 15 minutes, une clé par serveur et fournisseur, l'oubli du refroidissement quand un contrôle ou une modification du fournisseur réussit.
5. **Journal des décisions** (`assistant/agent-decision.recorder.ts`, `agent-decision.journal.ts`, table `agent_decisions`). Même purge par âge. Autre objet : là où la référence journalise la porte d'entrée, nous journalisons la demande traitée, pour répondre à « pourquoi l'agent a-t-il fait ça ». Une écriture qui échoue ne casse jamais une demande.
6. **Corrections qui tiennent** (`memory/memory-correction.*.ts`, table `memory_corrections`). Même principe : le fait ancien n'est pas effacé, il est marqué périmé, et la correction est montrée au modèle qui fusionne. Ajouté : un contrôle en code réécrit la fiche si la fusion l'a laissée tomber, et une correction qui en remplace une autre la marque périmée.
7. **Sonde et extinction** (`health/shutdown.service.ts`, `Dockerfile`, `docker-compose.yml`). Ajouté : un délai de grâce (20 s par défaut, 5 min au plus), le compte honnête de ce qui a été abandonné, la base fermée après la vidange.

**Adapté plutôt que copié :**

- **La clé du refroidissement** est serveur, fournisseur et modèle, pas le modèle seul. Deux serveurs qui partagent une copie d'instance ne partagent pas une limite de débit : elle dépend de la clé.
- **Le crédit épuisé** refroidit 5 minutes chez nous, 1 h chez la référence. Ce n'est pas un basculement : la demande échoue aussitôt avec la même erreur, pour que l'administrateur la voie, et le modèle est réessayé à l'échéance ou dès qu'un contrôle réussit.
- **Le journal** garde l'intention, le motif, des comptes et la nature de l'échec ; ni le message du demandeur ni les paramètres d'entrée des outils. Il garde le texte de progression et le résumé du résultat de chaque outil, 200 caractères chacun, 60 étapes au plus (au-delà, un compte).

**Écarté, et pourquoi :**

- **L'action officielle gitleaks** : elle demande un jeton pour commenter les PR, et une clé hors compte personnel. Le binaire fait le même travail sans aucun secret.
- **La liste blanche globale sur des identifiants** : nous n'en avons pas eu besoin, le scan de l'historique rendu le 25/11 ne remonte rien. Une exception s'ajoutera à la règle concernée, pas au dépôt entier.
- **Le budget de jetons préventif** : nos protocoles ne lisent pas les en-têtes de quota sur une réponse réussie. Voir le 9.
- **`passWithNoTests`** : chez nous, un dossier sans test est une anomalie.

## 9. Ce qui reste ouvert

- **Les deux nouveaux jobs ne sont pas exigés par la protection des branches.** `main` et `develop` n'exigent que « Lint · Modules · Typecheck · Test ». Les ajouter à la protection est une décision de l'administrateur du dépôt.
- **Un lot à la fois** (`concurrency`, `cancel-in-progress`) et **`permissions: contents: read`** sur le workflow de CI : non repris, à juger avec le workflow de publication, qui écrit des paquets.
- **Une base réelle dans la CI.** Nos tests tournent sans PostgreSQL ni Redis. Les jobs de la phase suivante (PostgreSQL 16, TimescaleDB, Redis) en auront besoin : le service `postgres` de la référence est le modèle.
- **L'essai d'image et le contrôle agrégateur** : une image construite n'est pas lancée avant d'être publiée.
- **Limite mémoire par service et réseau interne pour la base** : à reprendre dans le compose de production de la phase suivante. Un service de sauvegarde aussi.
- **L'image tourne en root** : la référence passe sous l'utilisateur `node` (`docker/bot.Dockerfile:20`). Chez nous, le fichier de base de données et les journaux sont écrits sous `apps/bot`, dans un volume : changer l'utilisateur demande de régler la propriété du volume.
- **Budget de jetons préventif** : le routeur ne sait pas qu'un modèle n'a plus assez de jetons pour un gros appel.
- **Le refroidissement est en mémoire** : il se perd au redémarrage et ne se partage pas entre instances. L'interface est asynchrone pour qu'un magasin Redis la reprenne sans toucher les appelants.
- **Non vérifié en conditions réelles** : le démarrage du bot dans l'image et la vidange d'une demande en vol à `SIGTERM`. La sonde, le code de sortie et l'extinction propre ont été vérifiés par leurs tests et par un arrêt réel d'un conteneur d'essai, pas avec le token du propriétaire.

## 10. `discord-agent` (commit `4fea724`)

Rien à prendre côté ingénierie, et deux pratiques à ne pas copier. Le workflow (`.github/workflows/ci.yml`) lint et typecheck, sans test (aucun fichier de test dans le dépôt), avec `version: latest` pour pnpm et `node-version: lts/*` (`:16-17`, `:20`) : deux exécutions du même commit peuvent tourner sur des outils différents. Le `Dockerfile` lance `pnpm run start` sans `exec` ni sonde (`:1-15`), et aucune source ne traite `SIGTERM`. Le transposable de ce dépôt (plans d'action, double validation, lecture filtrée) est traité dans l'audit 07.
