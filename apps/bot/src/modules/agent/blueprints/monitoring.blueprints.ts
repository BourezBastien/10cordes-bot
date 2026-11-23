import type { SkillBlueprint } from '@10cordes/shared';
import { chan, num, str, type DomainBlueprints } from './blueprint.helpers';

/** MONITORING & STATS (13) : santé, sondes, rapports, alertes. */
export const monitoringBlueprints: DomainBlueprints = [
  {
    slug: 'auto-weekly-staff-report',
    domain: 'monitoring',
    tags: ['rapport hebdo', 'dimanche', 'staff', 'nouveaux membres', 'tickets', 'sanctions'],
    trigger: 'Résumé hebdomadaire automatique pour le staff',
    params: {
      staffChannelId: chan('Salon staff où poster'),
      cronSchedule: str('Horaire (ex : dimanches 20h = 0 20 * * 0)', '0 20 * * 0'),
    },
    requiredTools: ['trigger.schedule', 'surface.create', 'activity.summary', 'sendMessage'],
    workflow: '1. trigger.schedule cron. 2. À l\u0029exécution : activity.summary (7 jours) + records.search sur tickets fermés + sanctions. 3. Publier un panneau V2 structuré dans le salon staff.',
  },
  {
    slug: 'game-server-status-board',
    domain: 'monitoring',
    tags: ['serveur jeu', 'FiveM', 'Minecraft', 'statut', 'en ligne', 'hors ligne'],
    trigger: 'Tableau de bord du statut de serveurs de jeu (ping périodique)',
    params: {
      servers: str('Serveurs au format jeu:host séparés par virgules', 'minecraft:play.example.com, fivem:rp.example.com'),
      refreshMinutes: num('Minutes entre chaque ping', 5),
    },
    requiredTools: ['surface.create', 'trigger.schedule', 'surface.updateComponent', 'server.status'],
    workflow: '1. surface.create avec un TextDisplay par serveur. 2. trigger.schedule interval refreshMinutes : server.status pour chaque serveur + surface.updateComponent (🟢/🔴 + joueurs).',
  },
  {
    slug: 'member-count-channel',
    domain: 'monitoring',
    tags: ['compteur membres', 'salon vocal', 'mise à jour auto', 'statistiques'],
    trigger: 'Salon vocal qui affiche le nombre de membres et se met à jour',
    params: {
      format: str('Format du nom ({{count}} remplacé)', '👥 Membres : {{count}}'),
      refreshMinutes: num('Minutes entre chaque mise à jour', 10),
    },
    requiredTools: ['createChannel', 'renameChannel', 'trigger.schedule'],
    workflow: '1. createChannel vocal verrouillé avec le format initial. 2. trigger.schedule interval refreshMinutes : renameChannel avec le count actualisé (rate-limit Discord 2/10min respecté).',
  },
  {
    slug: 'top-players-leaderboard-refresh',
    domain: 'monitoring',
    tags: ['classement', 'leaderboard', 'top', 'XP', 'activité', 'rafraîchit'],
    trigger: 'Classement des membres les plus actifs qui se met à jour automatiquement',
    params: {
      leaderboardChannelId: chan('Salon du classement'),
      refreshHours: num('Heures entre chaque rafraîchissement', 1),
      topCount: num('Nombre de membres affichés', 10),
    },
    requiredTools: ['surface.create', 'trigger.schedule', 'activity.summary', 'surface.updateComponent'],
    workflow: '1. surface.create avec le classement initial (activity.summary). 2. trigger.schedule interval refreshHours : re-appeler activity.summary + surface.updateComponent avec les nouvelles positions.',
  },
  {
    slug: 'role-admin-alert',
    domain: 'monitoring',
    tags: ['rôle admin', 'alerte', 'permission Administrator', 'sécurité'],
    trigger: 'Alerte immédiate quand quelqu\u0027obtient un rôle avec la permission Administrateur',
    params: {
      ownerId: str('ID du propriétaire à alerter', ''),
    },
    requiredTools: ['sendMessage', 'sendDirectMessage'],
    workflow: '1. EventTrigger member.update (roleId avec Administrator). 2. sendDirectMessage au owner avec le nom du membre et le rôle. 3. sendMessage rouge dans un salon staff.',
  },
  {
    slug: 'channel-growth-graph-daily',
    domain: 'monitoring',
    tags: ['croissance', 'graphique', 'messages par jour', 'tendance', 'snapshot'],
    trigger: 'Graphique quotidien de croissance (messages/jour sur 30 jours)',
    params: {
      statsChannelId: chan('Salon des stats'),
    },
    requiredTools: ['trigger.schedule', 'getLastSnapshot', 'activity.summary', 'image.compose', 'surface.create'],
    workflow: '1. trigger.schedule quotidien : snapshot (records). 2. getLastSnapshot + activity.summary : delta messages/membres. 3. image.compose : courbe 30 jours. 4. surface.create avec l\u0029image en pièce jointe unique.',
  },
  {
    slug: 'uptime-health-dashboard',
    domain: 'monitoring',
    tags: ['uptime', 'santé', 'latence', 'API', 'watchdog'],
    trigger: 'Tableau de santé technique du bot, rafraîchi périodiquement',
    params: {
      refreshMinutes: num('Minutes entre chaque rafraîchissement', 5),
      adminChannelId: chan('Salon admin'),
    },
    requiredTools: ['surface.create', 'trigger.schedule', 'surface.updateComponent', 'getAIStatus'],
    workflow: '1. surface.create : uptime, latence gateway, statut LLM (getAIStatus), queue, erreurs 24h. 2. trigger.schedule interval : surface.updateComponent des métriques. 3. Seuil d\u0029erreur dépassé : ping admin.',
  },
  {
    slug: 'mod-actions-log-stats',
    domain: 'monitoring',
    tags: ['modération', 'stats', 'par modérateur', 'cases', 'équité'],
    trigger: 'Statistiques d\u0029actions de modération par modérateur (équité de charge)',
    params: {
      staffChannelId: chan('Salon staff'),
    },
    requiredTools: ['getCases', 'surface.create', 'trigger.schedule'],
    workflow: '1. getCases (30 jours). 2. GroupBy modérateur + type d\u0029action. 3. surface.create : tableau par modérateur (warns, mutes, bans, temps moyen de réponse). 4. trigger.schedule mensuel.',
  },
  {
    slug: 'join-leave-flow-trend',
    domain: 'monitoring',
    tags: ['joins', 'départs', 'rétention', 'tendance', 'flux'],
    trigger: 'Suivi du flux joins/départs et du taux de rétention',
    params: {
      reportChannelId: chan('Salon du rapport'),
    },
    requiredTools: ['records.create', 'records.search', 'surface.create', 'trigger.schedule', 'analyzeActivity'],
    workflow: '1. EventTriggers member.join / member.remove : records.create collections joins/leaves { userId, at }. 2. trigger.schedule hebdo : agrégats + rétention à J+7/J+30 (records croisés). 3. surface.create : flux net, top salons d\u0029arrivée, alerte si départ massif.',
  },
  {
    slug: 'llm-cost-monthly-report',
    domain: 'monitoring',
    tags: ['coût', 'LLM', 'tokens', 'budget', 'facture', 'mois'],
    trigger: 'Rapport mensuel des coûts LLM par cause et par serveur',
    params: {
      financeChannelId: chan('Salon des coûts'),
    },
    requiredTools: ['trigger.schedule', 'surface.create', 'getAuditLogs'],
    workflow: '1. trigger.schedule (1er du mois). 2. getAuditLogs filtrés llm.* + comptabilité usage (cause-typed). 3. surface.create : tokens, coût estimé, top causes (reply/web/consolidation/ingestion), top membres consommateurs.',
  },
  {
    slug: 'website-uptime-probe',
    domain: 'monitoring',
    tags: ['site web', 'uptime', 'sonde', 'http', 'isodown'],
    trigger: 'Sonder un site web périodiquement et alerter s\u0029il tombe',
    params: {
      url: str('URL à surveiller', ''),
      pollMinutes: num('Minutes entre chaque sonde', 5),
      alertChannelId: chan('Salon d\u0029alerte'),
    },
    requiredTools: ['http.fetch', 'trigger.schedule', 'sendMessage', 'surface.create'],
    workflow: '1. trigger.schedule interval pollMinutes : http.fetch (timeout 10s, host validé). 2. Statut != 2xx/3xx 2 fois de suite : sendMessage alerte (status, latence). 3. Retour à la normale : message de résolution + durée de l\u0029incident.',
  },
  {
    slug: 'snow-alert-weather-region',
    domain: 'monitoring',
    tags: ['météo', 'alerte', 'pluie', 'neige', 'région'],
    trigger: 'Alerte météo automatique pour une ville (pluie/neige prévue)',
    params: {
      city: str('Ville', 'Paris'),
      checkCron: str('Rythme de vérification', '0 7 * * *'),
      alertChannelId: chan("Salon d'annonce"),
    },
    requiredTools: ['getWeather', 'trigger.schedule', 'sendMessage'],
    workflow: '1. trigger.schedule cron checkCron : getWeather (jour + prévisions). 2. Condition météo notable (pluie forte, neige, canicule) : sendMessage avec détails + conseils. 3. Sinon : silence (pas de spam quotidien).',
  },
  {
    slug: 'audit-trail-search-interface',
    domain: 'monitoring',
    tags: ['audit', 'recherche', 'qui a fait quoi', 'investigation', 'historique'],
    trigger: 'Interface de recherche dans les logs d\u0029audit par action, cible ou période',
    params: {},
    requiredTools: ['getAuditLogs', 'surface.create', 'records.search'],
    workflow: '1. Demande conversationnelle (« qui a supprimé le salon X hier ? »). 2. getAuditLogs filtrés (action, période, cible). 3. surface.create : timeline lisible (quoi, qui, quand, détails). 4. Export possible en pièce jointe si volumineux.',
  },
];
