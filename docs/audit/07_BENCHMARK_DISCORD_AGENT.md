# Audit 07 · Benchmark de `discord-agent` et transposition dans 10cordes-bot

**Objet** : étude en lecture seule du dépôt `C:\Users\Bastien\Documents\Projects\discord-agent` (commit `50a3b02`, lu le 24/11/2026), puis transposition de ses mécanismes utiles.

**Méthode** : les 27 fichiers de `src/`, les 15 migrations SQL, `AGENTS.md`, `opencode.json` et `README.md` ont été lus en entier, deux fois (une lecture directe des déclencheurs, du fichier de permissions et des tables ; une lecture complète par un agent de lecture). Rien n'a été exécuté ni modifié dans ce dépôt.

**Limites** : `node_modules` y est absent. Le comportement interne du SDK (AI SDK v7, discord.js 14.28.1) n'a pas été lu dans les sources installées ; trois points ont été recoupés dans la documentation en ligne et sont signalés. Les comptes d'outils viennent d'un recoupement des tables de règles par recherche textuelle, pas d'une exécution.

Chaque fait cite son fichier (`src/` implicite) et sa ligne.

## 1. Ce qu'est `discord-agent`

Un bot Discord d'environ 4 900 lignes de TypeScript, Node 24, Postgres via Drizzle, AI SDK v7 avec un provider OpenRouter. Sa doctrine tient en une phrase de son `README` : « The focus is on giving the AI tools to solve problems, not writing code to control the AI ». Le code ne contient ni module métier ni interface écrite à la main : 160 outils fins qui enveloppent l'API Discord, et une seule boucle.

- Modèle : `deepseek/deepseek-v4.1-flash-1017` par défaut (`utils/env.ts:13`).
- Deux déclencheurs seulement : `messageCreate` (`triggers/message-create.djs-event.ts:32`) et `interactionCreate` (`triggers/interaction-create.djs-event.ts:74`). Plus un cron par minute.
- Répartition imposée par `AGENTS.md` : `triggers → tools / tables / integrations → utils`, dépendances à sens unique.

## 2. Axe 1 : boucle cognitive et prompt

**Un seul appel `streamText`** (`message-create:66-126`). Aucune mémoire de conversation n'est passée au SDK : l'historique est lu par un outil.

| Mécanisme | Fait |
|---|---|
| Fin | `stopWhen` : 50 étapes au plus (`:24`, `:68`), ou dès qu'une étape contient un résultat de `sendReply` / `sendMessage` (`:25`) |
| Premier tour forcé | étape 0 : `toolChoice` impose `getReplyContext` (`:97`) |
| Dernier tour forcé | étape 49 : `sendReply`, ou `sendMessage` si la réponse a déjà échoué (`:98-101`) |
| Tours intermédiaires | `toolChoice: "required"` (`:102`) : le modèle doit appeler un outil, il ne peut pas s'arrêter sur du texte |
| Contexte lié au serveur | `toolsContext` fixe `channelId` et `messageId` (`:111-113`) : le modèle ne choisit ni le salon ni le message |
| Livraison | par l'outil `sendReply` uniquement. Le texte intermédiaire n'est jamais envoyé à Discord, seulement journalisé (`:121-123`) |
| Relance, synthèse | aucune. Sans réponse, un `logger.warn` (`:157-159`) |

**Prompt système** (`message-create:69-85`), les règles qui nous concernent, verbatim :

> Donne la réponse dès la première phrase. Ajoute seulement les détails utiles.
>
> Utilise des liens Markdown avec un libellé court et précis [...] Intègre chaque lien au passage qu'il documente [...] N'affiche pas d'URL brute et ne regroupe pas les sources en bas du message, sauf si l'utilisateur le demande.
>
> Si proposeDiscordActions est disponible et que la demande nécessite des modifications, regroupe les actions prévues dans un seul plan. [...] Continue les tâches indépendantes et précise dans ta réponse quelles actions restent à approuver.

**Lecture du contexte** (`tools/reply-context.ts`) : 10 messages avant la cible puis la cible (`:54-55`), jamais les messages postérieurs (`:51-53`). Par message : identifiant, auteur, contenu, `isSelf`, `isTarget`, date (`:57-65`). Les pièces jointes ne sont jamais lues.

**Erreurs** : une erreur d'outil est journalisée et la boucle continue (`:133-136`). Une erreur de flux remonte au gestionnaire générique (`utils/trigger.ts:10-21`) : l'utilisateur n'est prévenu de rien. `attempt` n'est pas un outil mais un `try/catch` de 8 lignes qui rend `{ ok, value }` ou `{ ok, error }` (`utils/attempt.ts`).

## 3. Axe 2 : séparation lecture / mutation, plans `waiting_approval`

**Inventaire** (160 outils Discord, `tools/discord.ts:134-2532`) :

| Catégorie | Nombre | Comment |
|---|---|---|
| Lecture | 58 | exécution directe, après contrôle de permission |
| Écriture directe | 26 | exécution directe, après contrôle de permission |
| Sous approbation | 69 | jamais exposés au modèle |
| Jamais exposés | 7 | définis sans règle de permission (`getBotGuilds`, `openDm`, `sendDm`, `leaveGuild`, `setBotPresence`, deux outils d'émojis d'application) |

Hors Discord : `getReplyContext`, deux outils web, six outils GitHub, et `proposeDiscordActions`.

**Le cœur : le modèle n'a pas les outils qui modifient.** La construction du jeu d'outils saute ceux de l'ensemble `discordToolsRequiringApproval` (`tools/discord-permissions.ts:523-526`). Ils ne sont atteignables que par `proposeDiscordActions`, construit dynamiquement sur leurs schémas Zod, de 1 à 10 actions (`tools/discord-approval.ts:12-24`).

**Le mécanisme, étape par étape :**

1. Le modèle appelle `proposeDiscordActions({ actions: [{ toolName, input }] })`.
2. Chaque action est validée en parallèle (`interaction-create:23-26`).
3. Un message est posté : titre « Actions Discord à approuver », « Demande de <@id> · Expire <t:..:R> », liste numérotée, paramètres en bloc JSON (ou en fichier joint au-delà de 4096 caractères), deux boutons `discord-approval:apply` et `discord-approval:cancel` (`:33-56`).
4. La ligne `waiting_approval` est insérée ; si l'insertion échoue, le message est supprimé et une erreur est levée (`:58-69`).
5. Le modèle reçoit `{ status: "waiting_approval", approvalMessageUrl }` (`:71`) et continue.
6. Au clic : consommation atomique par `DELETE ... WHERE message, salon ET demandeur RETURNING` (`:80-84`). Une seule prise réussit, par l'auteur seulement.

**Au clic « Appliquer »** (`:74-126`) : message modifié depuis → annulé ; délai de 15 minutes dépassé → expiré ; membre rechargé avec `force: true` (`:108`) ; puis exécution séquentielle des actions, par du code, sans modèle (`:113-123`). À l'échec : « Plan interrompu, k/n actions exécutées, arrêt sur tel outil ». Aucun rollback.

**Ce que stocke la table** (`tables/waiting-approval.ts`, `drizzle/0014_waiting_approval.sql`) : `id`, `requester_member`, `validating_message_id` (unique), `channel_id`, `actions` (jsonb : `{ toolName, input }`, `input` étant le résultat du `parse` Zod), `expires_at`. Ni guilde, ni message d'origine, ni statut : la ligne vit jusqu'au clic ou à la purge.

**Écarts observés :**

- 26 écritures passent sans approbation, dont 13 créations (`createChannel`, `createRole`, `createWebhook`, `createAutoModerationRule`...). `AGENTS.md:67-70` exige pourtant plan et confirmation pour tout create, update, delete.
- L'appartenance à l'ensemble d'approbation est une liste écrite à la main (`discord.ts:2536-2608`). Un outil muni d'une règle mais oublié dans la liste serait direct.
- Les actions proposées et exécutées avec succès ne sont journalisées nulle part (`message-create:115-118`, `interaction-create:125`).

## 4. Axe 3 : double validation déterministe

**Fonctions de base** (`tools/discord-permissions.ts`, sauf mention) :

| Fonction | Lignes | Règle |
|---|---|---|
| `hasGuildPermission` | `:20-21` | membre non suspendu, et bit présent |
| `requireDiscordChannelPermissions` | `integrations/discord.ts:164-173` | salon de la guilde du demandeur ; `ViewChannel` et la permission, overwrites compris ; thread privé : `ManageThreads` ou appartenance |
| `checkMemberHierarchy` | `:33-40` | jamais le propriétaire, jamais soi-même ; rôle le plus haut de la cible strictement sous le sien |
| `checkRoleHierarchy` | `:42-48` | rôle inconnu, géré ou `@everyone` refusé ; position strictement inférieure |
| `checkRolePermissions` | `:50-52` | on n'accorde que les bits que l'on détient |
| `requireGuildToolPermission` | `:446-457` | guilde, `guildId` imposé, salon visé, puis contrôle propre à l'outil |

**Tableau outil vers règle** : `rules` = 61 règles spécifiques (`:262-390`), puis deux groupes (guilde `:100-159`, salon `:161-194`) et 19 contrôles annexes (`:196-260`).

**Quatre points de contrôle, pas deux :**

1. À l'exposition : un outil est masqué si le membre n'a pas la permission de guilde, ou si aucun salon visible ne la permet (`:519-521`). Le modèle ne peut pas l'appeler.
2. À chaque appel direct : `requireGuildToolPermission` (`:505`), puis filtrage du résultat (`:507`).
3. Au moment du plan : `validateDiscordApprovalAction` (`:459-468`), avant tout envoi.
4. Au moment de l'exécution : la même fonction (`:476`), action par action, juste avant chacune.

**Plan contre exécution : même fonction, deux états du monde.** Au plan, le membre est celui de l'événement. À l'exécution, il est rechargé. Entre les deux, un rôle a pu être retiré, une cible promue, un salon fermé. C'est la double validation : la seconde décide seule.

**Résultats filtrés** (`:417-434`) : `getChannels`, `getGuildWebhooks`, `getGuildInvites`, `getGuildEvents`, `getActiveThreads` ne rendent que ce que le demandeur voit. Un membre ne découvre pas par le bot l'existence d'un salon qui lui est caché.

**La règle de la catégorie AGENTS est documentaire.** L'identifiant `1574094410830844105` apparaît une seule fois dans le dépôt : `AGENTS.md:65`. Aucun code ne le lit, `AGENTS.md` n'est pas chargé à l'exécution. Le déclencheur exige une mention ou une réponse partout (`message-create:41-43`), et les mêmes contrôles s'appliquent partout. Rien n'est contourné dans cette catégorie.

## 5. Axe 4 : investigation et lecture multi-sources

**`web_search`** (`tools/web.ts:11-41`) : Exa, 1 à 10 résultats, extraits de 350 caractères, délai de 10 s.

**`web_fetch`** (`web.ts:42-119`, `utils/public-web.ts`, `utils/web-content.ts`), le pipeline exact :

1. URL http(s) de 4096 caractères au plus, sans identifiants.
2. Un seul délai de 10 s pour tout l'appel.
3. Cinq redirections au plus.
4. `getPublicPage` : IP littérale non publique refusée, tout port explicite refusé, DNS résolu et filtré sur les adresses publiques (`public-web:51-76`).
5. Statuts : 429, 403 ou défi Cloudflare, autre erreur, type de contenu non textuel, encodage non géré : cinq codes distincts.
6. Corps plafonné à 1 Mio.
7. HTML : JSDOM sans scripts ; retrait de `script`, `style`, `nav`, `footer`, `aside`, `form`, bannières ; racine `main`, sinon `article`, sinon Readability, sinon `body` ; conversion en Markdown par Turndown.
8. 24 liens au plus, paramètres de suivi retirés.
9. Fenêtre `offset` / `max_length` (12 000 caractères par défaut), sans couper une paire de substituts.

**GitHub** (`tools/github.ts`) : six outils, fichier de 300 lignes par défaut, recherches de 20 résultats, pagination des commentaires.

**Aucune orchestration.** Le choix et l'enchaînement des sources appartiennent au modèle. Aucun cache de pages (chaque appel sur `next_offset` retélécharge), aucun budget de tokens, aucune limite de parallélisme dans le code.

**Le silence est un effet de bord, pas un mécanisme.** Comme la réponse ne passe que par `sendReply` et que la boucle s'arrête au premier résultat de réponse, l'utilisateur ne voit que l'indicateur d'écriture (rafraîchi toutes les 8 s, `integrations/discord.ts:201-218`) puis la réponse.

## 6. Axe 5 : mémoire, déclencheurs, cron

**Tables** (`tables/`) :

| Table | État |
|---|---|
| `waiting_approval` | vivante : écrite, consommée, purgée |
| `model_usage` | écrite une fois par demande (`message-create:168-175`), jamais lue |
| `discord_user_memory`, `discord_skill`, `message_feedback` | définies, jamais importées hors de leur fichier |

Trois tables sur cinq sont mortes, et quatre des cinq causes de l'énumération `ai_cause` n'ont aucun code appelant. Le prompt redirige d'ailleurs les questions de mémoire vers deux autres bots (`message-create:80`). **`discord-agent` n'a ni mémoire, ni apprentissage, ni compétences.**

**Décision de répondre** (`message-create:32-43`) : heuristique sans LLM. Auteur bot ignoré ; il faut une réponse au bot ou une mention du bot. Aucune condition de catégorie, aucun mot-clé, aucun filtrage du bruit.

**Cron `openrouter-quota`** (`triggers/openrouter-quota.cron.ts`) : chaque minute, deux appels aux endpoints de gestion d'OpenRouter, sans appel de modèle (`integrations/openrouter.ts:170-196`). L'état est aussi rempli par un `fetch` enveloppé : un 402 coupe une heure, un 429 jusqu'à la remise à zéro annoncée (`:198-219`).

**Plafond** : aucun seuil paramétrable. Le seuil vient du fournisseur. Épuisé, le bot répond sans IA : « J'ai trop bossé aujourd'hui, je cherche un financement pour tourner 24/7. Réveillez-moi quand le budget passe. » (`message-create:22`, `:47-51`).

## 7. Axe 6 : tableau comparatif

| Dimension | `discord-agent` | 10cordes avant | 10cordes après |
|---|---|---|---|
| Boucle | `streamText`, 50 étapes, un outil forcé par tour, réponse par outil | `AgentLoop`, 12 itérations, synthèse forcée au plafond, réponse streamée | inchangé |
| Jeu d'outils | 160 outils Discord fins, filtré par message | 171 tools, noyau de 20 depuis le 24/11 (primitives épinglées), plus sélection par pertinence | noyau de 14 au moment du benchmark |
| Outils qui modifient | 69 jamais exposés, 26 directs, 14 destructifs | 14 destructifs, exécutables par le modèle, bloqués par une règle de serveur | 14 destructifs, exécution par le seul plan approuvé quand la règle est active |
| Approbation | plan de 1 à 10 actions, boutons Appliquer / Annuler | un panneau par tool, le clic pose une clé en cache | un plan par demande, boutons ✅ Appliquer / ❌ Annuler |
| Qui exécute après le clic | le code, séquentiellement, sans modèle | le modèle, s'il relance le tool lui-même | le code, séquentiellement, sans modèle |
| Revalidation au clic | même fonction, membre rechargé | permissions du membre au moment de la demande | `ActionPlanPolicy` : permissions dans le serveur et dans le salon, hiérarchie, identifiants, membre rechargé |
| Porte fermée par défaut | oui (outil masqué) | non (règle illisible : la porte s'ouvre) | oui |
| Trace | aucune sur succès | audit de chaque appel, succès ou refus | plus `plan.staged`, `plan.posted`, `plan.action`, `plan.executed` |
| Retour arrière | aucun, arrêt au premier échec | instantané du serveur avant le premier tool structurel | instantané du serveur avant le plan entier |
| Lecture des salons | filtrée à ce que le demandeur voit | `getChannels` rend tous les salons du bot | filtrée par `ChannelVisibilityPolicy` |
| Hiérarchie des cibles | membres et rôles, pas la voix | non | membres et rôles, à la validation d'un plan |
| Investigation | silencieuse par construction | chaque tool raconté dans la ligne de statut | les lectures de recherche se taisent, une ligne unique |
| Sources | liens Markdown intégrés, jamais d'URL nue | sources non citées sauf demande | inchangé, avec la mise en forme quand elles sont demandées |
| Mémoire, compétences | tables mortes | fiches consolidées, 135 recettes, apprentissage | inchangé |
| Règles de serveur | aucune en code | `GuildRule` : zones, mention stricte, confirmation, salons muets | inchangé |
| Fournisseurs | un, OpenRouter | quatre protocoles, routes par capacité, repli | inchangé |
| File d'attente | aucune | FIFO par utilisateur, durable | inchangé |

## 8. Transposition retenue

**Pris, et livré dans ce chantier :**

1. **Plans d'action** (`modules/action-plan/`). Les actions destructives d'une demande sont regroupées derrière une seule approbation. La porte du registry (`tool-registry.confirm.ts`) les met en attente au lieu de poster un panneau par tool ; `AssistantService` les transforme en un plan à la fin de la demande ; le clic exécute.
2. **Revalidation déterministe au clic** (`core/security/action-plan.policy.ts`). Permission de l'outil dans le serveur et dans le salon visé, hiérarchie de la cible, rôle géré, identifiants bien formés, compte suspendu, sur le membre rechargé. Une action refusée arrête le plan, avec un compte honnête.
3. **Prise unique**. Le statut du plan est son `kind` en base : `lock` ne réussit qu'une fois, un deuxième clic ou une annulation concurrente le trouvent pris.
4. **Porte fermée par défaut.** Règles du serveur illisibles : l'action destructrice reste bloquée. Avant, la porte s'ouvrait.
5. **Visibilité des salons** (`ChannelVisibilityPolicy`). `getChannels` ne rend que les salons que le demandeur voit.
6. **Hiérarchie** (`MemberPermissionPolicy`). Agir sur une cible, gérer un rôle, accorder une permission, permission dans un salon.
7. **Investigation silencieuse** (`assistant/investigation.policy.ts`). Une ligne unique `[SOURCES]` à la première lecture de recherche, puis rien.
8. **Deux règles de prompt** : réponse de recherche dès la première phrase, sources en liens intégrés quand elles sont demandées ; approbation par plan sans confirmation par message.

**Adapté plutôt que copié :**

- **Le modèle ne propose pas le plan par un outil dédié.** Chez `discord-agent`, `proposeDiscordActions` porte tout le plan. Chez nous, les tools s'appellent un par un : la porte accumule, la fin de demande regroupe. Même résultat, aucun changement à la façon dont le modèle travaille.
- **Le plan est affiché une fois, jamais réédité pendant l'attente.** `discord-agent` refuse un message d'approbation modifié. Comme notre panneau n'est édité qu'une fois terminé, le même contrôle s'applique : message modifié, plan annulé.
- **Retour arrière.** `discord-agent` n'en a pas. Nous archivons un instantané du serveur avant le plan entier, comme avant le premier tool structurel.
- **Le tracé.** Chaque étape d'un plan est auditée, là où `discord-agent` ne journalise que les échecs.

**Écarté, et pourquoi :**

- Un outil par tour et une réponse par outil : notre boucle streame la réponse, l'utilisateur voit le texte venir.
- `toolChoice: "required"` : chez nous, la synthèse forcée au plafond a causé l'incident de 20:09.
- Le cron de quota : nous avons les erreurs typées par fournisseur et un fournisseur de repli.
- La catégorie AGENTS sans restriction : elle n'est codée nulle part là-bas, et nos règles de serveur sont en code.
- Le filtrage de tous les résultats de lecture : appliqué à `getChannels` seul dans ce chantier.

## 9. Ce qui reste ouvert

- **Le clic sur ✅ / ❌ n'est pas simulable** depuis un rig (interaction Discord réelle). Les handlers sont couverts par leurs tests unitaires ; le scénario live `rule.confirm` vérifie le blocage et le panneau, pas l'exécution.
- **Autres énumérations de salons** : `server-activity.tools.ts`, `serverlife-moderation.tools.ts` et le résolveur de noms de `tool-support.ts` parcourent encore tous les salons du bot. Le résolveur permet de sonder l'existence d'un salon caché par son nom.
- **Hiérarchie de la voix** : les outils vocaux ne vérifient pas la position de la cible, ni là-bas (`discord-permissions.ts:336-350`) ni ici.
- **Plans en pause.** Un plan en attente n'est pas affiché tant que la demande n'est pas finie : une demande très longue retarde d'autant le panneau.
- **Panels d'approbation expirés.** Les boutons restent visibles après 15 minutes, comme à l'origine. Le clic répond alors « expiré ».
