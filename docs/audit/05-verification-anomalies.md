# Audit 05 · Vérification et anomalies

> État du 23/11/2026 en fin de journée, complété dans la nuit du 23 au 24/11 (arbitrages owner et incident de 20:09), puis le 24/11 au matin (primitives épinglées, intention de la demande, lint TypeScript actif).

## 1. État de vérification

| Vérification | Résultat |
|---|---|
| `pnpm typecheck` | 0 erreur |
| `pnpm lint` | 0 erreur sur les deux passes ; la passe TypeScript (quatre règles) linte 412 fichiers (voir `04` §3) |
| `pnpm test` | 787 tests : 759 dans le bot (56 fichiers) et 28 dans `packages/shared` (4 fichiers) |
| `pnpm build` | bundle complet (shared, bot, dashboard) |
| `pnpm check:modules` | dossiers de modules cohérents |
| `pnpm arch:audit` (strict) | **0 violation** (60 au soir : toutes remboursées) |
| `sync-tool-names --check` | OK, 171 tools |
| CI `develop` | modules, audit d'architecture strict, lint, typecheck, test, build (contrôle requis « Lint · Modules · Typecheck · Test ») |
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

## 8d. Anomalies 9 à 17 : moteur multi-fournisseurs (nuit du 23 au 24/11)

Le moteur a été construit en relevant chaque défaut croisé sur son passage, même hors de son périmètre.

9. **La génération musicale ne pouvait plus fonctionner.** `music.service.ts` faisait `const key = this.apiKey()` sans `await` : une promesse (toujours vraie) partait comme clé, l'appel était refusé. L'image kie.ai avait `const key = ''` : le tool répondait toujours « désactivé ». Les deux lisent désormais la clé, l'URL et le modèle de la route du serveur.
10. **Clé d'instance lue sans être déchiffrée au démarrage.** `LlmService.onBoot` prenait `row.apiKey` brut dans une colonne chiffrée. Latent sur la base de dev (table vide), réel dès la moindre clé saisie par la modale. `LlmService` passe par `IntegrationService`, seul à déchiffrer.
11. **`user_id` envoyé à tout endpoint.** Ce champ n'est pas standard : un endpoint OpenAI strict refuse toute la requête en 400. Il ne part plus que vers DeepSeek, reconnu par son domaine exact (`deepseek.com` et sous-domaines ; `deepseek.com.autre.example` ne l'est pas, un test l'a montré).
12. **La bascule sur le fournisseur de repli ne marchait pas pour les adaptateurs.** Le client LLM ne reconnaissait que ses propres erreurs : une 5xx remontée par un adaptateur (Anthropic, kie) ne déclenchait rien. Trouvé par le test `llm.service.spec`, corrigé par `isFallbackWorthy`, qui lit les deux familles. Les pannes réseau et les délais y ont été ajoutés : seul un 429 et un 5xx déclenchaient le repli.
13. **Le signal d'annulation était écrasé.** `safeFetch` remplaçait le signal de l'appelant par son propre délai : une capacité annulée ne l'était pas.
14. **Des tools de lecture classés comme des actions.** `rules.set` (modifie les règles) passait pour une lecture à cause du filtre `rules\b` ; inversement les nouveaux tools `provider.list`, `capability.list` faisaient passer une simple question pour une action, donc pour une demande de raisonnement. Filtre resserré, tools de lecture déclarés, `request-intent.spec` fixe les deux sens.
15. **`check:tools` n'était pas branché.** Le script annonçait un contrôle dans `verify` qui n'existait pas (voir `04` §3).
16. **Changer le modèle de conversation semblait sans effet.** Preuve live : sur 12 tours journalisés du premier passage du rig, 12 sont partis sur `chat.reasoning`, y compris pour « réponds exactement sonnette-ok ». La détection d'intention héritée du correctif de 20:09 envoie sur cette route toute demande dont un mot dépasse trois lettres et figure dans la description d'un tool modifiant, soit presque toute phrase réelle. Rebinder `chat.default` ne changeait donc que la route que personne n'empruntait. Correctif immédiat : routes de conversation liées (`provider-route.links.ts`). L'heuristique elle-même est resserrée le 24/11 (anomalie 18).
17. **Le rig a laissé le serveur de test sans route de raisonnement.** Il prenait sa photo de référence avant la migration, donc n'avait rien à restaurer quand la suppression du fournisseur de test a emporté la route par cascade. Réparé à la main sur le serveur, puis le rig prend sa référence une fois la migration faite.
18. **Presque toute phrase partait sur la route de raisonnement.** `detectRequestIntent` déclarait une action dès qu'un tool routé n'était ni noyau ni lecture par son nom : avec 171 tools, un seul mot commun de plus de trois lettres en routait un. Sur 113 tours journalisés une nuit, 109 sont partis sur `chat.reasoning`. Correctif du 24/11 : une action exige un signal explicite, soit une recette correspondante, un verbe d'action du lexique (`request-intent.lexicon.ts`), soit un tool modifiant écrit dans la demande ; un tool simplement routé n'est pas un signal. Une question ignore les verbes et les recettes qui suivent son mot interrogatif, sauf derrière une préface de capacité polie (« est-ce que tu peux créer un système de tickets ? » est bien une action). Les verbes se comparent en mot entier, avec des frontières Unicode : la frontière native est ASCII et ne reconnaît jamais « éditer » ni « épingler ». Le verbe nu `mettre` est exclu (« ça va mettre combien de temps ? »), seules comptent « mettre à jour » et « mettre en place » ; les verbes homonymes d'un nom (`active`, `archive`, `poste`, `programme`, `règle`) ne comptent qu'en tête de demande ou après un sujet. Preuves : 54 tests dans `request-intent.spec`, et dans `llm.service.spec` le tour de « réponds exactement « sonnette-ok » et rien d'autre », « salut ça va » et « quelle heure est-il » est servi par `chat.default` avec `reasoning_effort: 'none'`, alors que des tools modifiants sont routés et que le serveur possède une route de raisonnement. Coquille attrapée par les tests en route : la racine de « règle » avait été tapée avec un é accent aigu, l'impératif n'était plus reconnu.
19. **`tickets.surface` butait sur le plafond de 12 tours.** Les primitives du moteur générique (`surface.create`, `surface.patchState`, `surface.updateComponent`, `trigger.schedule`, `trigger.cancelByKey`) étaient hors du noyau. `search_tools` les annonçait bien « désormais appelables » et l'expansion du toolset fonctionnait : le modèle les cherchait 8 fois de suite sans jamais les appeler (12 tours, tous sur `chat.reasoning`). Trois défauts voisins corrigés : le plafond de 24 tools comptait le noyau, il ne restait que 10 places hors noyau ; la consigne d'un tool (`systemPrompt`) n'était jamais montrée quand il était routé d'emblée ; `search_tools` cherchait dans tout le registre et ses cartes étaient coupées par la limite de 4 000 caractères. Correctif : noyau de 20 (primitives et `search_skills` épinglées), plafond de 24 hors noyau, champ `keywords` sur les tools et scoreur partagé (`packages/shared/src/tools/tool-search.ts`), consignes des tools épinglés injectées dans `<TOOLSET>` dès le tour 1, `search_tools` limité aux tools que l'appelant peut exécuter et rendant ses cartes avant son résumé. À noter : `trigger.cancel` n'existe pas, l'outil s'appelle `trigger.cancelByKey`. Résultat live (`06` §13) : 4 tours et 1 `search_tools` sur deux passages du build corrigé, surface créée du premier coup puis supprimée.
20. **`pnpm lint` ne lintait aucun fichier TypeScript.** Voir `04` §3. Corrigé le 24/11 : une passe dédiée à quatre règles de bugs réels, 45 violations corrigées, aucune règle désactivée.
21. **Les références de résultat des pipelines n'étaient pas documentées.** Un `runTool` range son résultat à plat (`ok`, `summary`, puis les champs renvoyés par l'outil : `createChannel` donne `{{steps.N.channelId}}`). La consigne de `surface.create` ne le disait pas, ni que tout outil passe par `runTool`. Vu en live le 24/11 : le modèle a écrit `{{steps.0.data.id}}` dans quatre étapes d'un panneau de tickets, qui a été accepté et aurait cassé au clic (détail `06` §13). Consigne complétée ; le rig refuse désormais ces références. Reste ouvert : la validation accepte une référence qui résout à vide, un montage écrit sans la consigne peut toujours produire un bouton silencieusement cassé.

À connaître pour les sessions suivantes : le crochet de sécurité Mimosa signale en « injection SQL » tout appel nommé `execute(` qui reçoit des données (`adapter.execute(provider, { params })`) et en « identifiant en dur » un littéral affecté à `apiKey`. Ce sont des faux positifs sur ce code (aucun SQL, clés fictives de test). Les méthodes du routeur et du client s'appellent `runCapability` et `runTurn`, les specs passent par une constante `KEY = 'test-key-not-real'`. Ne pas contourner le crochet par du code obscur : renommer ou découper l'édition. Le 24/11, deux autres faux positifs du même crochet : `RegExp.prototype.exec` sur un texte, pris pour un lancement de commande (utiliser `String.prototype.match`), et une commande shell qui citait un fichier source à côté d'une redirection, prise pour une écriture de source.

Analyse Mimosa du 24/11 (scan `scan-2026-11-24T10-13-04.019Z-52c876df1ed1`, profondeur `deep`, 107 fichiers source des commits `1a61511` et `bd4c905`) : 0 alerte sur le code. À lire avec sa limite : le rapport scellé annonce un statut d'exécution « inconclusif » et une couverture partielle (graphe d'appels incomplet), et son modèle de menaces n'a observé aucun point d'entrée ni aucune surface d'autorisation, alors que le bot en a (contrôleurs HTTP sous gardes, registry de tools, handlers Discord). La phase de validation n'a enquêté sur aucun candidat : ce zéro n'est pas une preuve de sécurité.

**Leçon** : la preuve live a valeur de test. Trois de ces défauts (12, 14, 16) étaient invisibles en relecture et sont sortis d'un test ou du journal `llm.jsonl`, une fois que chaque tour y porte sa capacité, son fournisseur et son modèle.

## 8e. Anomalies 18 à 21 : trouvées en transposant discord-agent (nuit du 23 au 24/11)

L'étude de `discord-agent` (`07_BENCHMARK_DISCORD_AGENT.md`) a servi de miroir. Quatre défauts de notre côté sont apparus en la préparant.

18. **Le clic « Confirmer » n'exécutait rien.** Le mécanisme de confirmation installé le 23/11 postait un panneau par tool ; le clic ✅ posait une clé en cache (5 minutes) et répondait « Confirmé : le bot va relancer l'action ». Mais personne ne relançait : il fallait que le modèle ré-appelle le même tool avec la même entrée, dans une boucle déjà terminée ou occupée ailleurs. Et l'exécution reprenait les permissions du demandeur telles qu'elles étaient au moment de la demande, pas au moment du clic. Le scénario live `rule.confirm` passait parce qu'il vérifiait le blocage, jamais l'exécution après le clic. Correctif : plans d'action (voir `02` §6c).
19. **La porte s'ouvrait quand elle ne pouvait pas lire la règle.** Règles du serveur non liées ou illisibles : `refuseUnlessApproved` rendait `null`, donc laissait passer l'action destructive. C'est maintenant un refus.
20. **`getChannels` révélait les salons cachés.** Le tool rendait, à tout membre et sans exiger de permission, tous les salons que le bot voit (id, nom, type). Un membre sans accès à un salon staff en apprenait le nom en demandant « liste les salons ». `ChannelVisibilityPolicy` filtre désormais sur `ViewChannel`, overwrites compris.
21. **Le prompt système contredisait le code.** « Exécution DIRECTE (depuis le 17/11) : plus de plans ni de panneau de confirmation », alors que la règle `confirmDestructiveActions` existe depuis le 23/11. Réécrit : direct par défaut, plan quand la règle l'exige, jamais de confirmation par message.

**Leçon** : un mécanisme de sécurité doit être éprouvé au clic, pas au blocage. Un rig qui s'arrête à « l'action est bloquée » prouve la moitié de la chaîne.

## 8f. Anomalies 22 et 23 : trouvées par un lancement de rig sans filtre (24/11, 01:09)

22. **`getChannels` répondait « 0 salons » au rig.** Le filtre de visibilité ajouté pour l'anomalie 20 lisait les permissions de salon d'un membre. Le demandeur d'un rig est un webhook, qui n'est pas membre du serveur : sans membre, le filtre rendait une liste vide. Effet : le modèle ne trouvait plus aucun salon et inventait des identifiants. Hier : « 54 salons ». Correctif : `ChannelVisibilityPolicy.visibleWithoutMember`, tout ou rien selon `Administrator`, et un test qui fixe la régression. **Leçon** : un filtre fondé sur un membre doit dire ce qu'il fait quand l'auteur n'en est pas un.
23. **Un rig lancé sans `E2E_ONLY`.** J'ai voulu tester un scénario et lancé toute la suite (voir `06` §12). Elle s'est arrêtée au huitième scénario sur une erreur réseau du rig, sans rien laisser derrière elle. C'est la seule raison pour laquelle l'anomalie 22 a été vue avant la livraison. **Leçon** : écrire le filtre dans la commande elle-même (`E2E_ONLY=nom,...`), et lire la première ligne du journal du rig, qui imprime le filtre retenu.

## 9. Limites connues

1. **Blueprints et collections** : traité le 23/11 au soir. Le store `records.*` accepte désormais toute collection dynamique bien formée (`CollectionQuotaPolicy` : 50 collections et 10 000 enregistrements par serveur), vérifié en live par le scénario `records.dynamic`.
2. **Tirage aléatoire** : sans l'intent privilégié « Membres du serveur », `members.pickRandom` travaille sur les membres connus du bot (repli sur le cache, signalé dans le résultat).
3. **CI** : traité. Le workflow lance maintenant l'audit d'architecture strict et le build des trois workspaces.
4. **Sources du framework** : traité. `AGENTS.md` renvoie au paquet installé (`node_modules/@spraxium/core`, `@spraxium/components`) et à Context7, plus au dossier local disparu.
5. **Dérive Prisma** : deux migrations historiques ont été éditées après application, `prisma migrate dev` proposera un reset sur la base de dev. Poursuivre la méthode manuelle.
6. **Lint TypeScript** : traité le 24/11 (anomalie 20). Quatre règles de bugs réels sont actives ; le bloc de style de `@bluzzi` reste désactivé.
7. **Serveurs de modèles locaux refusés** : la garde des requêtes sortantes n'accepte que https sur un hôte public. Ollama, vLLM ou LM Studio sur la machine ne peuvent pas être déclarés comme fournisseur, par conception (SSRF). Passer par une passerelle HTTPS publique.
8. **Heuristique d'intention** : traité le 24/11 (anomalie 18). Limite assumée : une action formulée sans verbe du lexique, sans recette correspondante et sans nom de tool part sans raisonnement. L'action reste exécutable, le modèle a simplement tous ses tools sans l'effort de raisonnement. Un verbe s'ajoute dans `request-intent.lexicon.ts`, avec son test.
9. **Adaptateurs non exercés en réel** : seuls les protocoles `openai-chat` (DeepSeek) et la panne réseau ont été vus en live. Anthropic Messages, kie.ai (chat, musique, image), les opérations `generic-http`, la voix et la vidéo n'ont que des tests unitaires sur `fetch` simulé.
10. **Panneau « Fournisseurs et modèles »** : le clic sur les menus, les boutons et la soumission de la modale exigent une interaction Discord réelle (68 tests unitaires sur les handlers et le presenter). La suppression d'un fournisseur depuis le panneau est immédiate, sans confirmation, et emporte ses routes. La clé saisie en langage naturel reste visible dans le message : le prompt système oriente vers la modale.
11. **Fournisseurs d'instance laissés en place** : les lignes `IntegrationConfig` et le code d'intégration restent. Ils servent d'amorce et de source des copies ; leur retrait est un chantier à part.
12. **Trois avis de sécurité sous épinglage tiers** (audit du registre de paquets, 24/11) : `effect` 3.21.0 et `deepmerge-ts` 7.1.5, épinglés exactement par `@prisma/config` 6.19.3 (dernière version 6.x de Prisma), et `fast-xml-parser` 5.8.0, épinglé par `gamedig` 5.3.3 (dernière version). Correctibles seulement en écrasant l'épinglage (`pnpm.overrides`, dont un changement majeur pour `deepmerge-ts`) ou en passant à Prisma 7. Non appliqués : la décision appartient à l'owner. L'avis sur `minimatch` (chaîne ESLint seulement, hors production) est fermé : `typescript-eslint` 8.73.0, unique exemplaire après `pnpm dedupe`. En chemin, un piège à connaître : la 8.74.0, publiée la veille, a fait écrire à pnpm onze exceptions dans `minimumReleaseAgeExclude` (`pnpm-workspace.yaml`), donc contourner la politique d'ancienneté des versions du dépôt. Revenu en arrière, puis résolu dans la plage `^8.72.2`, où pnpm choisit lui-même la version la plus récente admise par la politique. Après tout `pnpm add` ou `pnpm update`, contrôler que `pnpm-workspace.yaml` n'a pas bougé.

## 10. Risques résiduels acceptés

- 25 modules, dont 23 non activables par serveur (catalogue minimal) : assumé, l'agent est le produit.
- `search_tools` expose le registre à la demande, et depuis le 24/11 n'annonce que les tools que l'appelant peut exécuter (modules actifs et permissions) ; les permissions restent vérifiées tool par tool à l'exécution.
- Ingestion de l'historique : coût LLM plafonné (20 appels par serveur), reprise après crash, filtres de vie privée en code.
