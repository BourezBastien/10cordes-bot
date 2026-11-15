# Politique de Confidentialité - 10cordes-bot

Dernière mise à jour : 15 novembre 2026

## 1. Principe

10cordes-bot est un logiciel open source auto-hébergé. Toutes les données traitées par le bot sont stockées sur l'infrastructure de l'Opérateur de l'instance que vous utilisez, et non sur une plateforme cloud tierce. L'Opérateur est le responsable de traitement au sens du RGPD pour son instance.

## 2. Données collectées

Selon les modules activés par le staff de votre serveur, le bot peut stocker :

| Donnée | Finalité | Module |
|---|---|---|
| Identifiants Discord (ID serveur, ID utilisateur, ID salon/rôle) | Configuration, permissions, whitelists | Tous |
| Configuration du serveur (salons, rôles, langue par défaut, templates) | Fonctionnement des modules | Configuration |
| Préférence de langue par utilisateur | Affichage dans votre langue | i18n |
| Messages de bienvenue/départ et compteurs | Annonces et jalons | Welcome |
| Journaux d'événements (salons, rôles, modération) et cases de modération | Traçabilité staff | Logging, Modération |
| XP et niveaux par utilisateur | Système de niveaux et récompenses | Leveling |
| Tickets : identifiants, statut, transcript texte des conversations du ticket | Support et qualité du staff | Tickets |
| Tags personnalisés (contenu défini par le staff) | Commandes personnalisées | Tags |
| Journal d'audit des actions (acteur, action, cible, horodatage) | Traçabilité et sécurité | Audit |
| Requêtes et coûts des appels IA (si module IA activé) | Budget et transparence | IA |

## 3. Contenus de messages

Le bot ne stocke pas le contenu des messages des canaux en dehors des fonctions suivantes, activées par le staff :

- Salons de logs (copies des messages supprimés/modifiés, si activé).
- Transcripts de tickets (texte des conversations du ticket).
- Lecture temporaire du contexte récent d'un canal pour la réponse de l'assistant IA (non persistée, activée par le staff).

## 4. Ce que nous ne faisons pas

- Aucune revente de données.
- Aucune publicité.
- Aucun partage avec des tiers à des fins commerciales.
- Les appels IA (optionnels) n'envoient que le contexte nécessaire au traitement de votre demande, vers le fournisseur configuré par l'Opérateur.

## 5. Vos droits (RGPD)

Sur un serveur utilisant le Service, vous pouvez demander à l'Opérateur de l'instance :

- L'accès et l'export des données vous concernant (commandes d'administration de l'instance).
- La suppression de vos données (niveaux, préférences, tickets fermés). La demande est transmise au staff, qui dispose des commandes de purge.
- La rectification via les commandes de configuration.

Les journaux de modération relatifs à des sanctions à votre encontre sont conservés pour l'intérêt légitime du serveur, dans la limite définie par l'Opérateur.

## 6. Conservation

Les données sont conservées tant que le bot est présent sur le serveur. Au retrait du bot, l'Opérateur est responsable de la purge de la base (SQLite/PostgreSQL de son infrastructure).

## 7. Sécurité

- Identifiants du bot et secrets stockés hors du code, en variables d'environnement.
- Journalisation avec masquage automatique des tokens.
- Accès à l'API d'administration protégé par authentification Discord et vérification des permissions ManageGuild/Administrator.

## 8. Contact

Pour toute question relative à cette politique : contactez l'Opérateur de votre instance, ou le serveur de support officiel du projet.
