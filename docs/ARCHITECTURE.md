# 🏗️ Architecture - 10cordes-bot

> Plan d'architecture détaillé pour validation. Complète [ROADMAP.md](./ROADMAP.md) (périmètre fonctionnel enrichi de l'analyse des 200+ suggestions communautaires Crow Bots).
> Décisions validées : **Prisma**, **config guild JSON typé**, **dashboard React (plus tard)**, **better-auth + Discord (Lucia déprécié - confirmé)**, **Zod**, **OpenRouter inclus**, **zéro slash command (tout par l'agent IA + portail éphémère)**, **langue par utilisateur**, **modules avec dépendances**, **ToolRegistry façon MCP (chat + vocal + HTTP)**, **partage d'écran bot : impossible/ToS → rejeté**.
> Le tableau de bord et l'API sont livrés depuis le 25/11/2026 : les §2.2, §2.3, §4 et §17 décrivent leur état livré. Le détail opérant (invariants, gardes, pièges) vit dans [AGENTS.md](../AGENTS.md).

---

## 1. Vue d'ensemble

```
┌────────────────────────────── Monorepo pnpm workspaces ──────────────────────────────┐
│                                                                                      │
│  apps/bot (Spraxium)                          apps/dashboard (React SPA)              │
│  ├─ Listeners et handlers Discord             ├─ Vite 8 + React 19 + TS               │
│  ├─ API REST @spraxium/http (Hono) ◄──────────┼─ TanStack Router/Query + Tailwind 4   │
│  ├─ better-auth (Discord OAuth) ◄─────────────┤─ primitives propres (src/ds)          │
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

### 2.2 Dashboard (`apps/dashboard`, livré)

| Domaine | Choix | Pourquoi |
|---|---|---|
| Build | **Vite 8** + React 19 + TS | SPA légère ; pas de Next.js (le backend est déjà l'API Hono du bot). Chaque page d'un serveur est un morceau à part (`lazyRouteComponent`) |
| Styles | **Tailwind CSS v4** (CSS-first) | jetons dans `@theme` (`src/styles/tokens.css`), utilitaires du langage graphique dans `theme.css`, thème sombre seul |
| UI | **primitives propres** (`src/ds`) | bouton, champ, liste déroulante, onglets, tiroir, confirmation, tableau, pastille, indicateurs, fil, étapes : indépendantes de toute bibliothèque de composants |
| Router | **TanStack Router** (routes par le code, typées) | garde de session dans `beforeLoad`, retour à la page demandée après le login |
| Data | **TanStack Query 5** | cache et invalidation, relancés par le flux temps réel du serveur affiché |
| Tables | `DataTable` (`src/ds/table.tsx`) | filets d'un pixel, défilement en largeur sur un petit écran |
| Formulaires | état React + schémas Zod de `packages/shared` | même contrat que l'API, aucune bibliothèque de formulaire |
| Graphiques | **ApexCharts** + react-apexcharts | barres plates de la consommation par jour (page Système) |
| Auth client | `better-auth/react` | session par cookie, `signIn.social({ provider: 'discord' })` |
| Divers | sonner (toasts) · lucide-react (icônes) · i18next + react-i18next (FR/EN) | |

### 2.3 Thème dashboard (livré)

> **Inspiration visuelle principale : [ARCHIVE-9](https://github.com/LeoBdt/ARCHIVE-9)** (repo de LeoBdt). Le dashboard n'est pas une copie, mais son langage graphique a été délibérément repris : thème sombre, hiérarchie par accents, structure des vues. Ce même langage guide aussi nos panneaux Discord Components V2.

- **Tokens** (`src/styles/tokens.css`) : fond `#0a0a0d`, panneaux `#0e0e12` et `#101015`, champ `#121217`, filets `#1f1f26`, `#26262e` et `#3a3a44`, textes de `#e9e9ee` à `#a6a6b2`. Accent : l'orange 10cordes `#d95926` (survol `#ffa070`, texte sur accent `#1a0c06`). Sémantique : vert `#6ee7a8`, jaune `#f5c04a`, rouge `#ff4757`, bleu `#7cc4ff`, violet pour les compétences. La palette, les rayons et les ombres par défaut de Tailwind sont retirés dans `@theme` AVANT ces jetons.
- **Typo** : Silkscreen (titres, libellés, boutons : pixel, auto-hébergée par `@fontsource`) + JetBrains Mono variable (textes courants).
- **Aucun angle arrondi, aucune ombre** : la profondeur vient de la lumière des surfaces et de filets de 2 px. Les cadres sont crantés (utilitaire `notched` : les quatre coins retirés).
- **Thème sombre seul** ; animations par pas (`motion.css`), coupées sous `prefers-reduced-motion`.
- **Zones d'appui de 44 px**, y compris sous un dessin plus petit (puces, interrupteurs).
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
│  │     ├─ app.env.ts          # @EnvSchema : DISCORD_TOKEN, DATABASE_URL, LLM_*, HTTP_API_KEY…
│  │     ├─ auth/               # better-auth : auth.instance.ts, auth-origins.ts, guards
│  │     ├─ core/               # security/ : politiques d'accès et de permissions (POO)
│  │     ├─ shared/             # helpers transverses (ui/, crypto/, cache/, template renderer…)
│  │     └─ modules/
│  │        ├─ module-manager/  # ✅ existant (global) + extension per-guild
│  │        ├─ guild-config/    # GuildConfigService + tools agent config.*
│  │        ├─ api/             # API du tableau de bord : providers, capabilities, integrations,
│  │        │                   # webhooks, rules, usage, events (SSE), panel compilé, politique
│  │        ├─ webhooks/        # connecteurs HTTP sortants (outil webhook.call)
│  │        ├─ assistant/       # agent conversationnel (gate, AgentLoop, SystemPromptBuilder)
│  │        ├─ surface/         # moteur d'interactions générique (surfaces + triggers)
│  │        └─ …
│  └─ dashboard/                # livré : src/ds (primitives), shell, lib, pages (§2.2)
├─ packages/
│  └─ shared/                   # src/schemas/*.ts (Zod) : guild-config, api-dto, errors
│                               # src/types/*.ts : types inférés (z.infer) consommés par bot + dashboard
└─ docs/                        # ROADMAP.md, ARCHITECTURE.md
```

Règles de dépendance : `bot → shared ← dashboard`. Interdiction d'importer `discord.js` ou Prisma depuis `shared` (reste isomorphe/léger).

## 4. Couche API REST (livrée)

Le serveur HTTP du bot est déclaré dans `config/http.config.ts` : pas de clé
API globale (elle exigeait `x-api-key` sur toute route, login Discord
compris). La clé `HTTP_API_KEY` protège la seule sonde `/healthz`
(`ProbeKeyGuard`). L'API du tableau de bord s'authentifie par la session.

```ts
// config/http.config.ts (extrait)
export const httpConfig = defineHttp({
  host: process.env.HTTP_HOST ?? '127.0.0.1',   // 0.0.0.0 seulement derrière proxy
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  module: AppModule,
  security: httpSecurity(process.env.DASHBOARD_ORIGIN),  // src/modules/api/http-security.ts
});
```

- **Pipeline du framework** (fixe) : hidePoweredBy → en-têtes de sécurité → CORS → bodyLimit → middlewares du module (`LoggerMiddleware`, `ApiPolicyMiddleware`) → `@HttpGuards` (classe puis méthode) → handler.
- **Politique commune** (`ApiPolicyMiddleware`, avant toute route) :
  - `Cache-Control: no-store` et `X-Robots-Tag: noindex, nofollow` sur tout `/api/` ;
  - contrôle d'origine : toute requête de `/api/v1` qui modifie (hors GET) vient d'une origine admise (`Origin`, sinon `Referer`), faute de quoi 403. La session voyage dans un cookie : sans ce contrôle, une page tierce ferait modifier le serveur par le navigateur d'un membre connecté ;
  - CSP : `default-src 'none'` sur chaque réponse, et la CSP des pages (`default-src 'self'`, scripts et styles du serveur seul, polices du serveur, images de Discord) sur les seules pages HTML du bot. La CSP du framework est désactivée : il la pose après le handler, une valeur pour toutes les réponses.
- **Enveloppe réponse** : succès `{ … }` (JSON, la ressource nommée : `{ provider }`, `{ routes }`, `{ webhook }`…) ; erreurs `{ ok: false, error, details? }` via `HttpError` (400, 401, 403, 404, 409, 422, 429…).
- **Versioning** : les contrôleurs du tableau de bord sont sous `/api/v1/guilds/:guildId/…`, un contrôleur par groupe.
- **Contrat** : les schémas Zod de `packages/shared/src/schemas/dashboard-*.ts` servent au bot (validation des corps) et au tableau de bord (contrôle des réponses).
- **Règle framework respectée** : `@HttpClientModule` directement sur `AppModule` (jamais de module HTTP séparé : ignoré silencieusement sinon). Le contrôleur fourre-tout du panel (`PanelController`, `GET /*`) est déclaré en DERNIER.

### 4.1 Auth (better-auth + Discord) - la pièce centrale

**Server** (`src/auth/auth.instance.ts`, livré) :
```ts
betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: origins[0],                                      // première origine admise du panel
  trustedOrigins: origins,                                  // DASHBOARD_ORIGIN : plusieurs, séparées par des virgules
  advanced: { useSecureCookies: publicUrl.startsWith('https://') },
  database: prismaAdapter(prisma, { provider: 'sqlite' }),  // même DB que le bot
  emailAndPassword: { enabled: false },
  socialProviders: {
    discord: { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET, scopes: ['identify'] },
  },
  session: { expiresIn: 7 * 24 * 60 * 60, cookieCache: { enabled: true, maxAge: 5 * 60 } },
  rateLimit: { enabled: true, window: 60, max: 20 },        // limite propre au login
  databaseHooks: {
    account: {
      // Les jetons OAuth sont effacés dès que le compte est lié : il ne reste que l'identifiant Discord.
      create: { after: (account) => scrubOAuthTokens(prisma, account.id) },
      update: { after: (account) => scrubOAuthTokens(prisma, account.id) },
    },
  },
});
```
- **Montage** : `AuthController` (`@HttpController('/api/auth')`, `GET` et `POST` sur `/*`) rend la `Response` de `auth.handler(ctx.req.raw)` telle quelle. Sans login configuré (`BETTER_AUTH_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`), chaque requête répond 503 avec la cause.
- **Tables better-auth** : générées dans `schema.prisma` via `npx @better-auth/cli generate --output prisma/schema.prisma` (User, Session, Account, Verification). Re-générer après chaque ajout de plugin.
- **L'appartenance à un serveur ne vient jamais d'un jeton de l'utilisateur** : elle se lit avec le client du bot (`GuildAccessGuard`).

**Guards API** (`src/auth/guards/`, livrées) :
1. `SessionGuard implements HttpGuard` : la session de la requête (cookie), lue par `readSession` ; sans session, ou login non configuré, refus (401). La session lue est posée dans le contexte pour les handlers et les gardes en aval. Elle ouvre chaque route du tableau de bord.
2. `GuildAccessGuard` : sur chaque route portant `:guildId`. À CHAQUE requête, sans cache : l'identité Discord liée à la session doit être membre du serveur et passer `GuildManagerPolicy` (Gérer le serveur, Administrateur ou propriétaire). Sinon 403.
3. `ProbeKeyGuard` : sur la seule sonde `/healthz` (clé `HTTP_API_KEY`, comparaison en temps constant). Plus aucune autre route ne demande de clé API.

**Flux auth complet** :
```
Dashboard → requireSession (beforeLoad) : sans session → /login?redirect=<page demandée>
→ signIn.social({ provider: 'discord' }) → redirect Discord (scope identify)
→ callback /api/auth/callback/discord → better-auth crée User+Account, efface les jetons, pose le cookie
→ retour à la page demandée → GET /api/v1/guilds (serveurs du bot où le membre lié peut gérer)
→ chaque appel suivant : SessionGuard → GuildAccessGuard → handler
```
L'**invite du bot** passe par une URL OAuth séparée avec scope `bot` + `permissions` calculées : jamais mélangée au login (principe de moindre privilège).

### 4.2 Endpoints (livrés)

Sauf mention, chaque route exige la session puis l'accès au serveur (`SessionGuard`, `GuildAccessGuard`).

| Méthode + route | Rôle |
|---|---|
| `GET /api/v1/guilds` | Serveurs du bot où le membre lié à la session peut gérer (session seule) |
| `GET /api/v1/guilds/:guildId` | Fiche du serveur (nom, icône, nombre de membres) ; l'accueil compose le reste à partir des routes ci-dessous |
| `GET` / `PATCH /api/v1/guilds/:guildId/config` | Configuration du serveur (JSON typé), correctif partiel validé par Zod |
| `GET /api/v1/guilds/:guildId/modules` · `PATCH …/modules/:moduleId` | États des modules, activation et coupure (avec sa cascade) |
| `GET /api/v1/guilds/:guildId/channels` · `…/roles` | Salons visibles et rôles, pour les sélecteurs |
| `GET /api/v1/guilds/:guildId/audit?kind=actions\|plans\|errors&page=N` | Journal du serveur, par famille, paginé ; une famille inconnue est refusée (400) |
| `GET /api/v1/guilds/:guildId/memories` · `…/stats` | Fiches de mémoire, indicateurs |
| `GET` / `POST …/providers` · `PATCH` / `DELETE …/providers/:providerId` · `POST …/test` | Fournisseurs IA du serveur, test de connexion, état de santé |
| `GET` / `POST …/providers/:providerId/models` · `DELETE …/models/:modelId` | Catalogue des modèles du fournisseur, slugs ajoutés à la main |
| `GET /api/v1/guilds/:guildId/capabilities` · `PUT` / `DELETE …/capabilities/:capability` | Routes de capacités : modèle principal et de repli (`{ routes, followedBy }`) |
| `GET /api/v1/guilds/:guildId/integrations` · `PUT` / `POST …/test` / `DELETE …/integrations/:slug` | Services spécialisés (PixelLab) : activation, clé par serveur, test d'accès |
| `GET` / `POST …/webhooks` · `PATCH` / `DELETE …/webhooks/:webhookId` · `POST …/ping` | Connecteurs HTTP sortants et essai |
| `GET` / `PATCH /api/v1/guilds/:guildId/rules` | Règles du serveur (mêmes que l'outil `rules.set`) |
| `GET` / `PATCH /api/v1/guilds/:guildId/agent-settings` | Mode de raisonnement de l'agent du serveur |
| `GET /api/v1/guilds/:guildId/usage?window=24h\|7d\|30d` | Appels au modèle, jetons, erreurs, replis, par modèle et par jour |
| `POST …/agent/chat` · `GET …/agent/requests/:requestId` | Conversation avec l'agent depuis le panel, étapes de la demande |
| `GET /api/v1/guilds/:guildId/events` | Flux temps réel du serveur (SSE) |
| `GET /api/v1/meta/session` · `GET /api/v1/meta/modules` | Profil courant, catalogue des modules (session seule) |
| `GET /api/auth/*` | better-auth : login Discord, session |
| `GET /legal/terms` · `GET /legal/privacy` | Mentions légales, confidentialité |
| `GET /healthz` | Sonde du processus (clé `HTTP_API_KEY`) |
| `GET /*` | Panel compilé, quand `DASHBOARD_DIST_DIR` est réglé (déclaré en dernier) |

Convention live-edit : **toute écriture API passe par les mêmes services que la conversation Discord** (une seule implémentation, deux interfaces). Le dashboard n'est qu'un client de plus.

Aucune vue ne porte un secret : `{ hasApiKey, keyHint }`. Une clé vide lors d'une mise à jour conserve celle en place, `null` la retire.

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
Discord/Agent: config d'un module en langage naturel (enableModule/disableModule) - jamais de commande dédiée
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
conversation naturelle (« passe les logs dans #modération ») → tool agent config.*
→ GuildConfigService.patch(guildId, patch) → Zod safeParse (erreur → ValidationException avec champ/reason)
→ Prisma upsert → cache invalidé → réponse V2 ✅ (effet immédiat sur tous les modules)
```
### 7.3 Édition depuis le dashboard (livré)
```
PATCH /api/v1/guilds/:guildId/config → ApiPolicyMiddleware (origine admise) → SessionGuard → GuildAccessGuard
→ même GuildConfigService.patch que l'outil de l'agent, revalidation Zod intégrale, journalisée au nom du membre
→ 200 (le document) ; TanStack Query invalide ['guild', id, 'config'] → la page reflète
```
Même schéma pour tout le reste : règles (`rules`), fournisseurs et capacités, intégrations, connecteurs. Une écriture du panel ne fait jamais rien qu'une écriture de la conversation ne ferait pas.
### 7.4 Join du bot sur un nouveau serveur
```
GuildCreate listener → Prisma Guild upsert (settings = defaults Zod) → log boot
→ panel V2 de bienvenue + ingestion de l'historique (culture, ton, rôle des salons) en tâche de fond
```
### 7.5 Erreur
```
throw (SpraxiumException | HttpError | ZodError→ValidationException)
→ ExceptionHandler (Discord) : layout par classe → reply éphémère utilisateur
→ interne : Logger.error (DiscordTransport si configuré) ; jamais de stack côté user
```

## 8. Couche IA (moteur multi-fournisseurs)

```ts
// app.env.ts : lu UNE fois, pour remplir une base vide (import au démarrage), puis ignoré.
LLM_API_URL / LLM_API_KEY / LLM_MODEL / KIE_API_KEY / KIE_MODEL / PIXELLAB_API_KEY   // préfixes génériques, zéro vendor lock
LLM_EFFORT   // effort de raisonnement par défaut
```

- **Trois niveaux de configuration** ; un tour part du niveau le plus précis dont dispose le serveur.
  1. Instance, en base (table `IntegrationConfig`, une ligne par entrée du catalogue `llm` / `pixellab` / `kie`, clé chiffrée **AES-256-GCM**). L'environnement ne sert qu'à remplir une ligne manquante, une fois par processus (`IntegrationService.importFromEnv`, audit `instance.imported`) ; une ligne existante n'est jamais réécrite, et dès que la base connaît une intégration il est ignoré pour tout le catalogue. `LlmService` lit l'instance par `IntegrationService` seul.
  2. Instance, depuis Discord (modale owner ou admin → `LlmService.applyConfig` : contrôle de connexion, rechargement, persistance chiffrée, alignement des copies des serveurs).
  3. Serveur : fournisseurs et routes (tables `GuildProvider`, `CapabilityRoute`), par le panneau « Fournisseurs et modèles » ou en langage naturel (`provider.*`, `capability.*`). Les réglages par défaut de l'instance (`instance-defaults.ts`, plan pur dans `instance-defaults.plan.ts`) donnent à chaque serveur ses fournisseurs IA (celui de l'hôte de l'instance, et `kie-ai`) et leurs routes ; les identifiants de modèles viennent du catalogue de l'adaptateur, jamais codés en dur. Trois chemins appliquent le même plan : premier appel résolu d'un serveur (audit `provider.legacy_migrated`), démarrage et changement de l'instance (`reconcileInstance`). Les copies portent la marque `_source` et suivent l'instance ; un fournisseur ou une route créés par un administrateur ne sont jamais touchés.
- **Fournisseurs IA et intégrations** : un fournisseur est une API de modèles routée par capacité. Une intégration est une API spécialisée avec ses propres outils (PixelLab : `image.icon`, `image.emoji`), jamais une cible de route (clé du serveur sinon d'instance : `GuildIntegrationService`). La ligne « MOTEURS D'IMAGE de ce serveur » (`providers/image-engines.ts`) dit à l'agent ce qui est réellement disponible : pixel art vers PixelLab, tout autre rendu vers `generateImage`.
- **Familles de modèles** (`provider-model.kinds.ts`) : ce qu'un modèle sait faire, lu dans les métadonnées de `/models`, sinon dans son identifiant. Lier une capacité à un modèle du catalogue qui déclare ne pas la servir est refusé, avec ceux qui la servent.
- **Médias** : `generateImage` exécute la route `image.generate` du serveur (`runCapability`), quel que soit le protocole, télécharge par `safeFetch` et livre UNE pièce jointe ; la musique lit ses identifiants sur la route `music.generate`.
- **Contrat** (`shared/llm/chat-contract.ts`) : messages, tools, options (`reasoningEffort` et `preferReasoning` décidés UNE fois par requête), résultat (`served` : capacité, fournisseur, modèle, repli).
- **Adaptateurs** (`modules/providers/adapters/`, sans état, un par protocole) : `openai-chat`, `anthropic-messages`, `kie-unified`, `generic-http` (opérations REST décrites en gabarits `{{param}}`). Contrat `AbstractProviderAdapter` : `testConnection`, `discoverModels`, `execute`, `chat`. La clé ne ressort jamais (résultats, erreurs et journaux sont masqués).
- **Routage** (`CapabilityRouterService`) : route active d'une capacité, tentatives ordonnées (principal, puis repli), exécution avec bascule automatique, clé d'une capacité hors conversation (musique, images). Capacités natives : `chat.default`, `chat.reasoning`, `chat.ingestion`, `image.generate`, `image.edit`, `music.generate`, `tts.speak`, `video.generate`, `web.search` ; toute capacité `custom.*` est acceptée.
- **Client LLM** (`modules/assistant/`) : `LlmService` orchestre ; `ChatEndpointPlanner` décide où envoyer (la route du serveur, sinon l'instance) ; `ChatTransport` sert lui-même les protocoles à SSE (`chat/completions` : corps de requête, refus de `reasoning_effort`, watchdog d'inactivité) et passe les autres à leur adaptateur.
- **Silence en coulisse** (`modules/assistant/`) : de l'acceptation d'une demande à sa réponse, rien n'est publié dans le salon, sauf l'indicateur « écrit… » (`TypingIndicator` : `sendTyping` toutes les 8 s, tenu par la file dès l'acceptation, attente comprise, et par le worker, relâché dans un `finally`). Plus de ligne de statut, plus de brouillon progressif, plus d'outil d'annonce d'étape. `ReplySession` ne porte que le silence demandé et n'a pas accès au salon ; `AgentLoop` jette le texte d'un tour à appels d'outil ; `ReplyDelivery` est le seul à écrire la réponse, une fois, adressée à la demande. La progression des tools longs (`ctx.progress`) part dans le journal JSONL.
- **Bascule sur le repli** (`isFallbackWorthy`) : limite de débit (429), erreur serveur (5xx), panne réseau, délai, et seulement avant tout texte publié. Clé refusée ou crédit épuisé : jamais de bascule, c'est à l'administrateur de corriger.
- **Requêtes sortantes** : https et hôte public uniquement (`safeFetch`, `assertSafeUrl`). Un serveur de modèles local (Ollama, vLLM...) est refusé par conception (SSRF) : passer par une passerelle HTTPS publique. L'hôte est refusé sur sa forme et sur ce qu'il résout, à CHAQUE saut : les redirections sont suivies à la main (une adresse publique qui redirige vers le réseau interne passait la garde quand le runtime les suivait), et les en-têtes d'authentification ne suivent pas vers une autre origine. Les corps lus en entier sont plafonnés (`safeFetchText`, `safeFetchBytes`, `safeFetchJson` : 5 Mo par défaut, sur la longueur déclarée puis sur les octets reçus). Aucun `fetch` brut hors de `safeFetch`. Un flux RSS qui déclare un DOCTYPE ou une entité est refusé avant analyse (`webtools/xml-guard.ts`).
- **Champs réservés** : `user_id` ne part que vers DeepSeek (un endpoint OpenAI strict le refuse en 400) ; `reasoning_effort` seulement vers les endpoints qui l'acceptent, et plus du tout vers un hôte qui l'a refusé.
- Comptabilité : chaque tour dans `logs/llm.jsonl` (cause, capacité, fournisseur, modèle, repli, tokens, latence) ; `QuotaExhaustedError` typée pour les budgets.
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
| 4 | `GuildConfigService` (cache + patch + defaults) + tools agent `config.*` | toggle éditable en live, persist, testé |
| 5 | Extension `ModuleEnabledGuard` : per-guild + whitelists + cooldowns (+ tools agent modules) | matrice §6 testée |
| 6 | API : `defineHttp` + CORS + better-auth (middleware + Discord OAuth) + SessionGuard + GuildAccessGuard + endpoints §4.2 | flux auth complet OK en local (curl/dashboard dev) |
| 7 | Onboarding conversationnel (panel V2 + ingestion historique) + santé/diagnostic + i18n fr/en | agent opérationnel sans setup manuel |
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

Le guard bloque toute commande d'un module dont une dépendance est inactive (`ModuleDependencyException`). Conversationnel : l'agent liste la cascade et demande confirmation via une surface V2 (boutons).

## 13. i18n - langue par utilisateur (jamais par serveur)

Résolution : préférence explicite (conversation ou dashboard, `UserLocale.source = manual`) > **langue du client Discord** (auto-détectée si aucune préférence - `source = auto`) > défaut du bot. Persistance Prisma (`UserLocale`) + cache mémoire. Toute la chaîne (messages bot, exceptions, layouts, dashboard i18next) consomme la même résolution.

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

**État au 24/11/2026** : le pipeline de plans décrit ici avait été retiré le 17/11 au profit de l'exécution directe. Il revient sous une forme facultative, par la règle de serveur `confirmDestructiveActions` : les actions destructives d'une même demande sont regroupées derrière UNE approbation (points 2, 4, 7 et 10), et c'est le clic qui les exécute, après une revalidation déterministe sur le membre rechargé. Le modèle ne les exécute jamais lui-même. Implémentation : `modules/action-plan` ; étude du dépôt dont le mécanisme est tiré : `audit/07_BENCHMARK_DISCORD_AGENT.md`.

**Élargie le 24/11 au soir** : la règle, libellée « Confirmer les actions (hors lecture) » et toujours désactivée par défaut, vaut pour tout outil classé écriture (`TOOL_EFFECTS`, dans `packages/shared` : 79 outils, dont les 14 signalés destructifs), et plus seulement pour ceux-ci. Elle lie ce que le modèle propose en conversation : un clic sur une surface, une tâche du système et un plan approuvé portent leur autorisation. Chaque action est revue avant l'affichage (une action que le demandeur ne peut pas exécuter est écartée, et le panneau le dit), le modèle écrit un résumé affiché sur le panneau (600 caractères au plus, jamais lu pour exécuter), et le texte du panneau reste sous les 4 000 caractères de Discord.

**Squelette du system prompt (10 sections)** - `<IDENTITY>` (opérateur délégué, jamais d'insulte, déclin neutre) · `<TONE_AND_MESSAGING>` (registre, langue du demandeur, interdits) · `<SCOPE>` (allow/deny explicites ; demande mixte valide+invalide = rejet total expliqué) · `<SERVER_CONTEXT>` (snapshot hiérarchie/perms injecté au runtime - advisory) · `<TOOL_USE_GUIDANCE>` (read-before-write, préférer archive à delete, jamais d'IDs devinés) · `<CONFIRMATION_PROTOCOL>` (jamais d'exécution sans proposal ID approuvé par bouton ; un « oui » en chat ne compte pas) · `<DESTRUCTIVE_ACTION_POLICY>` (archive-first, masse interdit sans confirmation multi-étapes, irréversibilité énoncée dans l'embed) · `<POLICY_TRANSLATION_RULES>` (schémas AutoMod, décompositions, questions à poser si ambigu) · `<ERROR_HANDLING>` (auto-correction si fixable, jamais de retry aveugle sur un destructif) · `<AUDIT_AND_REPORTING>` (rapport avec noms+IDs, dire quelle gate a refusé sans leak de config).

Réfs : [Anthropic - Writing effective tools](https://www.anthropic.com/research/writing-tools-for-agents) · [Claude Agent SDK - Permissions](https://code.claude.com/docs/en/agent-sdk/permissions) · [OpenAI Agents SDK - Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/) · [LangGraph humanInTheLoopMiddleware](https://reference.langchain.com/javascript/langchain/index/humanInTheLoopMiddleware) · [cappyeo/discord-mcp](https://github.com/cappyeo/discord-mcp) (222 tools, preview-first, dry-run) · [KOBA789/human-in-the-loop](https://github.com/KOBA789/human-in-the-loop) (Discord comme canal d'approbation MCP) · [MCP Tools spec](https://modelcontextprotocol.io/docs/concepts/tools).

**Mémoire conversationnelle par canal** (pattern Discord-AI-Bot) : l'historique Discord est la mémoire - fetch des N derniers messages du canal, rendu `[Label (ID)] : contenu` avec préfixes inforgeables (contenu neutralisé), messages du bot = turns assistant. Pas d'état partagé entre canaux. Gate de triage : appel cheap model OUI/NON avant génération coûteuse (mention/DM bypass).

## 17. Realtime bot ↔ dashboard (livré : Server-Sent Events)

Bot et API vivent dans le même process (§1). Le temps réel tient en un flux par serveur : `GET /api/v1/guilds/:guildId/events` (SSE, gardé comme le reste).

- **Source** : `DashboardEventsService` s'abonne à `AuditService`. Chaque entrée d'audit d'un serveur devient, pour ce serveur seulement, un événement `{ type }` parmi cinq : `provider.updated`, `capability.updated`, `integration.updated`, `webhook.updated`, `rules.updated`.
- **Contrat volontairement pauvre** : un événement ne dit ni serveur, ni identifiant, ni contenu. Il sert à une seule chose, invalider les requêtes du serveur affiché ; le dashboard relit ensuite ce qu'il a le droit de lire. Rien de sensible ne transite.
- **Tenue du flux** : un commentaire `ping` toutes les 25 s (`SSE_PING_INTERVAL_MS`), abonnement posé avant l'écriture de l'ouverture, `Cache-Control: no-store`.
- **Étapes d'une demande de l'agent** : hors flux. Le panel envoie l'identifiant qu'il a choisi (`web-<uuid>`), l'agent consigne ses étapes dans `RequestProgressService` (en mémoire, borné), le panel relit `agent/requests/:requestId`.

Un WebSocket a été écarté : le besoin est unidirectionnel (le bot pousse, le panel relit), et SSE passe un proxy sans négociation. Migration Postgres : `LISTEN/NOTIFY` remplacerait le crochet sur l'audit sans changer le contrat des événements.

## 18. Jeux - trois couches de rendu

1. **Chat tour-par-tour** : limite ~5 msgs/5s/canal → boards rendus `@napi-rs/canvas` (Skia, zéro dep système, `imageSmoothingEnabled=false` pour le pixel net), contrôles boutons (`custom_id` typé), animations GIF via `gifenc`, assets CC0 Kenney/itch.io.
2. **Discord Activities** (seul vrai realtime) : Embedded App SDK, Hono sert OAuth token exchange + SPA + **serveur Colyseus** sur le même process ; URL Mappings portail (dev : cloudflared) ; lancement via callback `LAUNCH_ACTIVITY` (type 12) ; rooms Colyseus indexées par `instanceId` du SDK ; WebSockets only (pas de WebRTC derrière le proxy Discord).
3. Liaison modules : jeux = sous-modules de `games` ; récompenses economy/XP via deps optionnelles.

Réfs : discord/embedded-app-sdk (1.4k⭐) · colyseus/discord-activity · embedded-app-sdk-examples · poketwo · Gamecord.

## 19. Audit & error boundary

- **AuditService** (pattern wardhive) : `record(guildId, source, action, actor, target, metadata)` fire-and-forget - une erreur d'audit n'échoue jamais sur l'action ; **feed unifié** mergant les tables hétérogènes (audit, sanctions, logs messages, ops agentic, jeux) en timeline normalisée.
- **Coûts IA** (pattern Discord-AI-Bot) : table `model_usage` clé `cause` (reply | triage | admin-agent | game …), tokens + prix via API OpenRouter → page audit = « qui a fait quoi + ce que ça a coûté ».
- **Error boundary** : tout throw non géré → layout utilisateur (langue du user) + log structuré (Logger.error) + option salon d'incidents ; jamais de stack côté utilisateur.

## 20. Architecture POO (couche transverse)

Trois stéréotypes stricts, audités par `pnpm arch:audit` (règles : UI_IN_SERVICE, PERMISSION_DISPERSED, GOD_CLASS, ANY_TYPE, PROCESS_ENV - exit 1 si violation) :

- **Policy** (`src/core/security/access-policy.ts`) : `BaseAccessPolicy<TCtx>` abstraite (`isAuthorized(ctx)` + `assertAuthorized(ctx)` lève `ForbiddenDomainError`). `GuildAdminPolicy` = owner OU Administrator. **Uniquement** ici qu'un `PermissionFlagsBits` ou `guild.ownerId` peut apparaître - partout ailleurs le check est refusé par l'audit.
- **Presenter** (`modules/*/presenters/`) : classe pure qui reçoit une vue (data) et retourne un payload Discord Components V2. Zéro appel API, zéro effet de bord. Ex : `IntegrationStatusPresenter` rend le panneau « fournisseur connecté / non connecté » avec bouton admin conditionnel.
- **Handler** (`modules/*/handlers/`) : route une interaction Discord - garde Policy → erreur éphémère → délégation au service. Les handlers métier historiques (tickets, captcha, panels) sont remplacés par le **trio générique** `surface:act` / `surface:select` / `surface:modal` du moteur d'interactions.

Flux type : interaction → Policy (garde) → Service (logique + FileLog) → Presenter (rendu) → réponse V2 unique. Les services ne construisent jamais d'UI.

