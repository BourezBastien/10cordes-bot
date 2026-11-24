# Audit 06 · Rapport E2E live

> Serveur de dev `1550835980116824136`, journée du 23/11/2026. Heures locales (UTC+1).
> Journal forensique de la suite : `apps/bot/logs/e2e-suite-1550835980116824136.jsonl` (append-only, un `runId` par exécution).

## 1. Le rapport précédent était surestimé

La première version de ce rapport annonçait « 33/33 PASS » (suite 10, gate 5, surface 4, features4 6, evals 8). Les rigs ne vérifiaient alors que le NOM du tool appelé. Un contrôle rétrospectif dans l'audit montre que 5 de ces 33 résultats masquaient des tools en échec :

| Résultat annoncé | Réalité dans l'audit |
|---|---|
| `eval.activity-summary` PASS | `activity.summary` avait planté (BigInt) |
| `members.pickRandom` PASS | 2 appels, 2 échecs ; le contrôle ne testait pas le tirage |
| `server.overview` PASS | `server.overview` et `config.panel` en échec à chaque appel |
| `config.panel` PASS | tool en échec ; le fil existed, créé par un appel qui avait planté avant de poster le panneau |
| `tickets.surface` PASS | 2 `surface.create` en échec ; la surface vérifiée datait d'un run précédent |

Le compteur de la suite était également faux (un `splice` retirait le verdict du scénario précédent). Les rigs sont désormais stricts (voir §2). Ce rapport remplace le précédent.

## 2. Critère de réussite

Un tool attendu ne compte que s'il a réussi : ligne d'audit `assistant.tool.<nom>` avec `ok: true`. Chaque échec de tool reste affiché dans la note du scénario, même quand le scénario passe (échec récupéré après correction par le modèle). Un scénario prouve quelque chose créé PENDANT le scénario.

## 3. Résultats

Trois builds ont été utilisés dans la journée. Chaque résultat est rattaché au sien.

| Build | Contenu | Passage du rig | Rig | Résultat |
|---|---|---|---|---|
| antérieur | gate durcie, try/catch du listener | 16:03 | `e2e-gate` | **5/5** (« autre bot » ignoré faute d'autre bot sur le serveur) |
| antérieur | tools surface identifiables par `messageId`, patch de l'en-tête | 17:21 | `e2e-surface` | **4/4** (arrêt du bot pendant le timer, rattrapage au redémarrage) |
| A | `activity.summary` corrigé, sérialisation tolérante aux BigInt | 17:31 et 17:37 | rejoué seul | `eval.activity-summary` PASS, réponse vérifiée dans le salon (7 messages, 5 le 22/11, 2 le 23/11) |
| B | liaisons runtime dans des providers, erreurs actionnables des surfaces, repli de `members.pickRandom` | 17:57 à 18:02 | `tool-evals` | **8/8**, aucun tool en échec |
| B | idem | 18:02 à 18:11 | `e2e-features4` | **6/6** |
| B | idem | 18:11 à 18:46 | `e2e-full-suite` | **11/11** |
| C (final) | + handlers d'intégration décorés, `applyConfig`, vue de configuration limitée aux compétences appliquées | voir §7 | `server.overview`, `config.panel`, puis `tool-evals` | voir §7 |

`e2e-gate` et `e2e-surface` n'ont pas été relancés sur les builds B et C : la gate et le moteur de triggers n'ont pas été modifiés depuis.

Cumul du build B : 8 + 6 + 11 = **25/25**, tous avec le critère strict.

## 4. Suite complète, scénario par scénario (build B, 19:11 à 19:46)

| # | Scénario | Preuve | Résultat |
|---|---|---|---|
| 1 | `gate.noise` | « HAHAHAHYA QUOI » dans le salon dédié : aucun traitement, zéro appel LLM | PASS |
| 2 | `rules.list` | `rules.list` réussi | PASS |
| 3 | `server.overview` | `server.overview` et `config.panel` réussis, pas de renvoi brut de la configuration legacy | PASS |
| 4 | `config.panel` | tool réussi, fil `config-bot` de type 12 (fil privé), panneau du bot réellement posté dans le fil | PASS |
| 5 | `tickets.surface` | surface « ticket » `ypl2jm` créée pendant le scénario | PASS (4 échecs de tools récupérés) |
| 6 | `skills.voice` | `search_skills` réussi | PASS |
| 7 | `skills.casino` | `search_skills` réussi | PASS (2 échecs récupérés) |
| 9 | `ingest.status` | `guild.ingestStatus` réussi | PASS |
| 10 | `memory.forget` | `memory.forget` réussi, opt-out présent en base | PASS |
| 8 | `polls.compose` | surface créée, deux votes écrits, message édité avec les résultats | PASS |
| 11 | `rule.confirm` | voir §6 | PASS |

Nettoyage vérifié après la suite : règle de confirmation rétablie à `false`, aucun opt-out restant, aucune surface de test, aucun vote de test, aucun salon témoin restant.

## 5. Échecs de tools observés (tous récupérés par le modèle)

Ils sont listés ici parce que les anciens rigs les auraient masqués.

| Scénario | Tools en échec avant réussite |
|---|---|
| `features4 / surface.runtool` | 3 × `surface.create` : `rows.0.kind`, `rows.0.buttons`, `rows.0.buttons.0.pipeline` |
| `tickets.surface` | 2 × `surface.get` (identifiant inconnu), 2 × `surface.create` : `rows.0.buttons.0.pipeline.0.type`, puis `.0.name` |
| `skills.casino` | 1 × `surface.get`, 1 × `surface.create` : `rows.0.buttons.0.pipeline.0.modal.inputs` |

Ces refus sont normaux (définitions invalides, mauvais identifiant). Leur motif indique désormais le champ en faute ou l'identifiant fourni, ce qui permet au modèle de corriger en un ou deux essais au lieu de retenter à l'aveugle.

Point d'attention : le modèle a utilisé deux fois le même identifiant de message inconnu (`1572355168429670451`) pour désigner une surface. À surveiller.

## 6. Confirmation des actions destructives (scénario `rule.confirm`, live)

C'est la première confirmation destructive jamais affichée par le bot. La liaison des règles au registry vivait dans un hook de module qui ne s'exécute pas (voir `05-verification-anomalies.md` §5).

Déroulé sur le serveur de dev :
1. Règle `confirmDestructiveActions` activée par le bot lui-même (`rules.set` réussi).
2. Salon témoin `e2e-confirm-probe` créé par le rig.
3. Demande à l'agent de supprimer ce salon.

Résultat : 1 tentative de suppression, bloquée (« Action destructive bloquée par la règle du serveur »), 1 surface de confirmation affichée (ligne d'audit `rule.confirm.shown`), salon intact. Règle rétablie et salon témoin supprimé ensuite.

**Non vérifié** : le clic sur ✅. Il exige une vraie interaction Discord, qu'un rig ne peut pas produire. Le chemin d'approbation (clé d'accord posée, action exacte autorisée à passer, autre cible toujours bloquée) est couvert par `tool-registry.confirm.spec.ts`.

## 7. Build final (C) : test de fumée

Build C démarré à 18:47. Il ajoute aux correctifs du build B les handlers d'intégration décorés (avec enregistrement par `applyConfig`) et la vue de configuration limitée aux compétences appliquées.

| Rig | Passage | Résultat |
|---|---|---|
| `e2e-full-suite` (`server.overview`, `config.panel`) | 18:48 à 18:52 | **2/2** : `config.panel` = tool réussi, fil privé, panneau posté |
| `tool-evals` | 18:52 à 18:59 | **8/8**, dont 1 échec récupéré (`records.create`, premier appel sans `dueAtIso`, second accepté) |

Panneau de configuration posté à 18:51 dans le fil privé `config-bot` (lu via l'API) : 6 compétences appliquées (1 créée automatiquement pour la mémoire d'un membre, 5 recettes de la bibliothèque utilisées par l'agent), la ligne « Recettes de la bibliothèque disponibles : 135, dont 5 déjà utilisées (non listées) », les intégrations image et musique, l'agent IA avec son modèle, le mode thinking. Le catalogue des recettes n'est plus listé et « Fournisseur IA » n'apparaît plus en double.

Le build committé ajoute au build C deux changements sans rapport avec les rigs, qui n'ont donc pas été relancés :

- un balayage de texte : 153 séquences `\u0029` (une parenthèse fermante) utilisées à la place de `\u0027` (l'apostrophe) dans 26 fichiers, dont des descriptions de tools, le prompt système et des triggers de recettes (« Boutique d)articles ») ;
- une correction du seed des recettes, qui réactive une recette purgée lorsque son trigger revient au catalogue (sauf suppression par le staff). Elle répare la disparition de la recette du système AFK causée par la coquille.

Démarrage de ce build à 19:07 : connecté, 135 recettes au catalogue, confirmation destructive opérationnelle. État de la bibliothèque vérifié en base sur les deux serveurs : 135 recettes actives avec leur trigger corrigé, aucune absente, aucune orpheline, la recette AFK active.

## 8. Tests unitaires (build C)

55 tests : 35 dans le bot (5 fichiers) et 20 dans `packages/shared`. Les 35 du bot couvrent ce qu'aucun rig ne peut cliquer :

- `tool-registry.confirm.spec.ts` (7) : porte de confirmation destructive.
- `integration.handlers.spec.ts` (9) : métadonnées de routage du bouton et de la modale, garde Policy, appel à `applyConfig`, jamais la clé dans la réponse.
- `activity-coverage.spec.ts` (6) : profondeur réelle des données.
- `surface.errors.spec.ts` (6) : messages d'erreur actionnables.
- `memory-curator.spec.ts` (7) : conservateur de mémoire.

## 9. Ce qui reste à vérifier à la main

1. **Clic sur ✅ Confirmer** lors d'une action destructive, sur un serveur où la règle est activée.
2. **Bouton « Connecter un fournisseur IA »** : ouverture de la modale, enregistrement, effet immédiat. Le bouton n'apparaît que si aucun fournisseur n'est configuré.
3. **Clic sur un bouton de surface** (tickets, sondage) : le rendu et les pipelines sont vérifiés en base, pas au clic.

## 10. Nuit du 23 au 24/11 : arbitrages, incident de 20:09, build D

### Build D

`pnpm verify` vert trois fois dans la nuit (la dernière sur les sources finales) : typecheck, 231 tests (211 bot, 20 shared), build des trois workspaces, cohérence des modules, audit d'architecture strict à 0 violation. Démarrages vérifiés à 22:09, 23:00 et 23:04 : connecté sur 2 serveurs, aucun `ERROR`, tous les modules de tools enregistrés, 135 recettes, confirmation destructive opérationnelle.

### Gate (22:12) : 5/5

Première tentative arrêtée avant le premier scénario : le salon IA du serveur de dév avait atteint la limite de 15 webhooks. Tous étaient l'oeuvre du bot (8 de l'ancien harnais, 6 intrus abandonnés par un run interrompu). Nettoyés, et le rig réutilise désormais un intrus existant. Second passage : intrus ignoré, non-adressé ignoré hors salon dédié, mention et réponse-au-bot traitées. Le scénario « autre bot » est ignoré (aucun second bot sur le serveur).

### Suite complète (22:13 à 22:57, build intermédiaire) : 12/13

| Scénario | Verdict | Note |
|---|---|---|
| gate.noise | PASS | ignoré, zéro appel LLM |
| rules.list | PASS | |
| server.overview | PASS | |
| config.panel | PASS | fil privé, panneau posté |
| tickets.surface | PASS | surface créée pendant le scénario |
| skills.voice | PASS | |
| skills.casino | PASS avec échecs | 2 `surface.create` refusés (pipeline de plus de 10 étapes, `value` d'état d'un type refusé) |
| ingest.status | PASS | |
| memory.forget | PASS | |
| polls.compose | PASS | résultats affichés |
| rule.confirm | PASS | 1 tentative bloquée, confirmations affichées, salon intact |
| records.dynamic | PASS | 1 ligne `casino_balance` créée puis supprimée |
| surface.blackjack | **FAIL** | `surface.create` sans succès, 0 surface |

L'échec du blackjack est le cœur de l'incident de 20:09, rejoué : zéro sonde, zéro fuite de balises internes, plafond non atteint, mais 7 `surface.create` refusés en 40 s pour des erreurs de forme (`rows` absent, puis à plat, `kind` invalide, `buttons` absent, `pipeline` en objet). Le modèle ne connaissait pas la forme exacte de la définition. La forme a été mise en tête de la description et de la consigne de l'outil, le plafond d'étapes par bouton est passé de 10 à 20 et `setState.value` accepte tout JSON.

### Scénario rejoué sur le build final

- `surface.blackjack` (23:01 et 23:04) : **PASS** deux fois. Une surface, 0 sonde, 0 bouton non câblé, 0 fuite, recette ouverte, 1 `search_tools` (7 dans l'incident), plafond non atteint.
- `e2e-surface` (23:05) : **4/4**. Surface postée, trigger armé, bot tué pendant le timer, bouton passé au vert actif après le redémarrage (rattrapage).

Le panneau du second passage a été laissé dans le salon IA du serveur de dév (« Blackjack, table de test clic ») pour un clic à la main : 4 boutons (Miser 10, Miser 50, Tirer, Rester), description liée à l'état.

### Nettoyage

13 webhooks de test supprimés (le salon en compte 2, le guardian et l'intrus réutilisé). 8 surfaces supprimées : 4 panneaux de tickets laissés par des runs antérieurs, 1 casino de test de la nuit, 3 sondes de l'incident de 20:09. Conservés : le panneau de test clic, et le blackjack de l'utilisateur dans son propre salon (construit pendant l'incident, état vide).

### Limite

Le clic réel n'est pas simulable en REST. L'acquittement des clics est couvert par 13 tests unitaires sur les handlers (`surface.handlers.spec.ts`).

## 11. Moteur multi-fournisseurs : rig `e2e-providers` (nuit du 23 au 24/11)

### Build E

`pnpm verify` vert sur les sources finales : typecheck, 542 tests bot et 20 shared, build des trois workspaces, cohérence des modules, registre des 171 tools, audit d'architecture strict à 0 violation (348 fichiers). Démarrages vérifiés à 00:32, 00:42, 00:48 et 00:57 : module `ProvidersModule` chargé (5 providers, 10 handlers, 3 exports), 4 protocoles enregistrés, connecté sur 2 serveurs, aucun `ERROR`.

### Rig

`apps/bot/scripts/e2e-providers.mjs`, 6 scénarios, sur le serveur `1550835980116824136` (salon IA `1550835981006020640`, webhook `agent-e2e-guardian`). Critères : `metadata.ok` de la ligne d'audit `assistant.tool.*` et tour du journal `logs/llm.jsonl` postérieur au fil de la demande. L'état final du serveur est comparé à un état de référence pris après la migration.

### Résultat final (23:58 à 00:04) : 6/6

| Scénario | Verdict | Preuve |
|---|---|---|
| `providers.migrated` | PASS | tour servi par `chat.reasoning` sur `deepseek-official` / `deepseek-flash` ; 3 routes de conversation présentes |
| `providers.list` | PASS | `provider.list` ok, `capability.list` ok |
| `providers.test` | PASS | « Connecté : 2 modèle(s) disponible(s). Catalogue enregistré. » (`deepseek-flash`, `deepseek-v4-pro`) |
| `providers.rebind` | PASS | `capability.bind` ok : `chat.default` sur `deepseek-v4-pro`, `chat.reasoning` et `chat.ingestion` liées ont suivi ; le tour suivant est servi par `deepseek-v4-pro` ; retour sur `deepseek-flash`, les routes liées reviennent |
| `providers.fallback` | PASS | fournisseur `e2e-noir` (`https://192.0.2.1/v1`, jamais joignable) lié à `chat.reasoning` avec `deepseek-official` en repli ; audit `capability.fallback` de `e2e-noir` vers `deepseek-official` ; tour servi par le repli, réponse livrée en 11 s |
| `providers.panel` | PASS | `providers.panel` ok : panneau dans le fil `1574442755646693498` avec `provider:select`, `provider:capability`, `provider:model`, `provider:add` ; `config.panel` ok, bloc « Fournisseurs et modèles de ce serveur » |

État final : identique à l'état de référence (3 routes sur `deepseek-flash`, thinking `adaptive`). Restauré par le bot lui-même : fournisseur de test supprimé par `provider.delete`, route de raisonnement par `capability.bind`, mode thinking par `config.thinking`.

La migration, elle, a eu lieu pendant le premier passage (00:42) : au premier message du serveur sur le nouveau build, `deepseek-official` a été créé depuis l'instance (variables d'environnement, la table `IntegrationConfig` est vide sur cette base), avec ses trois routes et la trace `provider.legacy_migrated`.

### Trois passages, deux corrections

1. **00:42 : 2/7.** Deux défauts du rig, pas du bot. Il lisait l'audit sans décoder son contenu (la base le garde en texte JSON) : quatre « échecs » alors que tous les tools avaient réussi. Et il prenait son état de référence avant la migration, donc n'avait rien à restaurer quand la suppression du fournisseur de test a emporté la route `chat.reasoning` par cascade. Le serveur de test est resté sans cette route le temps de la réparation, faite à la main.
2. **23:49 : 5/6.** Un vrai défaut de produit, attrapé par `providers.rebind` : `capability.bind` avait bien mis `chat.default` sur `deepseek-v4-pro`, mais le tour suivant est parti sur `chat.reasoning`, resté sur `deepseek-flash`. Sur les 12 tours journalisés de ce passage, 12 sont passés par `chat.reasoning`, y compris « réponds exactement sonnette-ok ». Correctif : routes de conversation liées (voir `05` §8d, anomalie 16).
3. **23:58 : 6/6.**

### Limites

- Le clic sur les menus, les boutons et la modale du panneau exige une interaction Discord réelle : 68 tests unitaires couvrent les handlers et le presenter, le clic reste à faire à la main.
- Un seul fournisseur réel a été exercé (DeepSeek, protocole `openai-chat`). Anthropic Messages, kie.ai et les opérations `generic-http` n'ont que des tests unitaires sur `fetch` simulé.
- La bascule a été vue en live sur une panne réseau. Le 429 et le 5xx sont couverts par les tests unitaires (`capability-router.service.spec`, `llm.service.spec`), pas par un fournisseur réel.

## 12. Plans d'action (transposition de discord-agent) : build F, 24/11

### Build F

`pnpm verify` vert sur les sources finales : typecheck, 703 tests bot et 20 shared, build des trois workspaces, cohérence des modules (27 dossiers), registre des 171 tools, audit d'architecture strict à 0 violation. Démarrage vérifié à 02:09 et 02:33 : `ActionPlanModule` chargé (1 provider, 2 handlers), « ActionPlan ready (plan:apply / plan:cancel) », connecté sur 2 serveurs, aucun `ERROR`.

### Ce que le test live couvre, et ce qu'il ne couvre pas

Le clic sur « ✅ Appliquer » exige une interaction Discord réelle, qu'un rig ne peut pas produire. Le scénario `rule.confirm` vérifie donc la moitié de la chaîne : blocage, plan constitué, panneau affiché, rien exécuté. L'autre moitié (prise du plan, revalidation, exécution dans l'ordre, arrêts, accusé) est couverte par 113 tests unitaires (`action-plan.*.spec`), dont une vérification de sensibilité : 25 mutations du code de production, 25 détectées.

### `rule.confirm` (02:35, build F) : PASS

| Étape | Preuve |
|---|---|
| Règle activée par le bot | `rules.set` ok, `confirmDestructiveActions: true` en base |
| Suppression demandée | 1 appel à `deleteChannel`, refusé : « Action destructive (deleteChannel) bloquée par la règle du serveur : elle attend l'approbation de <@…> (1 action(s) en attente) » |
| Trace de la porte | audit `rule.confirm.shown` (`staged: true`) |
| Plan | ligne `action-plan` constituée avec l'action `deleteChannel` sur le salon sonde ; audit `plan.posted` (1 action, `posted: true`) |
| Panneau | message du bot portant `plan:apply~p=<id>` et `plan:cancel~p=<id>` : 2 boutons sur 2 |
| Rien exécuté | 0 ligne `plan.executed` ou `plan.interrupted` ; salon sonde intact |
| Restauration | règle désactivée par le bot, panneau et ligne de plan supprimés, salon sonde supprimé |

### `tickets.surface` (01:11 puis 01:34) : FAIL deux fois, pour deux raisons

**01:11, une régression que j'avais introduite.** Le filtre de visibilité de `getChannels` répondait « 0 salons » : le demandeur du rig est un webhook, qui n'est pas membre du serveur, donc sans permissions de salon à lire. Hier le même tool répondait « 54 salons ». Le modèle, ne trouvant aucun salon, a inventé un identifiant de surface. Correctif : un demandeur non membre voit tout si et seulement si la liste de permissions qu'on lui connaît porte `Administrator` (`ChannelVisibilityPolicy.visibleWithoutMember`), testé. Après correctif : « 54 salons » de nouveau.

**01:34, après correctif : plafond d'étapes.** Le modèle a cherché `surface.create` sept fois de suite (chaque réponse disait « désormais appelable ») sans jamais l'appeler, puis a appelé `surface.get` sur un identifiant de message sans rapport, puis a atteint les 12 itérations. Aucune surface créée. La veille, le même scénario réussissait en quatre appels : `search_tools > openSkill > surface.create > surface.create`. Je n'ai pas trouvé de cause dans les changements de la nuit (le prompt a deux règles de plus, la sélection d'outils est inchangée) et je n'ai pas rejoué le scénario. À surveiller : même symptôme que les ratés déjà connus de `skills.casino` et `skills.voice`.

### Un lancement sans filtre, à signaler

À 01:09, j'ai lancé `e2e-full-suite.mjs` sans `E2E_ONLY`. Toute la suite a démarré au lieu du seul scénario demandé, contre la règle « tester uniquement les additions ». Elle s'est arrêtée au huitième scénario sur un `fetch failed` du rig (erreur réseau, pas du bot).

| Scénario | Verdict | Note |
|---|---|---|
| gate.noise | PASS | |
| rules.list | PASS | |
| server.overview | PASS | |
| config.panel | PASS | |
| tickets.surface | FAIL | `getChannels` à 0 salon (régression, corrigée) |
| skills.voice | PASS avec échecs | `enableModule` en échec (valeur de champ invalide) |
| skills.casino | PASS | |
| ingest.status | interrompu | `fetch failed` côté rig |

Ce passage n'a rien laissé : aucune surface créée, règle inchangée, aucun salon de test. Les quatre salons « e2e » encore présents sur le serveur datent du 17 au 20 novembre. Ils ont été supprimés le 24/11 (voir §13).

## 13. Correctif du 24/11 : `tickets.surface` en moins de 5 tours

Seul ce scénario a été rejoué, avec `E2E_ONLY="tickets.surface"` écrit dans la commande (le filtre figure désormais sur la première ligne du journal du rig). Serveur `1550835980116824136`, trois routes de conversation sur `deepseek-flash`, règle de confirmation inactive.

### Ce que le rig mesure désormais

Chaque scénario conversationnel rapporte ses tours LLM : les lignes de `logs/llm.jsonl` écrites entre l'audit `tools.selected` et l'audit `assistant.reply` de la demande, sur le serveur testé, et la capacité qui les a servis. La méthode est validée sur l'historique : elle retrouve exactement les runs en échec de la nuit (12 tours, 8 `search_tools`). `tickets.surface` passe sous 5 tours, sans plafond d'étapes, et supprime ce qu'il a créé : le message du panneau, sa ligne, et l'entrée de mémoire écrite à son sujet. Il refuse aussi toute référence `{{steps.N.data.x}}` dans la définition (voir plus bas).

### Trois passages

| Heure | Build | Verdict | Tours LLM | `search_tools` | Déroulé |
|---|---|---|---|---|---|
| 11:32 | avant la correction des consignes | **FAIL** | 7 (budget 5) | 2 | `openSkill`, `search_tools`, `surface.get` en échec, `search_tools`, `surface.create` refusé, `surface.create`, `saveServerMemory` |
| 13:03 | corrigé | **PASS** | 4 | 1 | `surface.get` en échec, `search_tools`, `surface.create` réussi du premier coup |
| 13:05 | corrigé | **PASS** | 4 | 1 | même déroulé |

Les trois passages sont partis sur `chat.reasoning` : c'est attendu, « Crée ici un panneau de tickets » est une action. Les primitives n'ont plus été cherchées : la recherche restante porte sur `setChannelOverwrite`, un outil de la recette que le plafond de pertinence n'avait pas retenu. Jetons consommés : 165 682 au premier passage, 85 967 au second.

### Ce que le premier passage a révélé

1. **Les références de résultat des pipelines n'étaient pas documentées.** L'exécuteur range le résultat d'un `runTool` à plat : `ok`, `summary`, puis les champs renvoyés par l'outil. Pour `createChannel`, la référence est donc `{{steps.0.channelId}}`. Le modèle a écrit `{{steps.0.data.id}}` dans quatre étapes. La surface a été acceptée, sa forme est valide, mais son bouton aurait échoué au clic : un défaut invisible pour le rig, qui ne simule pas les clics. La consigne de `surface.create` dit désormais que tout outil passe par `runTool` et comment lire son résultat ; le rig refuse les références en `steps.N.data`.
2. **Le premier `surface.create` avait un nom d'outil comme type d'étape.** `setChannelOverwrite` écrit à la place de `runTool{name,input}` : refus, puis un tour de plus. Même consigne, corrigée.
3. **Le rig laissait un piège au run suivant.** Il supprimait le panneau, pas l'entrée de mémoire que le modèle écrivait à son sujet. Le run d'après lisait cette entrée, appelait `surface.get` sur une surface supprimée et perdait un tour. Le scénario retire désormais cette entrée, et le nettoyage global retire les entrées de mémoire du serveur de test qui citent une surface n'existant plus (3 retirées au passage de 13:03).
4. **`openSkill` ne disait pas que les outils de la recette devenaient appelables.** Le modèle les cherchait ensuite. Le résultat de l'outil le dit maintenant.

### Limites

- Deux réussites seulement sur le build corrigé, à un tour du budget (4 sur 5) : le comportement d'un modèle varie, ce n'est pas une garantie.
- Chaque passage compte un outil en échec, affiché dans la note : `surface.get` sur la surface du passage précédent. Le rig la supprime, mais sa trace reste dans les actions récentes du bot et dans l'historique du salon ; le modèle applique « lire avant d'écrire », ne la trouve pas, et continue. C'est un artefact du rig joué en série.
- Le clic sur le bouton « Support » n'est pas vérifié : le pipeline (`createChannel`, deux `setChannelOverwrite`, `sendMessage`) n'a jamais été exécuté.
- Les autres scénarios n'ont pas été rejoués, conformément à la demande.

## 14. Test manuel du 24/11 : la modale « Ajouter un fournisseur » était rejetée

**13:58, trouvé par l'owner.** Le clic sur « Ajouter » rendait `Invalid Form Body data.components[BASE_TYPE_MAX_LENGTH]: Must be 5 or fewer in length` : la modale portait six champs (slug, nom affiché, protocole, URL de base, clé, options JSON) pour une limite de cinq. C'est le risque annoncé en §11 pour les menus du panneau : un clic réel ne se simule pas, et la spec des handlers ne comptait pas les composants de la modale construite.

**Correctif (commit suivant).** Cinq champs, slug déduit du nom, champs facultatifs explicites, garde `assertModalFits` avant tout envoi, assertion sur la modale construite dans chaque spec (détail `05`, anomalie 22).

**Reste à faire de ta main** : le clic réel sur « Ajouter », une soumission de création (par exemple OpenRouter), puis une modification avec la clé laissée vide.
