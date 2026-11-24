# Audit 03 · Modules & tools

> Mesures du 23/11/2026 en fin de journée.

## 1. Inventaire des 25 modules

| Module | Rôle | Tools (catégorie) |
|---|---|---|
| agent | tools Discord + skills | 50 (agent), 2 (skills) |
| assistant | boucle conversationnelle | 3 (assistant) |
| audit | journal unifié fire-and-forget | 1 |
| automations | EventTrigger vers actions | aucun |
| database | Prisma | aucun |
| guild-config | configuration par serveur + fil de config | 5 (guild-config) |
| health | `/healthz` + moniteur | aucun |
| imagelab | PixelLab | 1 |
| integrations | clés chiffrées | 1 (integrations.status) |
| jobs | planificateur générique | 4 (jobs) |
| logging | FileLogService + listeners | 1 |
| memory | fiches, curator, ingestion | 7 (memory) |
| moderation | sanctions + cases | 1 (moderation) |
| module-manager | catalogue + guard | 3 (module-manager) |
| music | lecture vocale | 1 |
| records | store typé | 7 (records) |
| rules | GuildRule | 2 (rules) |
| security | nodes RBAC (le captcha a été retiré en C1) | 3 (security) |
| serverlife | vie du serveur, activité | 16 (serverlife) |
| surface | moteur générique | 6 (surface) |
| tool-registry | registry + search_tools | 2 (tool-registry) |
| utility | utilitaires génériques | 12 (utility) |
| voice | vocaux | 6 (voice) |
| webtools et web | recherche et lecture web | 29 |

**Supprimés en C1** : tickets, roles, levels, invites, welcome, ainsi que les panels d'agent, la pagination des tools de l'assistant et l'ancienne bibliothèque de skills plate.

## 2. Registry et exécution

- 171 tools. Routing façon Anthropic : noyau de 20 tools toujours présents (lectures, `search_tools`, `search_skills` et primitives de surface et de trigger, épinglées le 24/11), jusqu'à 24 tools pertinents hors noyau, puis `search_tools` qui expose le reste à la demande parmi les tools que l'appelant peut exécuter (économie de contexte).
- Permissions vérifiées en code au registry : `permissions: ['ManageGuild']`, etc., et nodes RBAC allow/deny par rôle ou membre (deny prioritaire, même pour un Administrator Discord).
- Porte de confirmation destructive (règle serveur) avant le handler : voir `02-bot-core-moteur.md` §3.
- `defineTool<T>` dans tout le code récent (plus de cast manuel).

## 3. Skills

- 135 `SkillBlueprint` en 10 fichiers de domaine (`blueprints/*.blueprints.ts`), agrégés par `skills.blueprints.ts`.
- `requiredTools` vérifié à la compilation : chaque recette ne référence que des tools du `REGISTERED_TOOL_NAMES`.
- `SkillBlueprintLibrary.search_skills` : scoring sur tags, trigger et params. `SkillPatternDetector` (Learning Loop) propose une recette après 3 motifs similaires.
- Domaines : tickets 13 · voice 13 · moderation 14 · onboarding 13 · forms 14 · engagement 14 · events 14 · automation 13 · monitoring 13 · community 14.
- Aucune compétence active en base ne cite un tool supprimé (vérifié sur les 276 compétences des deux serveurs).

**Limite connue** : les noms de collections cités dans les workflows ne sont pas vérifiés, et le store `records.*` est un registre fermé à 7 collections. Une recette qui écrit dans `casino_balance` ou `giveaway_entries` se heurte à « Collection inconnue » (voir `01-prisma-shared.md` §3).

## 4. Conventions transverses

1. `@Global()` pour les services consommés cross-module (memory, rules, integrations, assistant, guild-config), sinon les exports restent confinés au premier chargeur.
2. Imports VALEUR (pas `import type`) pour toute classe injectée : `design:paramtypes` devient `Object` sinon, et le ModuleLoader échoue. Un paramètre de constructeur avec valeur par défaut provoque la même erreur.
3. `SpraxiumOnBoot` sur les PROVIDERS pour enregistrer les tools et lier les accès runtime. **Jamais de `onBoot` ni de `constructor` dans une classe de module** : le framework n'instancie pas les modules, ce code ne s'exécute pas (règle `LIFECYCLE_ON_MODULE` de `arch-audit`).
4. Les handlers d'interaction ont besoin des décorateurs de `@spraxium/components` (`@ButtonHandler`, `@ModalHandler`) : sans métadonnées, le dispatcher ne leur envoie rien.
5. Un tool renvoie des nombres, jamais de BigInt : les agrégats SQL de Prisma sur SQLite sont des BigInt et `JSON.stringify` nu lève dessus.
6. Tool = schéma (`paramsSchema` Zod) + `systemPrompt` dédié + handler court déléguant au service.

## 5. Dettes identifiées

- `agent.service.ts` et `agent/tools/discord.tools.ts` : à découper par familles de tools (salons, rôles, membres, modération).
- 50 tools de catégorie `agent` répartis sur peu de fichiers.
- Catalogue de modules minimal (logging, moderation) : les modules techniques ne sont pas activables par serveur (choix assumé, ils portent l'agent).
- `members.pickRandom` : sans l'intent privilégié « Membres du serveur », le tirage se fait sur les membres connus du bot (repli sur le cache, signalé dans le résultat).
