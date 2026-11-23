# Audit 05 · Vérification et anomalies

> État du 23/11/2026 en fin de journée.

## 1. État de vérification

| Vérification | Résultat |
|---|---|
| `pnpm typecheck` | 0 erreur |
| `pnpm lint` | 0 erreur |
| `pnpm test` | 55 tests : 35 dans le bot (5 fichiers) et 20 dans `packages/shared` |
| `pnpm build` | bundle complet |
| `pnpm check:modules` | 25 dossiers cohérents |
| `pnpm arch:audit` (strict) | 60 violations, toutes figurant dans la baseline de dette |
| `pnpm arch:audit:ratchet` | aucune violation nouvelle |
| CI `develop` | verte (lint, modules, typecheck, test) |
| grep des documents | 0 ancienne variable d'environnement, 0 référence de slash command |

## 2. Anomalie 1 : répétition de « An unexpected error occurred »

**Symptôme** (14:46, serveur de dev) : à chaque message, l'erreur générique du framework.

**Cause** (pile dans `logs/bot-2026-11-23.jsonl`, 14:46:11) : une instance du bot construite avant la purge tournait encore. Son `TicketFirstResponseListener` interrogeait `prisma.ticket.findFirst()` sur la table `tickets`, supprimée entre-temps.

**Correctifs** : processus arrêtés ; module absent du nouveau build ; try/catch global sur le listener de l'assistant ; filtre anti-bruit de la gate.

**Leçon** : arrêter tous les processus du bot avant de supprimer une table.

## 3. Dette d'architecture (60 violations)

| Règle | Nombre | Où |
|---|---|---|
| PERMISSION_DISPERSED | 38 | `agent.service.ts` (11), `agent/tools/*`, `guild-access.guard.ts`, `surface.pipeline.ts`, modules Discord historiques |
| GOD_CLASS (plus de 300 lignes) | 16 | `assistant.service.ts` (930), `serverlife.service.ts` (environ 800), `discord.tools.extra.ts` (762), `llm.service.ts` (551), `surface.pipeline.ts` (477), `discord.tools.ts` (446), `moderation.service.ts`, `skill.service.ts`, `jobs.service.ts`, `automations.service.ts`, et 6 autres |
| UI_IN_SERVICE | 4 | `assistant.service.ts` (2), `logging.service.ts`, `surface.service.ts` |
| PROCESS_ENV | 1 | `auth.instance.ts` |
| ANY_TYPE | 1 | `assistant.service.ts` |
| LIFECYCLE_ON_MODULE | 0 | règle ajoutée le 23/11, ne peut pas entrer dans la baseline |

Le plan approuvé demandait un audit d'architecture vert. Il ne l'est pas : la dette a baissé de 81 à 60, sans aller jusqu'au bout. Cette dette est figée dans `apps/bot/scripts/arch-audit.baseline.json`. `pnpm verify` échoue désormais sur toute violation nouvelle. Pour la rembourser : scinder les 16 fichiers trop longs, faire passer les 38 contrôles de permission par des policies, extraire les 4 presenters manquants.

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

## 9. Limites connues

1. **Blueprints et collections** : les workflows des 135 recettes citent des collections (`casino_balance`, `giveaway_entries`, `streaks`...) que le registre fermé de `records.*` refuse. Seuls les noms de tools sont vérifiés à la compilation. À trancher : registre extensible par blueprint avec vérification, ou rédaction des workflows sur les collections existantes.
2. **Tirage aléatoire** : sans l'intent privilégié « Membres du serveur », `members.pickRandom` travaille sur les membres connus du bot (repli sur le cache, signalé dans le résultat).
3. **CI** : le workflow ne lance ni `build` ni l'audit d'architecture. Le cliquet (`arch:audit:ratchet`) n'est pas exécuté sur les pushes.
4. **Sources du framework** : le dossier référencé dans `AGENTS.md` n'existe plus sur la machine. Les vérifications s'appuient sur le paquet installé.
5. **Dérive Prisma** : deux migrations historiques ont été éditées après application, `prisma migrate dev` proposera un reset sur la base de dev. Poursuivre la méthode manuelle.

## 10. Risques résiduels acceptés

- 25 modules, dont 23 non activables par serveur (catalogue minimal) : assumé, l'agent est le produit.
- `search_tools` expose le registre à la demande : les permissions restent vérifiées tool par tool.
- Ingestion de l'historique : coût LLM plafonné (20 appels par serveur), reprise après crash, filtres de vie privée en code.
