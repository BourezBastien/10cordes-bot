# Audit 02 — Bot core & moteur

## 1. Bootstrap (`main.ts`)

`SpraxiumFactory` unique : validation env (`AppEnv` Zod) → create → `useModule(AppModule)` → `provide(AppEnv)` → `listen()` → **purge du registre de slash commands Discord** (le produit est 100 % conversationnel : aucun `/xxx` ne doit survivre).

`app.module.ts` : 24 modules importés (tickets/roles/levels/invites/welcome retirés en C1). `@HttpClientModule` sur LA MÊME classe (règle framework : un second module HTTP serait ignoré).

## 2. Assistant (le cœur)

| Composant | Fichier | Points clés |
|---|---|---|
| Gate | `listeners/assistant-mention.listener.ts` | Chaîne courte zéro-LLM ; try/catch global ; anti-bruit social ; zone-libre false par défaut |
| Queue | `assistant.queue.ts` + `queue/` | Driver BullMQ (Redis) / memory fallback (sonde 5 s, bascule à chaud avec ré-enregistrement du handler) ; FIFO par user, 3 parallèles, caps 10/user et 200 total |
| Boucle | `agent-loop.service.ts` | Template Method partagé Discord/web ; 12 itérations max ; synthèse finale sans tools si boucle épuisée |
| Prompt | `system-prompt.builder.ts` | XML par sections (`<SERVER_RULES>`, `<SKILLS>`, ...) ; préfixe statique pour le cache provider DeepSeek |
| Streaming | `llm.service.ts` | SSE + watchdog inactivité ; `reasoning_effort` conditionnel ; erreurs typées (QuotaExhausted, ProviderAuth, ProviderUnavailable) |
| Rendu | `progressive-responder.ts` | Édition unique throttlée 1,8 s ; médias = UNE pièce jointe réelle (jamais d'URL dans progression/summary) |
| Reprise | `boot-recovery.service.ts` | Watermark par salon dédié + relance des jobs persistés |

## 3. Moteur de surfaces (`modules/surface/`)

- `surface.service.ts` : CRUD surfaces + re-rendu ; 6 tools (`surface.create/patchState/updateComponent/get` + triggers).
- `surface.handlers.ts` : le trio générique — `SurfaceActHandler` (boutons), `SurfaceSelectHandler`, `SurfaceModalHandler`. **Ce sont les seuls handlers d'interaction métier du bot.**
- `surface.pipeline.ts` : exécuteur de pipeline typé (14 kinds de steps) ; `claimOnce` = SET NX (course concurrentielle sûre).
- Triggers : `ScheduledTrigger` BullMQ + catchup au boot (testé par rig `e2e-surface` avec reboot en cours de timer) ; `EventTrigger` route 10 événements Discord.

### Anti-régressions notables (fixés, vérifiés en code)
- R0.3 : surfaces coquille-vide refusées (titre/labels réels exigés).
- Probe/ping : le placeholder ne passe plus la validation.
- `captureSnipe` : null-guard sur `message.author` (messages partiels après restart).

## 4. Règles serveur (`modules/rules/`)

`GuildRulesService` : store DB + cache 60 s ; consommé par la Gate (zones/blocked), le ToolRegistry (confirmation destructive ✅/❌) et le SystemPrompt (`<SERVER_RULES>`). Tools `rules.set` (ManageGuild, résolution des IDs via getChannels imposée) / `rules.list`.

## 5. Intégrations chiffrées (`modules/integrations/`)

`IntegrationService` (catalogue llm/pixellab/kie) + `secret-box.ts` AES-256-GCM (clé dérivée `ENCRYPTION_SECRET ?? BETTER_AUTH_SECRET ?? token`). Flux UI : `IntegrationStatusPresenter` (panneau V2 pur) → bouton `integration:llm:open` → `IntegrationOpenModalButtonHandler` (garde `GuildAdminPolicy`) → modale 3 champs → `IntegrationSaveModalHandler` → confirmation. La config DB prime sur le bootstrap env.

## 6. Ingestion (Phase B, `modules/memory/`)

Voir 00 §5. Découpage : service (263 l.) / distiller (82 l.) / tools (61 l.) / listener (36 l.) — tous sous le seuil God Class.

## 7. Memory & curator

Fiches consolidées ≤2 000 car. avec gardes en code : budget, anti-wipe (réduction >50 % refusée au-delà de 200 car.), sujet (la fiche membre référence `<@userId>`), zone de données anti-injection. Opt-out total (« oublie-moi ») → purge + blocage futur.
