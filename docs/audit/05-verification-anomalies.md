# Audit 05 · Vérification et anomalies

> État du 23/11/2026 en fin de journée, complété dans la nuit du 23 au 24/11 (arbitrages owner et incident de 20:09).

## 1. État de vérification

| Vérification | Résultat |
|---|---|
| `pnpm typecheck` | 0 erreur |
| `pnpm lint` | 0 erreur, mais aucun fichier TypeScript n'est réellement linté (voir `04` §3) |
| `pnpm test` | 231 tests : 211 dans le bot (23 fichiers) et 20 dans `packages/shared` |
| `pnpm build` | bundle complet (shared, bot, dashboard) |
| `pnpm check:modules` | dossiers de modules cohérents |
| `pnpm arch:audit` (strict) | **0 violation** (60 au soir : toutes remboursées) |
| `sync-tool-names --check` | OK, 163 tools, inchangés |
| CI `develop` | lint, modules, audit d'architecture, typecheck, test, build |
| grep des documents | 0 ancienne variable d'environnement, 0 référence de slash command |

## 2. Anomalie 1 : répétition de « An unexpected error occurred »

**Symptôme** (14:46, serveur de dev) : à chaque message, l'erreur générique du framework.

**Cause** (pile dans `logs/bot-2026-11-23.jsonl`, 14:46:11) : une instance du bot construite avant la purge tournait encore. Son `TicketFirstResponseListener` interrogeait `prisma.ticket.findFirst()` sur la table `tickets`, supprimée entre-temps.

**Correctifs** : processus arrêtés ; module absent du nouveau build ; try/catch global sur le listener de l'assistant ; filtre anti-bruit de la gate.

**Leçon** : arrêter tous les processus du bot avant de supprimer une table.

## 3. Dette d'architecture : remboursée (60 → 0)

Au soir, 60 violations étaient figées dans une baseline. Sur arbitrage du 23/11, elles ont toutes été traitées :

| Règle | Avant | Traitement |
|---|---|---|
| PERMISSION_DISPERSED | 38, plus 9 invisibles | Toutes migrées dans `src/core/security/` : `GuildAdminPolicy`, `GuildManagerPolicy`, `MemberPermissionPolicy`, `PermissionNamesPolicy` (listes de noms de `ToolRunContext`), `BotPermissionPolicy`, `AdminOpPolicy`. L'inventaire initial ne voyait que `PermissionFlagsBits` ; 9 autres sites lisaient ou comparaient des permissions (`.permissions.includes(`, `memberPermissions` des interactions, rôles, hiérarchie) et ont été migrés au passage. La règle d'audit les détecte désormais |
| GOD_CLASS (plus de 300 lignes) | 16 | Tous scindés, aucun fichier au-dessus du seuil. Convention : tools dans des factories `*.tools.ts`, logique pure dans son module, collaborateurs non injectables construits dans le constructeur du service, service orchestrateur |
| UI_IN_SERVICE | 4 | Presenters dédiés, payload Discord complet en sortie (drapeau `IsComponentsV2` compris) |
| PROCESS_ENV | 1 | `DISCORD_CLIENT_ID` déclaré dans `AppEnv` (il était lu hors schéma) |
| ANY_TYPE | 1 | Faux positif : un `(?:any` dans une regex de détection de silence. L'audit ignore maintenant les littéraux regex |
| LIFECYCLE_ON_MODULE | 0 | règle conservée, jamais contournable |

Contrôle du découpage : signatures des 92 classes gérées par injection identiques avant et après, 163 noms de tools identiques, 43 exports du paquet `shared` identiques à l'exécution, littéraux de chaînes comparés avant et après (seuls écarts : tirets cadratins remplacés), 4 requêtes SQL brutes de `activity.summary` identiques octet par octet.

## 4. Anomalie 2 : le résumé d'activité plantait

**Symptôme** : « Résume-moi les statistiques d'activité des 7 derniers jours » donnait « Le résumé SQL d'activité plante (erreur BigInt côté tool) », puis un contournement annonçant 9 messages.

**Trois défauts dans `activity.summary`** :
1. `MIN("createdAt")` renvoie un BigInt (epoch-ms), et `new Date(bigint)` lève une exception. Les DateTime sont stockés en epoch-ms entier.
2. `strftime('%Y-%m-%d', "createdAt")` renvoyait `NULL` : le regroupement par jour n'a jamais fonctionné, tous les messages tombaient dans un seul groupe « null ».
3. Le « top membres » venait d'un compteur cumulé depuis toujours, alors que le tool prétend résumer la fenêtre (9 au lieu de 7).

**Correctifs** : division par 1000 et modificateur `unixepoch` (jours en heure locale), conversion explicite, top calculé sur l'audit de la fenêtre, profondeur de données réelle exprimée en heures ou jours (`activity-coverage.ts`, 6 tests). Vérifié en live : 7 messages, 5 le 22/11 et 2 le 23/11, aucun join ni départ, 21 h de profondeur.

## 5. Anomalie 3 : la confirmation des actions destructives ne s'exécutait jamais

**Cause** : le framework n'instancie pas les classes de module. Trois modules (`ToolRegistryModule`, `GuildRulesModule`, `SurfaceModule`) portaient leur liaison runtime dans un constructeur ou un `onBoot` de module, code qui ne s'exécute jamais. Le registry sautait donc silencieusement le bloc de confirmation, faute de `rules`, `cache`, `prisma` et `renderSurface`.

**Preuve** : zéro ligne `rule.confirm.shown` dans l'audit sur toute la vie de la base, alors que le serveur `1095123126746099834` a `confirmDestructiveActions = true` et que des tools destructifs ont été appelés.

**Correctifs** : liaisons déplacées dans `ToolRegistryService.onBoot`, `GuildRulesService.onBoot` et `SurfaceService.onBoot`. Auto-diagnostic au démarrage. 7 tests unitaires (`tool-registry.confirm.spec.ts`) : blocage, passage après accord, accord lié à l'action exacte, règle désactivée, échec d'affichage qui laisse l'action bloquée, tool non destructif. Règle `LIFECYCLE_ON_MODULE` dans `arch-audit`.

**Non vérifié** : le clic sur ✅ exige une vraie interaction Discord. Le chemin est couvert par les tests unitaires, pas par un clic réel.

**Impact** : sur ce serveur, les actions destructives demandées à l'agent s'exécutaient sans la confirmation demandée. Sur les serveurs sans la règle, aucun changement.

## 6. Anomalie 4 : les rigs rapportaient des PASS sur des tools en échec

Les rigs ne vérifiaient que le NOM du tool appelé. Contrôle rétrospectif dans l'audit (chaque tool appelé par l'agent laisse une ligne avec `ok` et son motif) :

| Run | Appels de tools | En échec | PASS à tort |
|---|---|---|---|
| `e2e-gate` | sans objet (décisions de gate) | | aucun |
| `e2e-surface` | 2 | 0 | aucun |
| `e2e-features4` | 7 | 4 | `members.pickRandom` : 2 échecs, le contrôle ne testait pas le tirage |
| `tool-evals` | 17 (fenêtre chevauchant la suite) | 5 | `eval.activity-summary` : le tool avait échoué |
| `e2e-full-suite` | 95 | 18 | `server.overview` (les deux tools en échec), `config.panel` (outil en échec, fil créé par un appel qui avait planté avant de poster le panneau), `tickets.surface` (2 `surface.create` en échec, surface restée d'un run précédent) |

Le « 33/33 PASS » annoncé pour cette journée était donc surestimé : 5 de ces 33 résultats étaient des faux positifs. En outre le compteur de scénarios de la suite était faux (un `splice` retirait le verdict précédent).

**Correctifs** : les trois rigs exigent la réussite du tool attendu et affichent chaque échec dans la note. `config.panel` exige un fil privé et un panneau réellement posté. `tickets.surface` exige une surface créée pendant le scénario. `members.pickRandom` fait un vrai tirage. La suite compte ses scénarios correctement et en compte 11 (ajout de `rule.confirm`). Résultats après correction : voir `06_E2E_LIVE_REPORT.md`.

## 7. Anomalie 5 : le bouton « Connecter un fournisseur IA » ne répondait pas

**Cause** : les deux handlers d'intégration étaient des classes sans décorateur. Inscrits au démarrage, ils n'avaient aucune métadonnée de routage : ni le bouton ni la modale ne recevaient d'interaction. Un premier correctif ne faisait que les inscrire, sans les brancher.

**Second défaut** : la modale enregistrait la clé par `IntegrationService.upsert`, qui écrit la base sans recharger la configuration du LLM en mémoire. La nouvelle clé n'aurait servi qu'après redémarrage.

**Correctifs** : `@Button`, `@ModalComponent`, `@ButtonHandler`, `@ModalHandler` ; enregistrement par `LlmService.applyConfig` (contrôle de connexion, rechargement immédiat, persistance chiffrée) ; échecs de réponse journalisés. 9 tests (`integration.handlers.spec.ts`). **Le clic réel reste à faire à la main** : un rig ne peut pas produire cette interaction.

## 8. Anomalie 6 : le panneau de configuration était hors service

Conséquence directe de l'anomalie 3 : l'accesseur des règles n'était pas lié, donc `config.panel` et `server.overview` échouaient à chaque appel (« GuildRulesService non initialisé »), y compris lors d'essais manuels à 16:12 et 16:15. Corrigé par le même déplacement de liaison. Vérifié en live par le scénario `server.overview` de la suite.

Le panneau lui-même listait les 136 compétences de la bibliothèque (soit le catalogue des recettes) et doublait la ligne du fournisseur IA. Il montre désormais les compétences créées par le staff et les recettes effectivement utilisées par l'agent, plus un décompte de la bibliothèque.

## 8b. Anomalie 7 : apostrophes écrites `\u0029`

153 séquences `\u0029` (une parenthèse fermante) étaient utilisées à la place de `\u0027` (l'apostrophe) dans 26 fichiers : descriptions de tools, prompt système, triggers et workflows de recettes. Textes concernés : « Prochaine exécution d)un job », « Boutique d)articles ». L'erreur compile sans rien signaler. Une partie datait de sessions antérieures, le reste a été produit le 23/11.

**Correctif** : remplacement dans les 26 fichiers, vérifié par le nombre de parenthèses inchangé dans chaque fichier concerné.

**Effet de bord et seconde correction** : reformuler le trigger d'une recette fait créer une nouvelle ligne par le seed et purger l'ancienne. La recette du système AFK, ainsi purgée à 14:02 lorsque sa coquille est apparue, n'est pas revenue à 19:03 lorsque la coquille a été corrigée : le seed assimilait toute ligne supprimée à une suppression du staff. Le seed distingue désormais les deux (le staff supprime par le tool `deleteSkills`, qui laisse une trace d'audit). Vérification après redémarrage : voir `06_E2E_LIVE_REPORT.md` §7.

## 8c. Anomalie 8 : incident de 20:09 (fuite de balises internes, surfaces « probe », boutons sans effet)

**Symptômes rapportés** : du texte brut `<｜DSML｜ calls>` publié dans le salon, deux messages « probe », des boutons qui ne font rien au clic, un message « 🔧 Construction... » resté sans suite.

**Ce que disent les journaux** (`logs/bot-2026-11-23.jsonl`, `logs/llm.jsonl`, table d'audit, demande `req-co5jln9s`, 20:08:32 à 20:09:26) : le bot ne s'est pas bloqué et la boucle n'a pas planté. La demande se termine normalement et les suivantes passent.

1. **La fuite vient du dernier tour forcé.** Le modèle a dépensé ses 12 itérations (7 `search_tools`, 3 `surface.create` refusés pour schéma invalide). Au plafond, la boucle lançait un dernier appel avec `tool_choice: 'none'` : le modèle, au milieu d'un montage, a écrit ses appels d'outil en texte brut, publié tel quel.
2. **Les « probe » étaient volontaires.** Deux surfaces à `description: "probe"` (boutons A, B, C) : le modèle testait le moteur, parce que ses tentatives sérieuses étaient refusées et que les textes d'une surface ne savaient pas afficher l'état. Seul le titre était contrôlé.
3. **Les clics étaient reçus** (`surface.interaction ok=true` à 20:09:34, 20:09:37, 20:09:40, 20:09:42, puis 20:21:48 et 20:21:53). Sans effet visible pour deux raisons : les pipelines de sonde n'avaient rien de visible, et les handlers appelaient `deleteReply()` sans condition après le pipeline, donc **la réponse éphémère était effacée dès qu'elle apparaissait** (le bouton ✅ de confirmation était concerné aussi).
4. **Lacune du moteur** : les textes d'une surface n'interpolaient pas `{{state.x}}`, `setState.value` ne référençait pas le résultat d'une étape, aucune étape n'écrivait un JSON de LLM dans l'état. La recette blackjack n'était pas réalisable.

**Correctifs** :

- Effort de raisonnement décidé UNE fois par requête et identique sur tous ses tours (`llm-thinking.ts`, `ReasoningEffortPlanner`). Chez DeepSeek, omettre `reasoning_effort` laisse l'effort par défaut (`high`) : couper exige `none`, avec repli si l'endpoint le refuse.
- `LlmStreamSanitizer` : les jetons internes (`<｜`, `<|`, balises `<tool_call>`) sont coupés dans le client LLM et une seconde fois dans `ReplySession`, dernière barrière avant Discord. Un tour qui fuit est rejoué une fois, sinon la requête échoue avec une erreur typée et une notice.
- Dernier tour sans `tool_choice: 'none'` : le modèle est relancé par un message, tout appel d'outil est ignoré, et le message `ceilingMessage` dit honnêtement que la demande n'est pas terminée et comment la reprendre.
- Garantie anti-blocage : `AssistantService.converse` retire toujours la ligne de statut et le brouillon non finalisé dans un `finally`.
- Surfaces de sonde refusées avant toute création (titre ou description réduit à un mot de sonde), règle « jamais de surface de test » dans le prompt système.
- Handlers de surfaces réécrits : acquittement systématique, réponse éphémère Components V2 jamais supprimée, exceptions rattrapées et répondues.
- Moteur : état interpolé dans les textes au rendu, `setState.value` à référence typée, étape `llm` avec `saveTo` et `parseJson`.
- Itérations économisées : `openSkill` rend les tools de la recette appelables sans recherche, la description de `surface.create` donne la forme exacte de la définition et les champs de chaque étape, un `surfaceId` tronqué est accepté par préfixe unique.

**Preuve live** : voir `06_E2E_LIVE_REPORT.md` §10.

**Leçon** : le diagnostic collé au départ (bascule du thinking en cours de boucle, boucle bloquée, boutons orphelins) était en partie faux. Les journaux et l'audit donnent la vérité ; les corriger avant de coder.

## 9. Limites connues

1. **Blueprints et collections** : traité le 23/11 au soir. Le store `records.*` accepte désormais toute collection dynamique bien formée (`CollectionQuotaPolicy` : 50 collections et 10 000 enregistrements par serveur), vérifié en live par le scénario `records.dynamic`.
2. **Tirage aléatoire** : sans l'intent privilégié « Membres du serveur », `members.pickRandom` travaille sur les membres connus du bot (repli sur le cache, signalé dans le résultat).
3. **CI** : traité. Le workflow lance maintenant l'audit d'architecture strict et le build des trois workspaces.
4. **Sources du framework** : traité. `AGENTS.md` renvoie au paquet installé (`node_modules/@spraxium/core`, `@spraxium/components`) et à Context7, plus au dossier local disparu.
5. **Dérive Prisma** : deux migrations historiques ont été éditées après application, `prisma migrate dev` proposera un reset sur la base de dev. Poursuivre la méthode manuelle.
6. **Lint TypeScript inactif** : `pnpm lint` ne linte aucun `.ts` (voir `04` §3). À décider : accorder les règles puis activer.

## 10. Risques résiduels acceptés

- 25 modules, dont 23 non activables par serveur (catalogue minimal) : assumé, l'agent est le produit.
- `search_tools` expose le registre à la demande : les permissions restent vérifiées tool par tool.
- Ingestion de l'historique : coût LLM plafonné (20 appels par serveur), reprise après crash, filtres de vie privée en code.
