import { z } from 'zod';
import { SnowflakeSchema } from '@10cordes/shared';

/*
 * FORME DES RÉPONSES de l'API que le dashboard lit, hors contrat du Lot 2
 * (qui vit dans @10cordes/shared). Chaque lecture passe par un de ces
 * schémas : une réponse qui n'y ressemble pas est refusée, jamais affichée.
 */

/** Un instant : ISO en JSON, ou epoch millisecondes. */
export const InstantSchema = z.union([z.string(), z.number()]);

export const GuildSummarySchema = z.object({
  id: SnowflakeSchema,
  name: z.string(),
  /** URL complète de l'icône, ou rien. */
  icon: z.string().nullable(),
  memberCount: z.number().int(),
  canManage: z.boolean().optional(),
});
export type GuildSummary = z.infer<typeof GuildSummarySchema>;

export const GuildListSchema = z.object({ guilds: z.array(GuildSummarySchema) });

export const GuildDetailSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  icon: z.string().nullable(),
  memberCount: z.number().int().nullable(),
});

export const ChannelLiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.number().int(),
  category: z.string().nullable(),
});
export type ChannelLite = z.infer<typeof ChannelLiteSchema>;

export const ChannelListSchema = z.object({ channels: z.array(ChannelLiteSchema) });

export const RoleLiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.number().int(),
});
export type RoleLite = z.infer<typeof RoleLiteSchema>;
export const RoleListSchema = z.object({ roles: z.array(RoleLiteSchema) });

const ModuleRefSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  dependsOn: z.array(z.string()).optional(),
  optionalDeps: z.array(z.string()).optional(),
  recommends: z.array(z.string()).optional(),
});

export const GuildModuleSchema = ModuleRefSchema.extend({
  globalEnabled: z.boolean(),
  guildEnabled: z.boolean().nullable(),
});
export type GuildModule = z.infer<typeof GuildModuleSchema>;

export const ModuleListSchema = z.object({ modules: z.array(GuildModuleSchema) });

export const ModuleToggleResultSchema = z.object({
  applied: z.boolean().optional(),
  enabled: z.array(z.string()).optional(),
  cascade: z
    .object({
      toDisable: z.array(z.string()),
      kept: z.array(z.string()),
    })
    .optional(),
});
export type ModuleToggleResult = z.infer<typeof ModuleToggleResultSchema>;

export const AuditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string().nullable(),
  metadata: z.string(),
  createdAt: InstantSchema,
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditPageSchema = z.object({
  entries: z.array(AuditEntrySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  pages: z.number().int(),
});

const MemoryEntrySchema = z.object({
  id: z.string(),
  kind: z.string(),
  content: z.string(),
  createdAt: InstantSchema,
});

export const MemoriesSchema = z.object({
  guild: z.array(MemoryEntrySchema),
  members: z.array(MemoryEntrySchema.extend({ userId: z.string() })),
});

export const StatsSchema = z.object({
  windowDays: z.number().int(),
  auditByAction: z.array(z.object({ action: z.string(), count: z.number().int() })),
  topXp: z.array(z.object({ userId: z.string(), level: z.number().int(), xp: z.number().int() })),
  moderation: z.object({
    cases14d: z.number().int(),
    byAction: z.array(z.object({ action: z.string(), count: z.number().int() })),
  }),
});

export const ChatToolSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  summary: z.string(),
});
export type ChatTool = z.infer<typeof ChatToolSchema>;

export const ChatResultSchema = z.object({
  reply: z.string().nullable(),
  silent: z.boolean(),
  tools: z.array(ChatToolSchema),
});
export type ChatResult = z.infer<typeof ChatResultSchema>;

/** Le document de configuration : un objet libre, lu et écrit par chemins. */
export const ConfigDocumentSchema = z.record(z.string(), z.unknown());
