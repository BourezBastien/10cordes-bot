import { z } from 'zod';

/**
 * Temps réel du panel : ce que le flux d'UN serveur
 * (`GET /api/v1/guilds/:guildId/events`) pousse au dashboard. Un événement ne
 * dit RIEN d'autre que son type : ni serveur, ni identifiant, ni contenu. Il
 * sert à une seule chose, invalider les requêtes du serveur affiché ; le
 * dashboard relit ensuite ce qu'il a le droit de lire.
 */

export const DASHBOARD_EVENT_TYPES = [
  'provider.updated',
  'capability.updated',
  'integration.updated',
  'webhook.updated',
  'rules.updated',
] as const;
export const DashboardEventTypeSchema = z.enum(DASHBOARD_EVENT_TYPES);
export type DashboardEventType = z.infer<typeof DashboardEventTypeSchema>;

export const DashboardEventSchema = z.object({ type: DashboardEventTypeSchema });
export type DashboardEvent = z.infer<typeof DashboardEventSchema>;

/** Intervalle entre deux signaux de vie du flux (le flux reste ouvert derrière un proxy). */
export const SSE_PING_INTERVAL_MS = 25_000;
