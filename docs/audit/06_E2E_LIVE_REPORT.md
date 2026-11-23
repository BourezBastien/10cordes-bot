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
