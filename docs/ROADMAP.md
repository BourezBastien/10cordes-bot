# 🗺️ Roadmap — 10cordes-bot

> Roadmap consolidée : périmètre produit + **analyse dédupliquée des 200+ suggestions validées de la communauté Crow Bots** (avril 2024 → novembre 2026). Chaque feature retenue cite sa demande communautaire (✅ = réactions de validation).
>
> **Fil rouge** : tout-en-un, 100 % slash commands, modules/sous-modules activables en live **avec dépendances**, **langue par utilisateur**, **registry d'outils (MCP interne)** consommé en chat, en vocal et via l'API.

---

## Principes

1. **Slash commands uniquement** — le pipeline prefix du framework n'est pas utilisé.
2. **Tout est module** — activable/désactivable en live (global + par serveur), avec **dépendances obligatoires** : désactiver `economy` désactive `shop` **sauf si `shop` est requis par un autre module actif** ; l'activation tire ses dépendances.
3. **Langue par utilisateur** — `/language` par user, auto-détectée du client Discord (`interaction.locale`), jamais imposée par le serveur.
4. **Live-edit** — tout se configure en commandes (`/config`, `/modules configure`, `/setup`), persisté en DB, effet immédiat.
5. **Feedback systématique** — réponses éphémères par défaut, exceptions typées avec messages personnalisables par serveur.
6. **Zéro paywall**, anti-aggro (pas de DM non sollicités, cooldowns raisonnables).
7. **ToolRegistry (MCP interne)** — chaque module expose des tools typés ; consommés par l'assistant **chat**, l'assistant **vocal** et plus tard un serveur MCP over HTTP.
8. **Components V2 par défaut** — tout rendu du bot (vues, confirmations, logs, réponses) utilise les composants natifs Discord (`Container`, `TextDisplay`, `Section`, `Separator`, `MediaGallery`, flag `IsComponentsV2`). Les embeds classiques deviennent l'exception. Dans le code, **aucun suffixe « v2 »** : le rendu de base EST ce système — les helpers se nomment naturellement (`ui.card()`, `ui.panel()`).

## ⚠️ Limites plateforme (verdicts)

- **Partage d'écran / Go Live par bot : impossible officiellement** (l'API bots ne fait que l'audio ; Go Live = client-only). Les contournements self-bot (ex: Discord-video-stream) violent les ToS → **rejeté**.
- **Enregistrement vocal de modération** : risque légal (consentement) → **rejeté**.
- **Ban pour suppressions manuelles massives** : faux positifs garantis → **rejeté** (couvert par anti-nuke).
- **Génération d'images IA** : demandée mais ❌ côté communauté → **dépriorisé**.

---

## Couche 0 — Fondations

| # | Fondation | Contenu | Priorité |
|---|---|---|---|
| 0.1 | **DB Prisma + SQLite** | `Guild.settings` (JSON typé Zod), `GuildModuleState` (état + contraintes par module/serveur), `UserLocale`. Switch Postgres = 1 var. | 🔴 P0 |
| 0.2 | **GuildConfigService** | Config par serveur JSON typé, cache mémoire invalidé à l'écriture, **export/import/transfer** (`/config export\|import`, Crow 14✅ + 12✅), **messages d'erreur personnalisables par serveur** (16✅). | 🔴 P0 |
| 0.3 | **ModuleManager per-guild + dépendances** | État par serveur, **graphe de dépendances** (cascade protégée à la désactivation, auto-enable à l'activation), **whitelists par module** (salons/rôles/users) — Crow valide : customs limitées à un salon (5✅), starboard whitelist salons (6✅), badwords par salon (4✅), salon dédié aux commandes staff (3✅/8✅). | 🔴 P0 |
| 0.4 | **Cooldowns & quotas** | Cooldown par module/commande configurable live ; **mod quotas par rôle** (26✅ : « limite de 3 mutes/h pour les modos »), bypass admin configurable. | 🔴 P0 |
| 0.5 | **i18n per-user** | `/language set` par user, auto-détection `interaction.locale`, store Prisma. Crow : langue par serveur (8✅), **langue par rôle/serveur multilingue** (5✅) → la préférence user prime toujours. | 🔴 P0 |
| 0.6 | **`/setup` wizard** | Config de base guidée en < 2 min (buttons/selects, `@spraxium/components`). | 🟠 P1 |
| 0.7 | **`/info` + santé** | Uptime, latences, version, modules actifs, stats DB ; rotation de présence (`PresenceManager`). | 🟠 P1 |
| 0.8 | **Logging applicatif** | `Logger` + `DiscordTransport` erreurs critiques, masking tokens. | 🟠 P1 |
| 0.9 | **TemplateEngine** | Moteur de variables `{{user}}`, `{{server}}`, `{{memberCount}}`, `{{inviter}}`, `{{timestamp}}`, `{{image}}`… réutilisé par welcome/customs/tickets/birthdays/levelup. Crow valide la demande massivement : variables help msg (8✅ + 11✅), {ServerPic}/{ServerBanner}/{MemberCountNoBots} (8✅), {Inviter_Code} (8✅), {Timestamp} (6✅), variables images (7✅), footer user mention (14✅). | 🔴 P0 |
| 0.10 | **ToolRegistry** | Contrat `BotTool { name, description, paramsSchema (Zod), handler, requiredModules }` ; exécution filtrée par modules actifs ; frontends : chat / vocal / MCP-HTTP (P3). Inventory complet §Tools. | 🟠 P1 (contrat P0) |
| 0.11 | **Audit logging + error boundary** | Logger global qui enregistre TOUT (actions, commandes, ops agentic, erreurs) ; table d'audit unifiée (acteur/action/cible/metadata — pattern wardhive, fire-and-forget) ; **page audit dashboard** + `/audit` commands ; **error boundary custom** : toute erreur → layout utilisateur (langue du user) + log structuré + option salon d'incidents. | 🟠 P1 |

## Couche 1 — Modules core

### 1.1 Welcome & Leave 👋
- Templates texte/embed via TemplateEngine, salon dédié, preview live `/welcome preview`
- **Carte d'accueil image** (avatar + pseudo, style Koya — 17✅) via `@napi-rs/canvas`
- **Suppression du message de bienvenue quand le membre quitte** (17✅, option)
- **Milestones membres** : message tous les N membres (18✅)
- Auto-role (humain/bot), DM de bienvenue (off par défaut)

### 1.2 Logging 📜
- Catégories avec salons séparés : messages (edit/delete), membres (join/leave/rôles/pseudo), **voice (join/leave/move + stream/cam 17✅, voicekick reclassé en voice-logs 15✅)**, modération, serveur
- **Filtres : rôles ignorés dans les logs de rôles** (17✅ + 9✅), rôles soutien séparés (17✅)
- **Alerte quand un log est supprimé** (15✅)
- **Tout désactiver d'un coup** (5✅), affichage des salons exclus (15✅)
- **Logs des messages supprimés lors d'un ban** (12✅, type `/clear`)

### 1.3 Modération ⚖️
- `/warn /warnings /timeout /kick /ban /unban /softban /purge /slowmode /derank /tempderank` (avec raison — 5✅/6✅)
- **Case system** : `/case <id>` avec détails ID/raison/date/modérateur (3✅), **`/baninfo` `/muteinfo`** (6✅/10✅), **liste serveur de toutes les sanctions** (6✅), **liste des warns du serveur** (14✅)
- **Mute = derank temporaire** : rôles retirés pendant le mute, restitués après (14✅ + 10✅)
- **Panel de sanction presets** : durées/raisons prédéfinies en boutons pour limiter les abus (12✅)
- **Sanctions limitées à un salon dédié** (12✅/3✅), **quota de modération par rôle** (26✅ → fondation 0.4)
- **Purge tous les messages d'un utilisateur** (11✅), blacklist de rôles (5✅), protection owner (lockname — 16✅)
- Tickets Blacklist de rôles per catégorie → voir Tickets (4.3)

### 1.4 Tags / commandes personnalisées 🏷️
- `/tag add|edit|delete|list`, embeds + **fichiers/images** (2✅), **plusieurs mots-clés** (16✅), **raison en variable** (9✅)
- **Limitation à un salon** (5✅), **rôles requis/interdits + users** (4✅), **modal form** (3✅), **rôle temporaire récompense** (10✅), **cooldown anti-spam**
- **Liaison commandes de modération dans menus/sélecteurs** (14✅)

### 1.5 Reminders & AFK ⏰
- `/remind` persisté en DB, restauré au boot (`@spraxium/schedule`) ; `/afk` avec réponse auto sur mention — Crow valide AFK (6✅)

### 1.6 Sticky messages 📌
- Message ré-envoyé après N messages, salon whitelisté

### 1.7 Utilitaires 🧰 (nouveau)
- **`/snipe` `/editsnipe`** (13✅/5✅) — dernier message supprimé/modifié par salon
- **`/find <user>`** — localisation vocale + micro/casque/stream (14✅ ×2)
- **`/lastseen <user>`** (16✅)
- **`/purgeuser`** (11✅), **massmove rôle → vocal** (9✅), `/rolemembers` avec IDs (8✅), `/resetalluser` pseudos (5✅)
- Fun (P3) : flip, qi, ratio, pick, 8ball (7✅)

### 1.8 Rôles : cycle de vie (nouveau — service partagé)
- **TempRoles persistés** : `/temprole` avec expiration, restaurés si quitte/revient (7✅), vendables dans le shop (2✅), attribués par custom/giveaway/anniversaire
- **Tempderank** : retirer tous les rôles X temps puis restitution (6✅)
- **Persistance des rôles après leave/rejoin** (19✅ — option par serveur, sous-ensemble ou total 19✅)
- **Backups de rôles** : snapshot/restore tous rôles ou un seul (5✅/8✅)

### 1.9 Anniversaires 🎂 (nouveau)
- Défini via profil/bouton (4✅), **message auto à heure/salon définis avec mention variable** (13✅ + 13✅), liste des anniversaires, rôle temporaire du jour (via 1.8)

## Couche 2 — Engagement

### 2.1 Reaction roles 🎭
- Rôles par réaction + **menus** (Carl-bot signature), modes unique/multiple, **confirmation éphémère au clic** (9✅), **plusieurs rôles par bouton** (2✅)
- **Rôle en rejoignant un salon vocal précis** (3✅/7✅), auto-rôles par activité (12✅)

### 2.2 Leveling 📈
- XP/message anti-flood, `/rank` carte, `/leaderboard`, récompenses rôles, annonces level-up **embed + message + image** (13✅/8✅/3✅)
- **XP drops** par réaction, salon/quantité/intervalle configurables (12✅), **multiplicateurs par rôle** (5✅), **horaires réduits** (nuit — 7✅), **decay inactifs** (4✅), reset par rôle (11✅), **stars msg/voc jour/semaine** avec N rôles et N gagnants (13✅/4✅)
- Rôles-récompenses **recommandés** (graphe `recommends`) : « des levels sans rôles ne servent à rien »

### 2.3 Starboard ⭐
- Seuil, salon, anti-self-star ; **whitelist salons source** (6✅), **tout emoji compte** (10✅), **image affichée en image** (19✅)

### 2.4 Giveaways 🎉
- Boutons, DB persistée ; **exigence vocale vérifiée périodiquement** (9✅), **démuté/sans casque** (8✅), **blacklist users** (10✅), **reroll partiel N** (5✅), gstart rapide (3✅), rôles multiples requis

### 2.5 Sondages 📊
- Buttons multi-choix, résultats live, durée ; **anti-poll automod** côté 3.4

### 2.6 Suggestions 💡 (nouveau)
- Salon/forums dédiés (3✅), votes ✅/❌, validation/rejet avec raison, **logs des suggestions** (6✅), **bouton modifier** (4✅)

### 2.7 Profiles 🪪 (nouveau)
- Description éditable par **boutons/modals** (5✅), anniversaire (→1.9), **rôles records personnalisés** (5✅)

### 2.8 Social feeds 📡 (nouveau)
- **Notifications Twitch/YouTube/TikTok** → rôle + salon (16✅), contrôle par streamer, `@spraxium/schedule` polling

### 2.9 Vouch / avis ⭐ (nouveau, P3)
- Avis 5 étoiles + commentaire + compteur + date (7✅/4✅)

### 2.10 Économie 💰 (P3 — validé garder en fin)
- Balance/daily/work/pay, **rob** (9✅), **prêts/dettes** (5✅), shop rôles & temproles (2✅), **taxes de team** (8✅), logs économie (9✅), **star richesse jour/semaine** (7✅)
- Dépendances : `shop`, `scoreboard` (leaderboard) dépendent d'`economy` — économie seule désactivable sans cascade inversée

## Couche 3 — Sécurité

### 3.1 Anti-raid 🛡️
- Pic de joins, comptes bots, lockdown, âge min de compte, whitelist faux-positifs
- **Portail multi-serveurs** : requiert l'appartenance au serveur principal sinon kick (9✅)

### 3.2 Anti-nuke ☢️
- Audit log (mass bans, suppressions en cascade, webhooks), whitelist admins de confiance, quarantaine, alertes

### 3.3 Vérification ✅
- Captcha → **attribution de rôle à la validation + retrait rôle non-vérifié** (2✅), âge min

### 3.4 AutoMod complémentaire (nouveau)
- **Anti-poll** (bloquer les sondages Discord natifs), **anti-link + allowlist de domaines** (4✅), **badwords + allow/deny par salon/catégorie** (4✅/4✅), **canal auto-embed anonyme/visible** (7✅), antirole avec exemptions menus (8✅)
- Complète l'AutoMod natif Discord (meilleure UX de config)

### 3.5 Channel scheduling ⏱️ (nouveau)
- **Ouverture/fermeture automatique à heures définies** (10✅), **autolock/autounlock durée** (13✅), autohide (13✅), salons exclus du renew (9✅)

### 3.6 Protection réseau (inspiré wardhive — P3)
- **Geolock** : règles par pays (ISO-2, mode block/flag), flow de vérification web pour les bloqués, file de review modo
- **Trust score cross-serveurs** (optionnel, exige réseau multi-guilds) : score 0-1000, poids de sanctions pondérés par autorité du serveur émetteur ; ingest idempotent via audit-log IDs
- **Backups de serveur** : snapshot structure (rôles/salons/permissions) avec restauration `merge|replicate` — sert aussi d'archivage à l'Agent Admin (§4.1.B)

## Couche 4 — Avancé

### 4.1 Assistant IA + Agent Admin 🤖 (nouveau — le cœur différenciant)

**A. Agent « assistant »** (chat + vocal, tools de tous les modules) :
- **ToolRegistry** (0.10) : tools filtrés par modules actifs du serveur
- **Chat** : mention / canal dédié / DM → hooks déterministes (patterns fr/en) → sinon LLM tool-calling (AI SDK + **OpenRouter**/OpenAI/Gemini/Ollama), budget/guild
- **Mémoire conversationnelle par canal** (pattern Discord-AI-Bot, à copier tel quel) : l'historique Discord EST la mémoire — fetch des N derniers messages, rendu `[Label (ID)] : contenu`, préfixes inforgeables (neutralisation des `[` `]` du contenu), messages du bot = turns assistant. Un autre salon = une autre conversation, sans état partagé.
- **Triage gate** (coût) : appel cheap model OUI/NON « dois-je répondre ? » avant la génération coûteuse (mention/DM = bypass direct)
- **Vocal** : `@discordjs/voice` + **Silero VAD** (ONNX) + STT (Deepgram streaming / Whisper) + TTS ; opt-in par serveur
- **MCP over HTTP** (P3) : le même registry exposé via `@spraxium/http`
- Utilitaires : **`/translate` (22✅)**, `/summarize`, chat GPT (15✅)

**B. Agent Admin — tout gérer Discord par langage naturel** (P2, flagship) :
- **Capacités** : créer / renommer / archiver / supprimer salons, catégories, rôles ; gérer les permission overwrites par canal ; construire un serveur sur mesure depuis une demande (« refais le serveur sur le thème de Noël » = plan multi-étapes) ; configurer des **politiques** en langage naturel → règles structurées : *« supprime tous les liens postés et averti l'utilisateur »* → automod rule Zod-typée avec salons/rôles ciblés.
- **Sécurité non négociable** (recherche 2026 : Anthropic / OpenAI Agents SDK / LangGraph / discord-mcp — détails ARCHITECTURE §16) :
  1. **Plan → confirmation humaine → exécution** : l'agent produit un **plan** (liste d'ops typées, diff avant/après) rendu en container ; UNE seule confirmation pour tout le plan batché ; exécution idempotente (clés) + readback de vérification.
  2. **Fail-closed** : mode écriture par défaut = preview ; ambiguïté = question de clarification ; **timeout = annulation** ; le clic sur le bouton re-vérifie les permissions du CLIQUEUR (pas du demandeur initial).
  3. **Archivage par défaut** : états `active | archived | trashed`, snapshot restaurable avant suppression ; hard-delete = action séparée jamais en cascade ; ops de masse interdites sans confirmation multi-étapes.
  4. **Destructif = owner + whitelist d'IDs Discord** (`admin_whitelist`) ; tout le reste = `ManageGuild`/`Administrator` ; **trois gates évalués en code** (demandeur / bot / config), le prompt ne fait qu'informer.
  5. **File d'actions typées** : union discriminée Zod → jobs idempotents → rapport par op → audit complet ; tools namespacés/consolidés avec erreurs actionnables.
  6. **System prompt 10 sections** (IDENTITY, TONE, SCOPE, SERVER_CONTEXT, TOOL_USE_GUIDANCE, CONFIRMATION_PROTOCOL, DESTRUCTIVE_ACTION_POLICY, POLICY_TRANSLATION_RULES, ERROR_HANDLING, AUDIT) — squelette complet en ARCHITECTURE §16.
- **Audit** : chaque op agentic → journal audit (acteur, action, cible, metadata, plan JSON, qui a confirmé) + table de coûts IA par cause.

**C. Games** (voir §4.8) et commandes utilitaires IA (`/translate`, `/summarize`) s'appuient sur le même socle.

### 4.2 Dashboard web (React, phase 2)
- Vite + React 19 + Tailwind 4 + shadcn/ui + Aceternity + TanStack Router/Query/Table + ApexCharts ; thème Tenkai (dark, sans ombres, radius .375–.75rem, IBM Plex Sans)
- **Auth Discord-only via better-auth** (Lucia déprécié) : liste des guilds gérables (ManageGuild), guilds où le bot absent → bouton **Setup** (OAuth scope `bot`), permissions affichées
- API REST `/api/v1` (`@spraxium/http`, CORS, better-auth en middleware, SessionGuard + GuildAccessGuard) — spéc complète dans ARCHITECTURE.md

### 4.3 Tickets & modmail 🎫 (P2 — la spéc Crow complète)
- Panneau custom (embed 12✅, **couleurs de boutons 14✅**, message hors embed 12✅), **threads ou salons** (3✅), **forms/modals** (✅), blacklist users (10✅) et rôles par catégorie (4✅)
- **Horaires d'ouverture** (boutons retirés hors créneaux — 14✅), auto-close inactivité (6✅), claim visuel sans lock (2✅), créateur ne peut pas fermer (11✅), `/add user|role` (13✅)
- **Transcripts HTML** (7✅), **étoiles modos 1–5 + stats** (12✅ + 13✅ leaderboard de claims), variables {MemberName}/{TicketStatus}/{TicketNumber} (3✅), modmail (boutons claim/close, préfixe, markdown — 7✅)

### 4.4 Voice avancé 🎙️ (nouveau, P2)
- **Salons vocaux temporaires** join-to-create + **panneau de gestion boutons** (12✅ : lock, rename, limite), rôle à l'entrée d'un vocal précis (3✅/7✅), logs des vocs temporaires (5✅)

### 4.5 Game servers 🎮 (P3)
- **FiveM/Minecraft/GMod status** : joueurs en ligne, salon statut auto, embeds status (8✅/2✅/9✅), status cfx.re

### 4.6 Invites tracking 📨 (P2/P3)
- Qui a invité qui, leaderboard, variable {Inviter_Code} (8✅)

### 4.7 Musique 🎵 (P4 — app séparée du monorepo)
- 17✅ mais lourde (LavaLink/ToS YouTube) — validé en fin de roadmap

### 4.8 Jeux réels 🎮 (nouveau — recherche 2026 complète)

Trois couches de rendu, du plus simple au plus immersif :

1. **Jeux tour-par-tour en chat** (composants + canvas) :
   - Contraintes Discord : reply ≤3s, webhook 15 min, **~5 msgs/5s par canal** → tour-par-tour seulement ; board rendu **`@napi-rs/canvas`** (Skia, zéro dep système) en pièce jointe, contrôles = boutons (`custom_id` typé `move:3:<playerId>`), carte de statut en container Components V2
   - Pixel-art : assets CC0 **Kenney / itch.io / OpenGameArt**, `imageSmoothingEnabled=false` pour le rendu net ; animations de victoire en **GIF (`gifenc`)**
   - Catalogue priorisé : **Word Duel** (Wordle 1v1 + IA) → **Classiques plateau avec IA minimax** (Morpion/Connect-4, ELO, skins) → **Pixel Battleship** → **Uno-style « 10cordes »** (2-4 joueurs + remplissage IA, flagship chat)
2. **Discord Activities (Embedded App SDK)** — seul vrai temps réel (iframe dans les vocaux) :
   - Le bot self-hosted sert son activity : Hono = OAuth token exchange + SPA statique + **serveur WS (Colyseus)** sur le même process ; URL Mappings dans le portail (dev : tunnel cloudflared) ; lancement via callback **`LAUNCH_ACTIVITY`** (type 12) depuis une slash command
   - Rooms Colyseus indexées par **`instanceId`** du SDK (tous les participants d'un vocal dans la même room) ; validation serveur via API activity-instances
   - Flagship : **Draw & Guess** (Sketch Heads-like, PixiJS, 3-8 joueurs) — les jeux chat ci-dessus gagnent un upgrade vocal gratuit
3. **Liaison modules** : chaque jeu = sous-module du module `games` ; récompenses economy/XP si ces modules sont actifs (deps optionnelles), ELO et classements persistés

Références : discord/embedded-app-sdk (1.4k⭐) · colyseus/discord-activity (template PixiJS) · utarwyn/discord-tictactoe · aniket091/Gamecord · poketwo (jeu chat à l'échelle)

---

## 🔌 Backlog d'intégrations communautaires (recherche 2026 — demandes réelles × gap open-source × fit local-first)

Classé par intérêt pour notre stack auto-hébergée (tout est faisable sans service cloud propriétaire) :

| # | Module | Pourquoi | Références OSS |
|---|---|---|---|
| 1 | **Assistant LLM local + FAQ RAG** | Flagship self-hosted : indexer wiki/pins du serveur, répondre avec citations via **Ollama** — personne ne le fait bien en local (llmcord 843⭐ est cloud-API) | llmcord · discord-ollama · Ollama (187k⭐) |
| 2 | **Feeds hub** (RSS/YouTube/GitHub releases/blogs) | Demande evergreen ; MonitoRSS (1.3k⭐) trop lourd à self-host (Redis multi-services) — un module Node léger gagne | MonitoRSS · FeedCord · `releases.atom` natif GitHub |
| 3 | **Bridge monitoring** (Uptime-Kuma 94k⭐ / Gatus) | Webhook sortant = one-way ; gap total en bidirectionnel : `/status`, `/incidents ack`, routing par rôle — public homelab exactement le nôtre | uptime-kuma · gatus (12.8k⭐) |
| 4 | **Anti-phishing** | Bases Phisherman / SinkingYachts (APIs gratuites) + snapshot locale nikolaischunk (22k domains) ; scan-on-message + quarantaine | phisherman.gg · phish.sinking.yachts |
| 5 | **Tickets + modmail** | Top-5 de toute bot-list ; discord-tickets (1.5k⭐) standalone → le nôtre = un module de l'all-in-one | discord-tickets · open-ticket (427⭐) |
| 6 | **Events / LFG / scheduling** | Duopole fermé Apollo+Sesh ; pain réel = timezones ; OSS quasi vide | Sidekick · GroupUp |
| 7 | **Bridge dev platforms** (GitHub/Gitea/Forgejo + CI) | Webhooks natifs insuffisants : `/issue search`, `/ci latest`, pins par canal, release notes résumées par IA | Gitea (59k⭐) |
| 8 | **Traduction via LibreTranslate self-hosted** | Flag-react ou `/translate` vers NOTRE instance (zéro clé Google) — cohérent avec i18n per-user | LibreTranslate (17.7k⭐) |
| 9 | **Suite média (Jellyfin/*arr/Jellyseerr)** | `/request`, « now streaming », pings par user ; buzz JellyCorrd (r/selfhosted) = appétit frais | Jellyfin (59k⭐) |
| 10 | **Anti-nuke + gateway de vérification web** | Les bots ne voient pas les IPs → alt/VPN/geo-lock = **OAuth gate sur notre serveur HTTP** (voir wardhive geolock) — différenciant vs Wick/Double Counter fermés | Raid-Protect (250⭐, dormant) |
| 11 | **Gacha/collection engine** | Mudae 3.37M serveurs ; OSS vide — moteur à collections branchables (communautés = leurs propres pools) + récompenses economy (deps optionnelles) | fable (49⭐) |
| 12 | **Analytics serveur local-only** | Statbot fermé/payant, OSS = vide TOTAL ; analytics privacy-respecting sur notre SQLite = uncontested | — |
| 13 | **Bump/discovery fédéré** | Disboard fermé ; protocole `/bump` ouvert + annuaire opt-in entre instances self-hosted | — (network effect : opt-in) |
| 14 | **Song-ID vocal** (Shazam-compatible) | « C'est quoi ce son ? » en vocal : capture clip → fingerprint (SongRec/ShazamIO) — aucun bot poli | SongRec (2.1k⭐) |
| 15 | **Bundle utilitaires** : météo (Open-Meteo), `/speedtest` (LibreSpeed), expander de liens, lookup IP/geo | Staples peu différenciants mais ronds-out l'all-in-one | librespeed (15.3k⭐) |

**Wildcards (projets non-Discord, effet « wow » local-first)** :
- **W1 · ntfy bridge bidirectionnel** (35.5k⭐) : salons Discord ↔ topics ntfy — alertes homelab sur mobile, push CLI → Discord. Concurrence nulle.
- **W2 · Bulletin ISP hebdo** : Speedtest-Tracker (6.1k⭐) + LibreSpeed → embed hebdo vitesse/latence avec graphs. Aucun bot ne le fait.
- **W3 · Home Assistant commands** (92.3k⭐) : `/ha status`, `/ha lights off`, événements de présence → salon serveur. S'appuie sur la plomberie W1.

Verdict crypto/web3 : déclinant hors serveurs trading → ticker de prix optionnel P4 seulement, pas core.

---

## 🕸️ Graphe de dépendances (principe)

```
economy ──► shop ──► (temproles vendables)
   └──────► scoreboard (leaderboard)
levels ──•► role-rewards (recommandé, pas obligatoire)
tickets ──► modmail
economy/shop ──•► temproles (service partagé, activable seul)
birthdays ──•► temproles (rôle du jour)
assistant ──•► (tous les modules actifs fournissent leurs tools)
```
- Désactivation d'un module → cascade calculée sur le graphe inverse ; un sous-module **survit** s'il est requis par un autre module actif ; confirmation obligatoire listant la cascade.
- Activation → tire les dépendances obligatoires + **suggère** les `recommends`.

## 🧰 Inventory des tools (ToolRegistry, cible 200–300)

~128 tools initiaux nommés dans `docs/TOOLS.md` (créé à l'implémentation de 0.10) :
- **musique** (15) : play, search, queue, skip, previous, pause, resume, stop, volume, loop, shuffle, nowplaying, lyrics, addplaylist, remove
- **channels** (16) : list, getByName, getById, create, delete, rename, setTopic, setSlowmode, lock, unlock, hide, unhide, move, clone, setNsfw, setCategory
- **roles** (12) : list, getByName, getById, create, delete, rename, setColor, add, remove, setHoist, setMentionable, members
- **moderation** (16) : warn, warnings, timeout, untimeout, kick, ban, unban, softban, purge, purgeUser, slowmode, lockname, derank, tempderank, case, cases
- **members** (9) : get, search, count, setNickname, moveVoice, disconnect, inVoice, findVoice, lastSeen
- **messages** (9) : send, edit, delete, purge, snipe, editSnipe, read, react, search
- **voice** (5) : join, leave, speak, stopSpeaking, usersInChannel
- **config** (11) : get, set, export, import, reset, modules.list/enable/disable/status, language.get/set
- **server** (9) : info, icon, banner, rolesCount, channelsCount, boosts, createdAt, emojisList, invitesList
- **economy** (10, P3) : balance, daily, work, pay, leaderboard, shopList, shopBuy, inventory, rob, loan
- **levels** (4) : rank, leaderboard, give, reset · **giveaways** (4) : start, list, end, reroll · **tickets** (2) : stats, list · **fun** (6) : flip, roll, pick, qi, ratio, eightball

---

## Ordre de build

```
P0 (cette phase)  DB → GuildConfig (+transfer) → ModuleManager (deps+whitelists) → cooldowns/quotas → i18n per-user → TemplateEngine → ToolRegistry (contrat)
P1  Welcome/Leave (+carte, milestones) → Logging (voice/filtres) → Modération (cases, quotas, mute-derank, panels) → Tags/Customs → /setup → /info
P2  Tickets/Modmail → Reaction roles → Leveling → Assistant (chat + vocal + tools) → Suggestions → Feeds → Voice (temp voc) → Invites → Anti-raid/nuke → AutoMod → Rôles lifecycle → Birthdays
P3  Économie → Game servers → Dashboard complet → MCP over HTTP → Vouch → Utilitaires fun
P4  Musique (app séparée)
```

## Détails d'architecture

Voir [ARCHITECTURE.md](./ARCHITECTURE.md) — monorepo, Prisma, schémas Zod, API v1, better-auth, graphe de dépendances, TemplateEngine, ToolRegistry, limites plateforme.
