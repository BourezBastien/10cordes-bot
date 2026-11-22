import { z } from 'zod';

/**
 * Ops d'administration Discord — union discriminée Zod.
 * Le LLM ne fait que REMPLIR ces schémas (jamais les contourner) : chaque op
 * est validée puis gated par les permissions du demandeur et du bot dans
 * AgentService.executeDirect (exécution directe, décision produit du 17/11).
 */
export const AdminOpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('channel.create'),
    name: z.string().min(1).max(100),
    kind: z.enum(['text', 'voice', 'category']).default('text'),
    topic: z.string().max(1024).optional(),
  }),
  z.object({
    type: z.literal('channel.rename'),
    channelId: z.string().min(1),
    name: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal('channel.archive'),
    /** Archivage = renommage `archive-…` + snapshot des métadonnées (jamais une suppression). */
    channelId: z.string().min(1),
  }),
  z.object({
    type: z.literal('channel.delete'),
    channelId: z.string().min(1),
  }),
  z.object({
    type: z.literal('role.create'),
    name: z.string().min(1).max(100),
    color: z.number().int().min(0).max(0xffffff).optional(),
  }),
  z.object({
    type: z.literal('role.rename'),
    roleId: z.string().min(1),
    name: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal('role.delete'),
    roleId: z.string().min(1),
  }),
  z.object({
    type: z.literal('member.timeout'),
    userId: z.string().min(1),
    durationMs: z.number().int().min(1_000).max(28 * 24 * 60 * 60 * 1_000),
    reason: z.string().max(512).optional(),
  }),
  z.object({
    type: z.literal('member.kick'),
    userId: z.string().min(1),
    reason: z.string().max(512).optional(),
  }),
  z.object({
    type: z.literal('member.ban'),
    userId: z.string().min(1),
    reason: z.string().max(512).optional(),
  }),
]);

export type AdminOp = z.infer<typeof AdminOpSchema>;

export function opLabel(op: AdminOp): string {
  switch (op.type) {
    case 'channel.create': return `Créer le salon **${op.name}** (${op.kind})`;
    case 'channel.rename': return `Renommer <#${op.channelId}> en **${op.name}**`;
    case 'channel.archive': return `Archiver <#${op.channelId}>`;
    case 'channel.delete': return `Supprimer <#${op.channelId}> (archivé avant suppression)`;
    case 'role.create': return `Créer le rôle **${op.name}**${op.color !== undefined ? ` (#${op.color.toString(16)})` : ''}`;
    case 'role.rename': return `Renommer le rôle <@&${op.roleId}> en **${op.name}**`;
    case 'role.delete': return `Supprimer le rôle <@&${op.roleId}>`;
    case 'member.timeout': return `Exclure temporairement <@${op.userId}> ${Math.round(op.durationMs / 60_000)} min`;
    case 'member.kick': return `Expulser <@${op.userId}>`;
    case 'member.ban': return `Bannir <@${op.userId}>`;
  }
}
