# Audit 03 — Modules & tools

## 1. Inventory des 25 modules

| Module | Rôle | Tools (catégorie) |
|---|---|---|
| agent | tools Discord + skills | 42+7 (agent) |
| assistant | boucle conversationnelle | 3 (assistant) |
| audit | journal unifié fire-and-forget | — |
| automations | EventTrigger → actions | — |
| database | Prisma | — |
| guild-config | config typée + cache | 2 (guild-config) |
| health | /healthz + moniteur | — |
| imagelab | PixelLab | web |
| integrations | clés chiffrées | 1 (integrations.status) |
| jobs | planificateur générique | 4 (jobs) |
| logging | FileLogService + listeners | — |
| memory | fiches + curator + ingestion | 4+2 (memory) |
| moderation | sanctions + cases | 1 (moderation) |
| module-manager | catalogue + guard | 3 (module-manager) |
| music | lecture vocale | voice |
| records | store typé | 7 (records) |
| rules | GuildRule | 2 (rules) |
| security | nodes RBAC | 3 (security) — captcha retiré C1 |
| serverlife | snapshot serveur | 16 (serverlife) |
| surface | moteur générique | 6 (surface) |
| tool-registry | registry + search_tools | 2 (tool-registry) |
| utility | fun/divers | 12 (utility) |
| voice | vocaux | 6 (voice) |
| webtools | search/fetch web | 27+2 (web) |

**Supprimés en C1** : tickets, roles, levels, invites, welcome (+ panels agent, pagination tools assistant, skills.library plat).

## 2. Registry & routing

- 160 tools. Routing façon Anthropic : noyau de ~14 tools toujours présents + `search_tools` qui expose le reste à la demande (économie de contexte).
- Permissions vérifiées EN CODE au registry (`permissions: ['ManageGuild']` etc. + nodes RBAC allow/deny par rôle/membre, deny prioritaire même pour un Administrator Discord).
- `defineTool<T>` partout dans le nouveau code (plus de cast manuel).

## 3. Skills (P3)

- **47 → 135 SkillBlueprint** en 10 fichiers de domaine (`blueprints/*.blueprints.ts`), agrégés par `skills.blueprints.ts` (37 l.).
- `requiredTools` vérifié à la compilation : chaque recette ne référence que des tools du `REGISTERED_TOOL_NAMES`.
- `SkillBlueprintLibrary.search_skills` : scoring tags/trigger/params ; `SkillPatternDetector` (Learning Loop) propose une recette après 3 patterns similaires (cache ICacheStore).
- Domaines : tickets 13 · voice 13 · moderation 14 · onboarding 13 · forms 14 · engagement 14 · events 14 · automation 13 · monitoring 13 · community 14.

## 4. Conventions transverses

1. `@Global()` pour les services consommés cross-module (memory, rules, integrations, assistant) — sinon exports confinés au premier chargeur.
2. VALUE imports (pas `import type`) pour toute classe injectée : `design:paramtypes` sinon devient `Object` → ModuleLoader échoue. Récurrence x5 dans le projet.
3. `SpraxiumOnBoot` (pas `OnModuleInit`) pour l'enregistrement des tools.
4. Tool = schema (paramsSchema Zod) + `systemPrompt` dédié + handler court déléguant au service.

## 5. Dettes identifiées

- `agent.service.ts` (~1 000 l.) : Dieu du domaine — découpage par familles de tools (channels/roles/members/modération) recommandé.
- 42 tools catégorie `agent` dans un seul service : disperser dans `agent/tools/*.ts`.
- Catalogue modules minimal (logging, moderation) : les modules techniques restants ne sont pas togglables (choix assumé : ils portent l'agent).
