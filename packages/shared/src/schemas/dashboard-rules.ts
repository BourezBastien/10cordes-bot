import { z } from 'zod';
import { SnowflakeSchema, USAGE_WINDOWS, UsageWindowSchema } from './dashboard-common.js';

/**
 * Règles du serveur et usage de l'agent : contrat des routes
 * `/api/v1/guilds/:guildId/rules`, `/usage` et `/agent-settings`. Les règles
 * sont les mêmes que celles de l'outil `rules.set` (en vigueur dans la gate,
 * le registry et le prompt).
 */

const InstructionSchema = z.string().trim().min(3).max(300);

/** Les règles en vigueur sur un serveur. */
export const GuildRulesSchema = z.object({
  freeCategoryIds: z.array(SnowflakeSchema).max(20),
  freeChannelIds: z.array(SnowflakeSchema).max(50),
  blockedChannelIds: z.array(SnowflakeSchema).max(50),
  strictMentionElsewhere: z.boolean(),
  seriousOnlyElsewhere: z.boolean(),
  /** Règle « Confirmer les actions (hors lecture) » : toute action qui modifie attend le clic du demandeur. */
  confirmDestructiveActions: z.boolean(),
  customInstructions: z.array(InstructionSchema),
});
export type GuildRules = z.infer<typeof GuildRulesSchema>;

/** Patch partiel des règles ; seuls les champs fournis changent. */
export const GuildRulesPatchSchema = z
  .object({
    freeCategoryIds: z.array(SnowflakeSchema).max(20).optional(),
    freeChannelIds: z.array(SnowflakeSchema).max(50).optional(),
    blockedChannelIds: z.array(SnowflakeSchema).max(50).optional(),
    strictMentionElsewhere: z.boolean().optional(),
    seriousOnlyElsewhere: z.boolean().optional(),
    confirmDestructiveActions: z.boolean().optional(),
    addCustomInstructions: z.array(InstructionSchema).max(10).optional(),
    removeCustomInstructions: z.array(z.string().min(3).max(300)).max(10).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), 'Aucun champ à changer.');
export type GuildRulesPatch = z.infer<typeof GuildRulesPatchSchema>;

/** Ce qu'un modèle a consommé sur la fenêtre. */
export const UsageByModelSchema = z.object({
  provider: z.string().nullable(),
  model: z.string(),
  turns: z.number().int().min(0),
  promptTokens: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  errors: z.number().int().min(0),
  fallbacks: z.number().int().min(0),
});
export type UsageByModel = z.infer<typeof UsageByModelSchema>;

/** Consommation d'une journée (date locale du serveur, `AAAA-MM-JJ`). */
export const UsageDaySchema = z.object({
  day: z.string(),
  turns: z.number().int().min(0),
  tokens: z.number().int().min(0),
});
export type UsageDay = z.infer<typeof UsageDaySchema>;

/** Jetons consommés par l'agent du serveur sur une fenêtre. */
export const UsageSummarySchema = z.object({
  window: UsageWindowSchema,
  turns: z.number().int().min(0),
  promptTokens: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  errors: z.number().int().min(0),
  fallbacks: z.number().int().min(0),
  byModel: z.array(UsageByModelSchema),
  byDay: z.array(UsageDaySchema),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

/** Fenêtres d'usage, avec leur durée en heures. */
export const USAGE_WINDOW_HOURS: Readonly<Record<(typeof USAGE_WINDOWS)[number], number>> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

/** Mode de raisonnement de l'agent du serveur. */
export const THINKING_MODES = ['adaptive', 'always', 'off'] as const;
export const ThinkingModeSchema = z.enum(THINKING_MODES);
export type ThinkingMode = z.infer<typeof ThinkingModeSchema>;

export const AgentSettingsSchema = z.object({ thinkingMode: ThinkingModeSchema });
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

export const AgentSettingsPatchSchema = z.object({ thinkingMode: ThinkingModeSchema });
export type AgentSettingsPatch = z.infer<typeof AgentSettingsPatchSchema>;
