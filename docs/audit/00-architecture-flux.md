# Audit 00 · Architecture & flux

> Audit du 23/11/2026 en fin de journée, après les phases A (POO), B (ingestion), C (purge et 135 skills), D (docs) et les corrections du soir. Toutes les métriques sont mesurées sur le code.

## 1. Vue d'ensemble

| Métrique | Valeur |
|---|---|
| Fichiers TS hors tests (`apps/bot/src`) | 136, environ 18 700 lignes |
| Fichiers de test unitaire | 5 (35 tests), plus 20 dans `packages/shared` |
| Fichiers TS (`packages/shared/src`) | 13 (1 187 lignes) |
| Modules Spraxium (`src/modules/`) | 25 |
| Handlers d'interaction décorés | 5 : le trio `surface:act`, `surface:select`, `surface:modal` et les 2 d'intégration (bouton et modale) |
| Fichiers de listeners | 10 |
| Tools du registry | 163 |
| SkillBlueprint | 135 (10 domaines) |
| Modèles Prisma | 33 |
| Migrations | 30 |
| Violations arch-audit | 60, toutes dans la baseline de dette acceptée (voir 04 §3) |

## 2. Flux conversationnel

```
Message Discord
→ AssistantMentionListener.onMessageCreate
   [try/catch global : log FileLog avec la pile, rien ne remonte
    vers le handler générique du framework]
   1. Source : webhooks des rigs auto-reconnus (E2E) ; autres bots et webhooks ignorés
   2. Mention d'un autre bot et pas du nôtre → silence
   3. blockedChannelIds (GuildRule) → muet, même si mentionné
   4. Salon dédié ou zone libre (freeCategoryIds / freeChannelIds)
   5. Interpellation : dédié = tout ; sinon mention ou réponse toujours ;
      nom en texte brut UNIQUEMENT en zone libre (strictMentionElsewhere, vrai par défaut)
   6. ANTI-BRUIT : sans mention, ni nom, ni réponse, les rires et les messages
      de moins de 3 mots sans question sont ignorés, zéro appel LLM
→ AssistantQueue (FIFO par utilisateur, 3 parallèles, BullMQ ou mémoire)
→ AgentLoop (12 itérations maximum, synthèse finale garantie)
→ LlmService.chat (streaming SSE, watchdog d'inactivité, thinking adaptatif)
→ ToolRegistryService.run, pour chaque tool :
     modules requis actifs → node deny → permissions Discord → validation Zod
     → CONFIRMATION destructive si la règle du serveur l'exige → handler → audit
→ DiscordProgressiveResponder (édition unique, throttlée à 1,8 s)
→ FileLog JSONL + audit en base + comptabilité llm.jsonl
```

Garanties vérifiées :
- Zone libre à `false` par défaut sans règle enregistrée (`DEFAULT_RULES.freeCategoryIds` est vide).
- Un crash de listener ne produit plus le message anglais du framework (try/catch global, confirmé par le log du zombie de 12:22).
- La confirmation destructive est opérationnelle : le démarrage affiche « confirmation destructive opérationnelle » quand `rules`, `cache`, `prisma` et le rendu sont liés, et un avertissement explicite sinon.

## 3. Couche POO

| Stéréotype | Emplacement | Rôle |
|---|---|---|
| Policy | `src/core/security/access-policy.ts` | `BaseAccessPolicy<TCtx>` abstraite + `GuildAdminPolicy` (owner ou Administrator). Seul endroit autorisé pour `PermissionFlagsBits` et `guild.ownerId` |
| Presenter | `modules/*/presenters/` | Données vers payload Components V2, sans effet de bord (`IntegrationStatusPresenter`, `ConfigPanelPresenter`) |
| Handler | `modules/*/handlers/` | Garde Policy, message d'erreur, délégation au service. Décorateurs `@spraxium/components` obligatoires |

`pnpm arch:audit` applique 6 règles : UI_IN_SERVICE, PERMISSION_DISPERSED, GOD_CLASS (plus de 300 lignes), ANY_TYPE, PROCESS_ENV, LIFECYCLE_ON_MODULE. Il reste 60 violations de dette historique. Elles sont figées dans une baseline : `pnpm verify` échoue sur toute violation nouvelle, et la règle LIFECYCLE_ON_MODULE ne peut pas entrer dans la baseline (voir 04 §3 et 05 §3).

## 4. Règle de cycle de vie du framework

Le framework n'instancie pas les classes de module. Il n'enregistre que les `providers`, `listeners` et `handlers`. Tout `onBoot` ou constructeur écrit dans une classe `@Module` ne s'exécute jamais. Trois modules portaient ce motif, dont la liaison des règles de confirmation destructive (voir 05 §5).

## 5. Moteur générique

- `InteractiveSurface` : définition et état JSON persistés, re-rendu à chaque mutation, survit aux redémarrages.
- `InteractionBinding` : politique d'accès et pipeline typé (runTool, setState, updateComponent, sendMessage, replyEphemeral, openModal, record.write, trigger.schedule, trigger.cancelByKey, random, llm, if, forEach, claimOnce).
- `ScheduledTrigger` : BullMQ, tick de 15 s, rattrapage garanti après redémarrage, sans fenêtre de grâce.
- `EventTrigger` : 10 événements Discord (message create, update, delete ; member join, leave, update ; voice ; reaction add, remove ; présence).
- Refus des surfaces vides : titre de moins de 3 caractères ou labels de type probe, test, ping.

Conséquence de la purge : tickets, captcha, panels, rôles, accueil, niveaux et invitations n'existent plus comme code. Ce sont des recettes composées de primitives. Au démarrage, seuls les trois handlers de surface et les deux d'intégration sont enregistrés.

## 6. Ingestion de l'historique

`GuildHistoryIngestionService` : à l'arrivée du bot sur un serveur (join frais uniquement, les rejeux de connexion sont ignorés), tâche de fond, pagination de 100 messages avec backoff sur les erreurs 429, filtres de vie privée (bots, webhooks, membres ayant demandé l'oubli, extraits de 300 caractères), lots de 200 messages, distillation LLM (`cause: 'memory.ingestion'`), fiche `GuildMemoryProfile` plafonnée à 2 000 caractères et journal `GuildMemory`. Curseur par salon pour la reprise après crash. Plafonds : 40 salons, 600 messages par salon, 20 appels LLM. Tools `guild.ingestHistory` (ManageGuild) et `guild.ingestStatus`.

## 7. Points d'attention

1. Dette d'architecture : 60 violations, dont 16 fichiers de plus de 300 lignes et 38 contrôles de permission hors des policies (voir 05 §3).
2. Les blueprints citent des collections que le registre `records.*` ne connaît pas (voir 01 §3).
3. `GuildHistoryIngestionService.trigger()` exige un fournisseur LLM configuré.
