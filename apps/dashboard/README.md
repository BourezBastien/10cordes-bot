# 10cordes · tableau de bord

Panneau web de 10cordes-bot : fournisseurs IA et modèles, intégrations et
connecteurs HTTP, règles, modules, configuration, journal, mémoires,
consommation, et une conversation avec l'agent. Il parle à l'API du bot, sur
la même origine (le proxy de Vite en développement, le bot en production).

## Pile

- React 19 + TypeScript, Vite 8.
- TanStack Router (routes par le code, typées) et TanStack Query.
- Tailwind CSS 4 : les jetons du thème sont déclarés dans `@theme`
  (`src/styles/tokens.css`), les utilitaires du langage graphique dans
  `src/styles/theme.css`, les animations par pas dans `src/styles/motion.css`.
- i18next : français et anglais, clés typées à partir du fichier français.
- ApexCharts pour la consommation par jour.
- Le client better-auth pour la session (login Discord).
- Les schémas Zod de `@10cordes/shared` : chaque réponse de l'API est vérifiée
  contre le contrat.

## Lancer

```bash
pnpm dev                                  # à la racine : compile shared puis lance le bot (127.0.0.1:3000)
pnpm --filter 10cordes-dashboard dev      # Vite sur 5173, /api relayé au bot
```

Le panneau importe le `dist/` de `@10cordes/shared` : le compiler d'abord
(`pnpm --filter @10cordes/shared build`) si le bot tourne déjà.

`API_PROXY_TARGET` change la cible du proxy (par défaut
`http://127.0.0.1:3000`).

Build de production : `pnpm --filter 10cordes-dashboard build` écrit
`dist/`. Le bot le sert quand `DASHBOARD_DIST_DIR` est réglé (voir le README
du bot).

Tests : `pnpm --filter 10cordes-dashboard test` (jsdom).

## Se connecter

Le login passe par Discord et demande, côté bot, `BETTER_AUTH_SECRET`,
`DISCORD_CLIENT_ID` et `DISCORD_CLIENT_SECRET`. Sans eux, la page de
connexion s'affiche et le bouton ne peut pas aboutir : l'API répond 503 avec
la cause. Après la connexion, on revient à la page demandée quand c'est
celle d'un serveur.

## Structure

```
src/
  ds/          primitives : Button, Input, Select, Tabs, Sheet, ConfirmDialog,
               DataTable, Badge, Kpi, Feed, Process, CardList, Typed, Boot
  shell/       coque : barre haute, menu bas mobile, contexte du serveur,
               palette de recherche, panneau « plus », garde de session
  lib/         client API typé (api.ts), flux temps réel (events.ts), étapes
               d'une demande (progress.ts), requêtes, formats, i18n/
  pages/       login, guilds, guild/* (une page par onglet du serveur)
  styles/      jetons, thème, animations
  test/        outils des specs (rendu avec les fournisseurs, routes factices)
```

Chaque page d'un serveur est un morceau à part : la connexion et la liste
des serveurs ne chargent ni les graphiques ni les formulaires.

## Règles

- Aucune clé n'entre dans une page : l'API ne renvoie que `hasApiKey` et un
  indice. Une clé se saisit dans `SecretInput`, toujours masquée.
- Aucun texte écrit en dur dans un composant : tout passe par i18n. Aucune
  date ni durée formatée à la main : `lib/format.ts`.
- Une chaîne de caractères du français en source porte son apostrophe
  échappée (`\u0027`), jamais `\u0029` ; aucun tiret cadratin.
- Les zones d'appui font au moins 44 px de haut, y compris sous un dessin
  plus petit (puces, boutons de liste, interrupteurs).
- Une boîte de dialogue se ferme par `useModalDialog().close()`, jamais en
  attendant l'événement `close` de `<dialog>`.

## Vérifier une mise en page

Les captures du navigateur intégré sont intermittentes : mesurer dans la
page (débordement horizontal, textes tronqués, cibles de moins de 44 px) à
1440 px et à 390 px, contre une API factice, jamais contre le serveur de
l'owner.

Design : le langage graphique (thème sombre, hiérarchie par accents,
structure des vues) s'inspire volontairement de
[ARCHIVE-9 de LeoBdt](https://github.com/LeoBdt/ARCHIVE-9). Ce n'est pas une
copie : aucun fichier n'en est repris.
