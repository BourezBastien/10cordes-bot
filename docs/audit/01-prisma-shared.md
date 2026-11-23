# Audit 01 — Prisma & shared

## 1. Schéma Prisma (32 modèles)

**Vie du serveur** : Guild, GuildModuleState, MemberBirthday, StickyRole, AfkStatus, TempSanction, MemberActivity, InviteStat *(supprimé en C1)*

**Mémoire** : GuildMemory, MemberMemory, MemberMemoryProfile, GuildMemoryProfile, MemoryOptOut, **IngestionCursor (B1, nouveau)**

**Moteur générique** : InteractiveSurface, ScheduledTrigger, EventTrigger

**Agent** : AgentSkill, AgentAutomation, AgentRecord, AgentPanel *(supprimé)*, ToolNode

**Historique tickets** *(supprimées en C1)* : Ticket, TicketFeedback, TicketCounter

**Levels/invites** *(supprimées en C1)* : UserLevel, InviteStat

**Intégrations** : IntegrationConfig (AES-256-GCM)

**Sécurité/modération** : AuditLog, ModCase, ModCounter, RoleBackup, GuildRule

**Jobs** : ScheduledJob, ChannelWatermark

**better-auth** : User, Account, Session, Verification (table standard better-auth, conservée à tort identifiée comme captcha lors de la purge — c'est la table email de better-auth)

### Convention SQLite
Pas de type Json → colonne String + `JSON.parse/stringify` au service. Zod re-valide à la lecture (source de vérité = schémas shared).

## 2. Migrations (29)

- **20261123140000_ingestion_cursors** : CREATE TABLE `ingestion_cursors` (+ index unique guildId+channelId).
- **20261123150000_purge_business_tables** : DROP `agent_panels`, `invite_stats`, `ticket_counters`, `ticket_feedbacks`, `tickets`, `user_levels`.
- Fix historique : `20261122220000_integration_config_v2` contenait un `ALTER COLUMN` invalide en SQLite (replay shadow DB en échec) — remplacé par un commentaire ; la table réelle avait déjà la bonne forme via `20261123140000` (rebuild `IntegrationConfig` avec DEFAULT '').
- **Méthode non-destructive utilisée** pour les deux nouvelles : SQL écrit à la main + `prisma db execute` + `migrate resolve --applied` (la DB de dev contient des clés chiffrées et règles réelles : aucun reset autorisé).

## 3. packages/shared (13 fichiers, 1 184 lignes)

| Zone | Contenu |
|---|---|
| `tools/types.ts` | `BotTool`, `ToolRunContext` (reply/sendFile/progress), `ToolResult`, `defineTool<T>` (factory typée, le cast `input as` n'existe qu'ici) |
| `tools/registry-names.ts` | `REGISTERED_TOOL_NAMES` (160) auto-généré par `sync-tool-names.mjs` (scan `git ls-files`) + `RegisteredToolName` = vérification COMPILATION des `requiredTools` des blueprints |
| `tools/admin-ops.ts` | Union des ops admin typées |
| `schemas/` | guild-config (CONFIG_KEYS), components (SurfaceDefinition Zod), errors, module-constraints |
| moteur | module-dependencies (graphe), template-engine |

**Invariants vérifiés** :
- Zod v4 : defaults imbriqués via `.prefault({})` (pas `.default({})`).
- Types récursifs : unions manuelles (pas d'auto-référence de schéma).
- `pnpm typecheck` bot dépend du build `dist/` de shared (ordre garanti par le script `typecheck`).

## 4. Risques & recommandations

1. **Dérive checksums** : deux migrations historiques éditées après application → `prisma migrate dev` proposera un reset sur cette DB. Toute future migration doit suivre la méthode main + `db execute` + `resolve`, ou repartir d'une base fraîche en prod (les déploiements vierges replay sans erreur).
2. **IntegrationConfig.baseUrl NOT NULL sans défaut dans l'ancienne table** : corrigé par le rebuild de `20261123140000` (DEFAULT '').
3. SQLite mono-fichier : la Phase 4 PG16/Timescale reste le plan pour le multi-serveur (ROADMAP).
