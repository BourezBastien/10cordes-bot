# 🏗️ Architecture - 10cordes-bot

> Plan d'architecture détaillé pour validation. Complète [ROADMAP.md](./ROADMAP.md) (périmètre fonctionnel enrichi de l'analyse des 200+ suggestions communautaires Crow Bots).
> Décisions validées : **Prisma**, **config guild JSON typé**, **dashboard React (plus tard)**, **better-auth + Discord (Lucia déprécié - confirmé)**, **Zod**, **OpenRouter inclus**, **slash commands uniquement**, **langue par utilisateur**, **modules avec dépendances**, **ToolRegistry façon MCP (chat + vocal + HTTP)**, **partage d'écran bot : impossible/ToS → rejeté**.

---

## 1. Vue d'ensemble

```
┌────────────────────────────── Monorepo pnpm workspaces ──────────────────────────────┐
│                                                                                      │
│  apps/bot (Spraxium)                          apps/dashboard (React SPA, phase 2)    │
│  ├─ Modules Discord (commands/handlers)       ├─ Vite + React 19 + TS               │
│  ├─ API REST @spraxium/http (Hono) ◄──────────┼─ TanStack Router/Query/Table         │
│  ├─ better-auth (Discord OAuth) ◄─────────────┤─ shadcn/ui + Aceternity + Tailwind 4 │
│  └─ Prisma → SQLite (→ Postgres)              └─ better-auth client (cookies)        │
│                                                        │                             │
│  packages/shared ──── Zod schemas + types partagés ◄───┘                             │
│  (guild config, DTOs API, contrats erreurs)                                          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Principe de modularité** : chaque couche est un workspace indépendant. Le bot ne connaît pas le dashboard ; ils communiquent uniquement par l'API REST typée par les schémas Zod de `packages/shared`. Le HTTP vit dans le même process que le bot (supporté nativement par `@spraxium/http`, mode `sharding: false`).

## 2. Stack technique (veille techno validée)

### 2.1 Bot (`apps/bot`)

| Domaine | Choix | Pourquoi |
|---|---|---|
| Framework | Spraxium 0.9.x (existant) | modules/DI/guards/exceptions déjà en place |
| ORM | **Prisma** + SQLite (`file:./data/bot.db`) | validé ; switch Postgres = provider + URL ; migrations propres ; adapter Prisma pour better-auth |
| Validation | **Zod** (+ `packages/shared`) | source de vérité unique config/DTO ; la ValidationPipe de @spraxium/http (class-validator) ne sera pas utilisée - parse Zod manuel dans les controllers |
| Dates/durées | `dayjs` + parsing custom `1h30m` | reminders, cooldowns, giveaways |
| Images welcome | `@napi-rs/canvas` (P2) | binaires précompilés, rapide, sans build natif |
| IA | **AI SDK (Vercel)** + `@openrouter/ai-sdk-provider` officiel + `@ai-sdk/openai` + `@ai-sdk/google` + Ollama via `@ai-sdk/openai-compatible` | interface `generateText/streamText` unifiée ; OpenRouter = 300+ modèles ; fallback natif |
| Tests | `vitest` | standard écosystème |
| Lint/format | **Biome** | même choix que le framework Spraxium ; remplace ESLint+Prettier |

### 2.2 Dashboard (`apps/dashboard`, phase 2 - spécifié maintenant pour ne pas bloquer l'API)

| Domaine | Choix | Pourquoi |
|---|---|---|
| Build | **Vite 8** + React 19 + TS | SPA légère ; pas de Next.js (le backend est déjà l'API Hono du bot) |
| Styles | **Tailwind CSS v4** | tokens CSS, dark mode par classe |
| UI | **shadcn/ui** (Radix) + registre **Aceternity** | validé ; clé Aceternity dans `.env` (`ACETERNITY_API_KEY`), **jamais committée**, injectée dans `components.json` à l'install |
| Router | **TanStack Router** (file-less, type-safe) | search params typés (ex: `?guild=…`), loaders, code-splitting |
| Data | **TanStack Query 5** | cache/invalidation alignée sur l'API REST |
| Tables | **TanStack Table 9** | data tables modération/logs |
| Forms | react-hook-form + `@hookform/resolvers/zod` | résolution directe des schémas `packages/shared` |
| Charts | **ApexCharts 7 + react-apexcharts** | préférence validée (TailAdmin) ; thème via `useChartTheme()` + overrides CSS globaux dark/light |
| Auth client | `better-auth/react` (`createAuthClient`) | `useSession()`, `signIn.social({ provider: 'discord' })` |
| Toasts | sonner · Icônes : lucide-react · i18n : i18next + react-i18next | standards 2026 |

### 2.3 Thème dashboard (inspiré Tenkai + TailAdmin, vos préférences)

- **Tokens** (mode dark par défaut) : `--color-canvas #111114`, `--color-surface #19191E`, `--color-border #303038`, texte `#F2F2F5`, muted `#A0A0AD`, accent vert `#72C99B` (série de charts 1-8 reprise pour les graphs).
- **Typo** : IBM Plex Sans (variable) + IBM Plex Mono.
- **Radius** : controls `.375rem`, cards `.5rem`, overlays `.75rem` (vos screenshots) - **pas de rounded-2xl TailAdmin sur les overlays**.
- **Zéro ombre sur les surfaces** : cartes = `border` + fond, profondeur uniquement sur overlays (dropdown/dialog) via ombre douce `--shadow-theme-lg`.
- **Dark mode** : classe `.dark` + Provider light/dark/system persisté localStorage (pattern TailAdmin).
- **Rendu Discord : Components V2 systématique** - tout message du bot (vues, confirmations, logs) est rendu en composants natifs (`Container`/`TextDisplay`/`Section`/`Separator`, flag `MessageFlags.IsComponentsV2`). Le code n'utilise **aucun suffixe « v2 »** : c'est le rendu de base - helpers dans `apps/bot/src/shared/ui/` (`ui.card()`, `ui.panel()`). Les embeds restent réservés aux cas où un composant n'a pas d'équivalent.

## 3. Structure du monorepo

```
10cordes-bot/
├─ pnpm-workspace.yaml          # apps/*, packages/*
├─ apps/
│  ├─ bot/                      # migré depuis la racine actuelle
│  │  ├─ spraxium.config.ts     # plugins: [defineHttp(httpConfig)]
│  │  ├─ config/                # http.config.ts, development.config.ts, i18n.config.ts…
│  │  ├─ prisma/schema.prisma   # domaine bot + tables better-auth (générées)
│  │  └─ src/
│  │     ├─ main.ts             # SpraxiumFactory + useGlobalGuards + listen()
│  │     ├─ app.module.ts       # @HttpClientModule + @Module sur LA MÊME classe (règle framework)
│  │     ├─ app.env.ts          # @EnvSchema : DISCORD_TOKEN, DATABASE_URL, AUTH_SECRET, AI_*, HTTP_API_KEY…
│  │     ├─ auth/               # better-auth : auth.instance.ts, better-auth.middleware.ts, guards
│  │     ├─ shared/             # helpers transverses (template renderer, durations…)
│  │     └─ modules/
│  │        ├─ module-manager/  # ✅ existant (global) + extension per-guild
│  │        ├─ guild-config/    # GuildConfigService + /config + /setup
│  │        ├─ api/             # controllers HTTP : guilds, modules, config, auth-info
│  │        ├─ welcome/         # P1
│  │        ├─ logging/         # P1
│  │        └─ …
│  └─ dashboard/                # phase 2 (scaffolding Vite, décrit §2.2)
├─ packages/
│  └─ shared/                   # src/schemas/*.ts (Zod) : guild-config, api-dto, errors
│                               # src/types/*.ts : types inférés (z.infer) consommés par bot + dashboard
└─ docs/                        # ROADMAP.md, ARCHITECTURE.md
```

Règles de dépendance : `bot → shared ← dashboard`. Interdiction d'importer `discord.js` ou Prisma depuis `shared` (reste isomorphe/léger).

## 4. Couche API REST (dès P0 - le dashboard l'attendra)

Basé sur le template `http-bot` + docs `@spraxium/http` :

```ts
// config/http.config.ts
export const httpConfig = defineHttp({
  enabled: true,
  host: '127.0.0.1',                       // 0.0.0.0 seulement derrière proxy
  port: 3000,
  apiKey: process.env.HTTP_API_KEY,        // server-to-server (auto-active ApiKeyGuard, header x-api-key)
  sharding: false,
  module: AppModule,
  security: {
    cors: {                                // dashboard sur autre origine
      origins: [process.env.DASHBOARD_ORIGIN ?? 'http://localhost:5173'],
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
      credentials: true,
      maxAge: 600,
    },
  },
});
```

- **Pipeline du framework** (fixe) : hidePoweredBy → securityHeaders → CORS → bodyLimit → middlewares globaux → guards globaux → @HttpGuards (classe puis méthode) → handler.
- **Enveloppe réponse** : succès `{ … }` (JSON) ; erreurs `{ ok: false, error, details? }` via `HttpError` (BadRequestError 400, UnauthorizedError 401, ForbiddenError 403, NotFoundError 404, ConflictError 409, TooManyRequestsError 429…).
- **Versioning** : tous les controllers sous `/api/v1/…` (`@HttpController('/api/v1/guilds')`).
- **Rate limit** : `RateLimitMiddleware` sous-classé (`windowMs: 15_000, max: 100`) en middleware global.
- **Règle framework respectée** : `@HttpClientModule` directement sur `AppModule` (jamais de module HTTP séparé - ignoré silencieusement sinon).

### 4.1 Auth (better-auth + Discord) - la pièce centrale

**Server** (`src/auth/auth.instance.ts`) :
```ts
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'sqlite' }),   // même DB que le bot
  socialProviders: {
    discord: {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      scopes: ['identify', 'email', 'guilds'],               // 'bot' ajouté uniquement sur l'URL d'invite
    },
  },
  session: { expiresIn: 7 * 24 * 3600, cookieCache: { enabled: true, maxAge: 5 * 60 } },
  rateLimit: { enabled: true, window: 60, max: 20 },
  trustedOrigins: [env.DASHBOARD_ORIGIN],
});
```
- **Montage sans accès Hono brut** : `HttpMiddleware` global qui intercepte `ctx.req.path.startsWith('/api/auth')` → `return auth.handler(ctx.req.raw)` (un middleware peut court-circuiter en retournant une `Response` - supporté). *Point à vérifier à l'implémentation : ordre du middleware vs CORS (le préflight OPTIONS de /api/auth doit passer par CorsMiddleware - sinon intercepter aussi OPTIONS).*
- **Tables better-auth** : générées dans `schema.prisma` via `npx @better-auth/cli generate --output prisma/schema.prisma` (User, Session, Account, Verification). Re-générer après chaque ajout de plugin.

**Guards API** (`src/auth/guards/`) :
1. `SessionGuard implements HttpGuard` - `auth.api.getSession({ headers: ctx.req.raw.headers })` ; 401 sinon. Global sur `/api/v1`.
2. `GuildAccessGuard` - sur `@HttpGuards` des routes `/guilds/:guildId/*` : vérifie que l'utilisateur de la session possède **ManageGuild ou Administrator** sur le guild (fetch discord.js via Client injecté, cache 5 min Map<guildId+userId>). 403 sinon.
3. `ApiKeyGuard` - actif par config pour les appels serveur-à-serveur (webhooks, CI), contournement de session.

**Flux auth complet** :
```
Dashboard → GET /api/auth/signin/discord (signIn.social) → redirect Discord
→ callback /api/auth/callback/discord → better-auth crée User+Account, pose le cookie de session
→ Dashboard useSession() OK → GET /api/v1/guilds (liste des guilds Discord du user, cross user.accounts + guilds.bot)
→ pour chaque guild : bot présent ? user admin ? → UI liste des guilds gérables
```
L'**invite du bot** passe par une URL OAuth séparée avec scope `bot` + `permissions` calculées (constante partagée dans `packages/shared`) - jamais mélangée au login (principe moindre privilège ; le scope `guilds` du login sert juste à lister les guilds du user).

### 4.2 Endpoints P0

| Méthode + route | Guard | Rôle |
|---|---|---|
| `GET /api/v1/guilds` | Session | Guilds du user (intersection guilds Discord ↔ guilds du bot) + droits admin |
| `GET /api/v1/guilds/:guildId` | Session + GuildAccess | Infos guild (via `BotBridge.getGuild`) + résumé config |
| `GET /api/v1/guilds/:guildId/config` | Session + GuildAccess | Guild config (JSON typé) |
| `PATCH /api/v1/guilds/:guildId/config` | Session + GuildAccess | Patch partiel → Zod parse → persist → invalidate cache |
| `GET /api/v1/guilds/:guildId/modules` | Session + GuildAccess | États modules per-guild |
| `PATCH /api/v1/guilds/:guildId/modules/:moduleId` | Session + GuildAccess | Toggle + whitelist (channels/roles/users) |
| `GET /api/v1/meta/modules` | Session | Catalogue (id/label/description/commandes) - pour rendre l'UI générique |
| `GET /api/v1/meta/session` | Session | Profil courant (pour l'UI) |

Convention live-edit : **toute écriture API passe par les mêmes services que les commandes Discord** (une seule implémentation, deux interfaces). Le dashboard n'est qu'un client de plus.

## 5. Couche données (Prisma)

```prisma
// P0 - socle (les tables better-auth s'ajoutent via le CLI à l'étape API)
model Guild {
  id        String   @id                     // snowflake Discord
  settings  Json                             // GuildConfigSchema (Zod → JSON typé)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
model GuildModuleState {
  id          String  @id @default(cuid())
  guildId     String
  moduleId    String
  enabled     Boolean @default(true)
  constraints Json?   // ModuleConstraintsSchema (Zod) : whitelists {channels,roles,users}, cooldownMs, roleQuotas, adminBypass
  @@unique([guildId, moduleId])
}
model UserLocale {
  userId  String @id   // snowflake Discord
  locale  String       // "fr", "en"…
  source  String       // "manual" | "auto" (détectée du client Discord)
}
```
- `guild.settings` validé **au read ET au write** par `GuildConfigSchema.parse` (migration douce : champs manquants = defaults Zod, pas de migration à chaque feature).
- Cache mémoire : `Map<guildId, GuildConfig>` dans `GuildConfigService`, invalidé à l'écriture (single process). Redis seulement si sharding un jour.
- **Zod = source de vérité** : `packages/shared/src/schemas/guild-config.ts` définit le schéma complet (langue, salons logs, welcome, cooldowns par module, whitelists…) ; Prisma `Json` ne fait que le stocker.

## 6. Extension du module-manager (per-guild + whitelists + cooldowns)

```
Discord: /modules configure <module>
  ├─ salon whitelist      → multi-select salons (autocomplète)
  ├─ rôle requis          → autocomplète rôles
  ├─ cooldown <durée>     → "1h30m" parsé (dayjs)
  └─ activer/désactiver pour ce serveur
Dashboard: PATCH /api/v1/guilds/:guildId/modules/:moduleId  (même service)
```
Ordre d'évaluation du `ModuleEnabledGuard` (global, étendu) :
1. module inconnu du catalogue → pass (commandes système)
2. désactivé **globalement** → `ModuleDisabledException` (existant)
3. désactivé **pour ce guild** → idem
4. **dépendance inactive** (graphe) → `ModuleDependencyException` (nouveau)
5. salon hors whitelist → `ModuleChannelException` (nouveau)
6. rôle requis manquant → `PermissionDeniedException` (built-in)
7. quota par rôle, puis cooldown par user (bypass admin si `adminBypass`) → `CooldownException` (built-in)

Listeners/components : même logique via `ModuleManagerService.assertUsable(guildId, moduleId, context)` (early-return/throw).

## 7. Flows détaillés (P0)

### 7.1 Boot
```
EnvValidator.validate(AppEnv)  ( échec → table + exit/hot-reload dev )
→ Prisma $connect + check migrations (pnpm prisma migrate deploy au boot dev, warn sinon)
→ SpraxiumFactory.create({ token }) → useModule(AppModule) → provide(AppEnv) → useGlobalGuards(ModuleEnabledGuard étendu)
→ listen() → DI graph résolu → onBoot hooks :
   GuildConfigService : warm cache guilds actifs
   HttpServer : démarre (after client ready) → better-auth middleware + routes enregistrées
→ slash commands enregistrées (hash cache dev)
```
### 7.2 Édition config via Discord
```
/config view|set <clé> <valeur>   (autocomplète sur les clés du schéma Zod, labels i18n)
→ GuildConfigService.patch(guildId, patch) → Zod safeParse (erreur → ValidationException avec champ/reason)
→ Prisma upsert → cache invalidé → réponse éphémère ✅ (effet immédiat sur tous les modules)
```
### 7.3 Édition config via dashboard (phase 2)
```
PATCH /api/v1/guilds/:id/config → SessionGuard → GuildAccessGuard → même GuildConfigService.patch
→ 200 { config } ; TanStack Query invalide ['guild', id, 'config'] → UI reflète
```
### 7.4 Join du bot sur un nouveau serveur
```
GuildCreate listener → Prisma Guild upsert (settings = defaults Zod) → log boot
→ message éphémère Owner : /setup suggéré
```
### 7.5 Erreur
```
throw (SpraxiumException | HttpError | ZodError→ValidationException)
→ ExceptionHandler (Discord) : layout par classe → reply éphémère utilisateur
→ interne : Logger.error (DiscordTransport si configuré) ; jamais de stack côté user
```

## 8. Couche IA (P3, interface dès P0 dans `packages/shared`)

```ts
// packages/shared/src/ai/provider.ts
export const AiProviderId = z.enum(['openai', 'openrouter', 'gemini', 'ollama']);
export const AiConfigSchema = z.object({
  provider: AiProviderId.default('openrouter'),
  model: z.string().default('openai/gpt-4o-mini'),        // ids OpenRouter
  fallbackModel: z.string().optional(),
  budgetPerGuildPerDay: z.number().int().positive().default(50), // requêtes/jour
});
```
- Registry `AiProviderService` (bot) : construit le model AI SDK selon config (OpenRouter via `@openrouter/ai-sdk-provider`, clé lue depuis env `AI_PROVIDER_API_KEY`/`OPENROUTER_API_KEY` - **jamais en DB ni en dur**) ; `generateText`/`streamText` ; fallback automatique sur `fallbackModel` en cas d'erreur provider.
- Budget : compteur `AiUsage` en DB (guild, jour, requêtes) - 429-like `RateLimitException` au-delà.
- Modules IA (résumé, traduction, modération assistée) : opt-in par serveur, jamais actifs par défaut.

## 9. Qualité & DX

- **Biome** (lint+format, config à la racine du monorepo) · **vitest** (unit : services, parsing durées, schémas Zod ; cible ≥ 80 % sur `packages/shared` + services purs).
- **Typecheck CI** : `tsc --noEmit` par workspace + `prisma validate` + `prisma migrate diff` (drift check).
- **Conventions live-edit** : toute feature nouvelle = ① entrée catalogue module-manager ② schéma Zod dans shared ③ service ④ commandes `/xxx configure` ⑤ endpoints REST ⑥ tests. Une seule implémentation métier partagée commandes/API.
- **Secrets** : uniquement via `.env` (jamais committé) ; `.env.example` avec placeholders vides. Clé Aceternity = variable d'env consommée par le CLI shadcn, jamais écrite dans les sources.
- **Commits** : conventional commits (commitlint comme le framework).

## 10. Plan d'exécution P0 (fondations)

| Étape | Livrable | Critère de done |
|---|---|---|
| 1 | Restructure monorepo (`apps/bot`, `packages/shared`), Biome, vitest | `pnpm i && pnpm -r typecheck && pnpm -r test` verts |
| 2 | Prisma + SQLite + schema Guild/GuildModuleState (+ tables better-auth générées) | `migrate dev` OK, `prisma validate` OK |
| 3 | `packages/shared` : `GuildConfigSchema`, `ModuleWhitelistSchema`, DTOs API, ids erreurs | tests Zod ≥ 80 % |
| 4 | `GuildConfigService` (cache + patch + defaults) + `/config` (view/set, autocomplète) | toggle éditable en live, persist, testé |
| 5 | Extension `ModuleEnabledGuard` : per-guild + whitelists + cooldowns (+ `/modules configure`) | matrice §6 testée |
| 6 | API : `defineHttp` + CORS + better-auth (middleware + Discord OAuth) + SessionGuard + GuildAccessGuard + endpoints §4.2 | flux auth complet OK en local (curl/dashboard dev) |
| 7 | `/setup` wizard v1 + `/info` + i18n fr/en (`@spraxium/i18n`) | setup guidé < 2 min |
| 8 | Welcome & Leave (P1) branché sur GuildConfigService | flow §7 complet |

Chaque étape = 1 PR reviewable. **Rien du dashboard ne bloque : l'API (étape 6) est consommable au curl.**

## 11. Risques & points à vérifier à l'implémentation

1. **better-auth dans Hono via middleware** - le montage par `HttpMiddleware` (native `Response` pass-through) est supporté par le framework mais non testé avec better-auth ; fallback documenté : serveur better-auth autonome (port séparé) - l'API du bot reste inchangée.
2. **OPTIONS preflight vs middleware d'auth** - s'assurer que CorsMiddleware précède l'interception `/api/auth` (ordre pipeline §4) sinon exclure OPTIONS dans le matcher.
3. **Cookies cross-origin** - dashboard dev (5173) vs API (3000) : `credentials: true` + `trustedOrigins` + `sameSite: lax` (default better-auth). En prod, viser même domaine derrière reverse-proxy pour éviter les soucis de cookies tiers.
4. **ValidationPipe vs Zod** - `@HttpBody(DtoClass)` du framework utilise class-validator ; on garde `@HttpBody()` brut + parse Zod explicite (DTOs Zod partagés). Ne jamais déclarer de DTO class-validator pour éviter deux sources de vérité.
5. **Spraxium 0.x** - breaking changes possibles : pinner la version exacte dans `apps/bot/package.json`, surveiller les changelogs du framework.

## 12. Modules & sous-modules : graphe de dépendances

Le catalogue (`ModuleDescriptor`) gagne `dependsOn: string[]` (obligatoires) et `recommends?: string[]` (suggestions, ex: levels → role-rewards). La **logique de graphe est pure et vit dans `packages/shared`** (testable, réutilisable par le dashboard) :

- `analyzeEnable(catalog, activeSet, target)` → dépendances à activer automatiquement.
- `analyzeDisableCascade(catalog, activeSet, target)` → modules qui seraient désactivés en cascade ; un module survit s'il est requis par un autre module **restant actif** (protection).
- `assertDependenciesActive(catalog, activeSet, target)` → liste des dépendances inactives (utilisée par le guard).

Le guard bloque toute commande d'un module dont une dépendance est inactive (`ModuleDependencyException`). UI : `/modules disable` liste la cascade et demande confirmation (`confirm: true` en P0 ; upgrade boutons avec `@spraxium/components` en P1).

## 13. i18n - langue par utilisateur (jamais par serveur)

Résolution : préférence explicite (`/language set`, `UserLocale.source = manual`) > **langue du client Discord** (`interaction.locale`, capturée automatiquement à la première interaction si aucune préférence - `source = auto`) > défaut du bot. Persistance Prisma (`UserLocale`) + cache mémoire. L'interface `I18nStore` de `@spraxium/i18n` est implémentée par ce store Prisma. Toute la chaîne (messages bot, exceptions, layouts, dashboard i18next) consomme la même résolution. Référence framework : `I18nService.tUser(userId, key, vars)`.

## 14. ToolRegistry (MCP interne) & Assistant

```ts
// packages/shared - contrat
interface BotTool {
  name: string;                    // "music.play", "channels.lock"
  description: string;
  paramsSchema: z.ZodType;         // validation + génération AI SDK tools
  requiredModules: string[];       // filtrage par modules actifs du serveur
  handler(input, ctx): Promise<ToolResult>;
}
```

- **Registry** central (`ToolRegistryService`) : enregistrement au boot par chaque module, exécution validée (Zod) + autorisée (modules actifs du guild).
- **Frontends** : ① **chat** - mention du bot / canal dédié / DM ; ② **vocal** - `@discordjs/voice` + Silero VAD (ONNX, supérieur au WebRTC VAD) + STT (Deepgram streaming ou Whisper, Opus→PCM via prism-media/ffmpeg) + TTS ; ③ **MCP over HTTP** (P3) - le même registry exposé via `@spraxium/http`.
- **Résolution d'intention** : hooks déterministes d'abord (patterns de phrases fr/en par tool), puis **LLM tool-calling** (AI SDK : `generateText({ tools })` + OpenRouter/OpenAI/Gemini/Ollama) avec budget par guild (`AiUsage` en DB) et opt-in par serveur.
- Inventory des tools : voir [ROADMAP.md §Tools](./ROADMAP.md#-inventory-des-tools-toolregistry-cible-200300).

## 15. Verdicts plateforme (recherche 2026)

- **Screen share / Go Live par bot** : impossible via l'API officielle (bots = audio only ; Go Live est client-only). Les librairies self-bot (ex: Discord-video-stream) violent les ToS → **rejeté** ; documenté comme limite.
- **Auth** : Lucia déprécié (mars 2025, l'auteur recommande better-auth) → **better-auth confirmé**, Discord-only (email/password désactivé), adapter Prisma, cookie sessions, tables générées dans notre schema.
- **Vocal** : Silero VAD > WebRTC VAD (filtrage du bruit) ; Deepgram pour le streaming, Whisper pour du batch.

## 16. Agent Admin - architecture de sécurité (P2, flagship)

L'agent qui administre Discord par langage naturel suit le modèle **plan → confirmation → exécution → rapport → audit**, inspiré de la file d'actions typées wardhive :

```
demande utilisateur ("refais le serveur sur le thème de Noël")
→ LLM + tools → PLAN (liste d'ops typées, diff avant/après, rendu container V2)
→ vérifications AVANT proposition : perms Discord du demandeur (op par op)
   + perms du BOT (l'agent vérifie qu'il peut exécuter chaque op)
→ confirmation humaine (bouton) - réservée selon l'op :
     destructif (delete) = owner + whitelist d'IDs (table admin_whitelist)
     créations/modifs    = ManageGuild / Administrator
→ exécution via file d'ops : union discriminée Zod
     channel.create|rename|archive|delete · role.create|update|delete
     permission.overwrite · automod.policy.set · server.remodel(theme)
   → jobs idempotents, snapshot ARCHIVÉ avant toute suppression
     (archive = structure salons/rôles, restaurable - jamais de hard-delete en cascade)
→ rapport d'exécution (container V2, par op : ✅/❌ + raison)
→ audit : acteur · plan JSON · qui a confirmé · résultat · coût IA (cause-typed)
```

Règles système : le system prompt impose identité/ton (jamais d'insultes), politique de filtrage des messages, vérification des permissions AVANT toute proposition, protocole de confirmation obligatoire, refus hors périmètre. Traduction « policy-as-config » : *« supprime tous les liens et averti »* → règle automod Zod-typée (salons/rôles ciblés) passant par le même pipeline confirmé. Nuance API : AutoMod ne sait pas « avertir » → la demande se décompose en [règle AutoMod HARMFUL_LINK + block] + [handler bot `auto_moderation_action_execution` pour le warn] - les DEUX parties sont proposées explicitement (limits API : 6 règles keyword/guild, 1000 keywords/règle).

**10 règles d'or** (recherche Anthropic / OpenAI Agents SDK / LangGraph / discord-mcp, 2026) :

1. **Fail-closed partout** - mode écriture par défaut = preview (mutations bloquées) ; requête ambiguë → question de clarification, jamais une mutation au meilleur jugement.
2. **Confirmation avant TOUTE mutation** (pas seulement les destructives) - les tools read-only tournent libres ; tier 2 (créer/modifier) = confirmation légère, tier 3 (supprimer/ban/masse) = confirmation renforcée avec conséquences explicites.
3. **Autoriser le CLIQUEUR, pas le demandeur** - le clic sur le bouton est une interaction fraîche : re-vérifier ses permissions à ce moment-là, jamais se fier à l'auteur du message initial.
4. **Timeout = annulation** - sans confirmation en N minutes, la proposition expire (boutons désactivés, log) ; jamais d'auto-exécution.
5. **Trois gates indépendants ÉVALUÉS EN CODE, jamais dans le prompt** : (a) perms Discord du demandeur + position de rôle vs cible ; (b) capacités du bot (flags + rôle au-dessus de la cible) ; (c) allowlists config + deny rules non contournables même en bypass. Snapshot de hiérarchie injecté au prompt = contexte advisory seulement.
6. **Archivage = états explicites** `active | archived | trashed` (jamais un booléen) : canal → renommé `#archive-…` + catégorie Archive, ou config capturée → suppression → restore-data avec purge programmée.
7. **Une proposition = un plan exécutable complet** - tous les tool-calls gated batchés en UNE confirmation (pattern LangGraph batched interrupts), exécution de l'ensemble approuvé, atomique quand possible.
8. **Tools conçus pour l'agent** : namespacés (`automod_rule_create`), consolidés (`set_channel_overwrite` au lieu de 3 primitives), erreurs actionnables (quoi/pourquoi/exemple corrigé), annotations `readOnlyHint`/`destructiveHint`.
9. **Policy-as-config : Zod = contrat de sécurité** - l'IA ne fait que REMPLIR le schéma (structured output), jamais le contour ; limites API vérifiées avant proposition.
10. **Audit intégral + exécution idempotente** - chaque proposition persistée (demande, plan, approbateur, résultat) ; audit-log reasons Discord sur chaque action ; clés d'idempotence pour qu'une approbation rejouée ne double-exécute pas ; readback post-exécution (« Activity Evidence ») pour vérifier l'état réel.

**Squelette du system prompt (10 sections)** - `<IDENTITY>` (opérateur délégué, jamais d'insulte, déclin neutre) · `<TONE_AND_MESSAGING>` (registre, langue du demandeur, interdits) · `<SCOPE>` (allow/deny explicites ; demande mixte valide+invalide = rejet total expliqué) · `<SERVER_CONTEXT>` (snapshot hiérarchie/perms injecté au runtime - advisory) · `<TOOL_USE_GUIDANCE>` (read-before-write, préférer archive à delete, jamais d'IDs devinés) · `<CONFIRMATION_PROTOCOL>` (jamais d'exécution sans proposal ID approuvé par bouton ; un « oui » en chat ne compte pas) · `<DESTRUCTIVE_ACTION_POLICY>` (archive-first, masse interdit sans confirmation multi-étapes, irréversibilité énoncée dans l'embed) · `<POLICY_TRANSLATION_RULES>` (schémas AutoMod, décompositions, questions à poser si ambigu) · `<ERROR_HANDLING>` (auto-correction si fixable, jamais de retry aveugle sur un destructif) · `<AUDIT_AND_REPORTING>` (rapport avec noms+IDs, dire quelle gate a refusé sans leak de config).

Réfs : [Anthropic - Writing effective tools](https://www.anthropic.com/research/writing-tools-for-agents) · [Claude Agent SDK - Permissions](https://code.claude.com/docs/en/agent-sdk/permissions) · [OpenAI Agents SDK - Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/) · [LangGraph humanInTheLoopMiddleware](https://reference.langchain.com/javascript/langchain/index/humanInTheLoopMiddleware) · [cappyeo/discord-mcp](https://github.com/cappyeo/discord-mcp) (222 tools, preview-first, dry-run) · [KOBA789/human-in-the-loop](https://github.com/KOBA789/human-in-the-loop) (Discord comme canal d'approbation MCP) · [MCP Tools spec](https://modelcontextprotocol.io/docs/concepts/tools).

**Mémoire conversationnelle par canal** (pattern Discord-AI-Bot) : l'historique Discord est la mémoire - fetch des N derniers messages du canal, rendu `[Label (ID)] : contenu` avec préfixes inforgeables (contenu neutralisé), messages du bot = turns assistant. Pas d'état partagé entre canaux. Gate de triage : appel cheap model OUI/NON avant génération coûteuse (mention/DM bypass).

## 17. Realtime bot ↔ dashboard

Bot et API vivent dans le même process (§1) → **event bus interne** (EventEmitter typé) + broadcast **WebSocket** depuis Hono vers le dashboard (Salons configurés, modules togglés, audit en direct). Migration Postgres : `LISTEN/NOTIFY` remplace le bus interne sans changer le contrat des events. RethinkDB écarté (moins maintenu, PostgreSQL/SQLite couvrent le besoin).

## 18. Jeux - trois couches de rendu

1. **Chat tour-par-tour** : limite ~5 msgs/5s/canal → boards rendus `@napi-rs/canvas` (Skia, zéro dep système, `imageSmoothingEnabled=false` pour le pixel net), contrôles boutons (`custom_id` typé), animations GIF via `gifenc`, assets CC0 Kenney/itch.io.
2. **Discord Activities** (seul vrai realtime) : Embedded App SDK, Hono sert OAuth token exchange + SPA + **serveur Colyseus** sur le même process ; URL Mappings portail (dev : cloudflared) ; lancement via callback `LAUNCH_ACTIVITY` (type 12) ; rooms Colyseus indexées par `instanceId` du SDK ; WebSockets only (pas de WebRTC derrière le proxy Discord).
3. Liaison modules : jeux = sous-modules de `games` ; récompenses economy/XP via deps optionnelles.

Réfs : discord/embedded-app-sdk (1.4k⭐) · colyseus/discord-activity · embedded-app-sdk-examples · poketwo · Gamecord.

## 19. Audit & error boundary

- **AuditService** (pattern wardhive) : `record(guildId, source, action, actor, target, metadata)` fire-and-forget - une erreur d'audit n'échoue jamais sur l'action ; **feed unifié** mergant les tables hétérogènes (audit, sanctions, logs messages, ops agentic, jeux) en timeline normalisée.
- **Coûts IA** (pattern Discord-AI-Bot) : table `model_usage` clé `cause` (reply | triage | admin-agent | game …), tokens + prix via API OpenRouter → page audit = « qui a fait quoi + ce que ça a coûté ».
- **Error boundary** : tout throw non géré → layout utilisateur (langue du user) + log structuré (Logger.error) + option salon d'incidents ; jamais de stack côté utilisateur.

