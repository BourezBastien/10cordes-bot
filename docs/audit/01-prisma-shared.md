# Audit 01 · Prisma & shared

> Mesures du 23/11/2026 en fin de journée (commit courant).

## 1. Schéma Prisma (33 modèles)

**Vie du serveur** : Guild, GuildModuleState, MemberBirthday, StickyRole, AfkStatus, TempSanction, MemberActivity

**Mémoire** : GuildMemory, MemberMemory, MemberMemoryProfile, GuildMemoryProfile, MemoryOptOut, IngestionCursor

**Moteur générique** : InteractiveSurface, ScheduledTrigger, EventTrigger

**Agent et configuration** : AgentSkill, AgentAutomation, AgentRecord, ToolNode, GuildRule, GuildAgentSettings

**Intégrations** : IntegrationConfig (clé chiffrée en AES-256-GCM)

**Sécurité et modération** : AuditLog, ModCase, ModCounter, RoleBackup

**Jobs** : ScheduledJob, ChannelWatermark

**better-auth** : User, Account, Session, Verification (table standard de better-auth pour les codes e-mail ; ce n'est pas le captcha, qui a été retiré avec la purge)

**Supprimées lors de la purge C1** : Ticket, TicketFeedback, TicketCounter, AgentPanel, UserLevel, InviteStat.

### Convention SQLite
Pas de type Json : colonne String + `JSON.parse/stringify` au service. Zod re-valide à la lecture (source de vérité = schémas shared). Les DateTime sont stockés en epoch-ms ENTIER : voir l'anomalie 2 de `05-verification-anomalies.md`.

## 2. Migrations (30)

- **20261123140000_ingestion_cursors** : CREATE TABLE `ingestion_cursors` (+ index unique guildId+channelId) et rebuild de `IntegrationConfig` (DEFAULT '' sur `baseUrl`).
- **20261123150000_purge_business_tables** : DROP `agent_panels`, `invite_stats`, `ticket_counters`, `ticket_feedbacks`, `tickets`, `user_levels`.
- **20261123160000_guild_agent_settings** : CREATE TABLE `guild_agent_settings` (mode thinking et fil de config par serveur).
- Fix historique : `20261122220000_integration_config_v2` contenait un `ALTER COLUMN` invalide en SQLite (replay shadow DB en échec) : remplacé par un commentaire.
- **Méthode non-destructive utilisée** pour les trois nouvelles : SQL écrit à la main + `prisma db execute` + `migrate resolve --applied` (la DB de dev contient des clés chiffrées et des règles réelles : aucun reset autorisé).

## 3. packages/shared (13 fichiers, 1 187 lignes)

| Zone | Contenu |
|---|---|
| `tools/types.ts` | `BotTool`, `ToolRunContext` (reply/sendFile/progress), `ToolResult`, `defineTool<T>` (factory typée, le cast `input as` n'existe qu'ici) |
| `tools/registry-names.ts` | `REGISTERED_TOOL_NAMES` (163) auto-généré par `sync-tool-names.mjs` (scan `git ls-files`) + `RegisteredToolName` = vérification à la COMPILATION des `requiredTools` des blueprints |
| `tools/admin-ops.ts` | Union des ops admin typées |
| `schemas/` | guild-config (CONFIG_KEYS), components (SurfaceDefinition Zod), errors, module-constraints |
| moteur | module-dependencies (graphe), template-engine |

**Invariants vérifiés** :
- Zod v4 : defaults imbriqués via `.prefault({})` (pas `.default({})`).
- Types récursifs : unions manuelles (pas d'auto-référence de schéma).
- `pnpm typecheck` bot dépend du build `dist/` de shared (ordre garanti par le script `typecheck`).

**Limite connue** : les `requiredTools` des blueprints sont vérifiés à la compilation, mais pas les NOMS DE COLLECTIONS cités dans leurs workflows. Le store `records.*` est un registre fermé (reminders, suggestions, quotes, faq, counters, notes, component_votes) : un blueprint qui demande `records.create` dans `casino_balance` ou `giveaway_entries` se fait refuser (« Collection inconnue »). L'agent doit improviser un repli. À trancher : registre extensible par blueprint (avec vérification à la compilation), ou workflows réécrits sur les collections existantes.

## 4. Risques et recommandations

1. **Dérive checksums** : deux migrations historiques éditées après application, `prisma migrate dev` proposera un reset sur cette DB. Toute future migration doit suivre la méthode main + `db execute` + `resolve`, ou repartir d'une base fraîche en prod (les déploiements vierges replayent sans erreur).
2. SQLite mono-fichier : la Phase 4 PG16/Timescale reste le plan pour le multi-serveur (ROADMAP).
