import type { GuildMember, PartialGuildMember } from 'discord.js';
import { z } from 'zod';

/**
 * Contrat des automatisations créées par l'agent : types de déclencheurs,
 * schémas Zod (filtre, action, création) et formes des lignes et des
 * événements. Partagé par le service, l'exécuteur, les tools et les jobs.
 */

export const TRIGGER_TYPES = ['message.created', 'member.joined', 'member.left', 'channel.created'] as const;

const TriggerFilterSchema = z
  .object({
    channelId: z.string().optional(),
    contains: z.string().max(200).optional(),
  })
  .strict();

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sendMessage'),
    channelId: z.string(),
    content: z.string().min(1).max(1500),
  }),
  z.object({
    type: z.literal('sendDm'),
    content: z.string().min(1).max(1500),
  }),
  z.object({
    type: z.literal('addRole'),
    roleId: z.string(),
  }),
  z.object({
    type: z.literal('removeRole'),
    roleId: z.string(),
  }),
]);

export const CreateSchema = z.object({
  name: z.string().min(3).max(100),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerFilter: TriggerFilterSchema.default({}),
  actions: z.array(ActionSchema).min(1).max(5),
});

export interface AgentAutomationRow {
  id: string;
  name: string;
  triggerType: string;
  triggerFilter: string;
  actions: string;
  enabled: boolean;
  createdByUserId: string;
}

/** Contexte d'exécution passé par les listeners. */
export interface AutomationEventContext {
  guildId: string;
  channelId: string;
  userId?: string;
  member?: GuildMember | PartialGuildMember;
}
