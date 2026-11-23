import { z } from 'zod';

export const SupportedLocale = z.enum(['fr', 'en']);
export type SupportedLocaleValue = z.infer<typeof SupportedLocale>;

export const WelcomeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: z.string().nullable().default(null),
  template: z.string().default('Bienvenue {{user.mention}} sur **{{server.name}}** !'),
  cardEnabled: z.boolean().default(false),
  /** Supprimer le message de bienvenue si le membre quitte peu après. */
  deleteOnLeave: z.boolean().default(false),
  /** Rôle automatique attribué à l'arrivée. */
  autoRoleId: z.string().nullable().default(null),
});
export type WelcomeConfig = z.infer<typeof WelcomeConfigSchema>;

export const FarewellConfigSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: z.string().nullable().default(null),
  template: z.string().default('{{user.name}} a quitté le serveur. Membres : {{member.count}}'),
});
export type FarewellConfig = z.infer<typeof FarewellConfigSchema>;

export const LOG_CATEGORIES = ['messages', 'members', 'voice', 'moderation', 'server'] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

export const LogsConfigSchema = z.object({
  /** Salon par catégorie de log (absent = catégorie désactivée). */
  channels: z.record(z.string(), z.string()).default({}),
  /** Rôles exclus des logs de rôles (ex: rôles soutien auto-attribués). */
  ignoredRoles: z.array(z.string()).default([]),
});
export type LogsConfig = z.infer<typeof LogsConfigSchema>;

export const TicketsConfigSchema = z.object({
  /** Catégorie parente des salons de ticket. */
  categoryId: z.string().nullable().default(null),
  /** Salon où poster le panneau d'ouverture. */
  panelChannelId: z.string().nullable().default(null),
  /** Rôle staff (peut claim/close). */
  staffRoleId: z.string().nullable().default(null),
  /** Salon recevant transcripts et summaries. */
  logChannelId: z.string().nullable().default(null),
});
export type TicketsConfig = z.infer<typeof TicketsConfigSchema>;

export const ReactionRolesConfigSchema = z.object({
  /** Rôles proposés dans le menu (max 25). */
  roleIds: z.array(z.string()).default([]),
  /** Salon + message du panneau posté (permet l'édition live). */
  panelChannelId: z.string().nullable().default(null),
  panelMessageId: z.string().nullable().default(null),
  panelTitle: z.string().default('🎭 Choisis tes rôles'),
});
export type ReactionRolesConfig = z.infer<typeof ReactionRolesConfigSchema>;

export const LevelRewardSchema = z.object({
  level: z.number().int().min(1),
  roleId: z.string().min(1),
});

export const LevelsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  xpPerMessage: z.number().int().min(1).max(500).default(15),
  /** Cooldown d'XP par utilisateur (minutes). */
  cooldownMinutes: z.number().int().min(0).max(60).default(1),
  /** Salon d'annonce des level-ups (null = dans le canal courant). */
  announceChannelId: z.string().nullable().default(null),
  /** Rôles-récompenses par palier de niveau (le LLM/agent peut les proposer, 13✅). */
  roleRewards: z.array(LevelRewardSchema).default([]),
});
export type LevelsConfig = z.infer<typeof LevelsConfigSchema>;

export const ModerationConfigSchema = z.object({
  /** Salon réservé aux sanctions — null = partout. */
  sanctionChannelId: z.string().nullable().default(null),
  /** Retirer les rôles pendant un mute, les restituer à la fin. */
  muteDerank: z.boolean().default(false),
});
export type ModerationConfig = z.infer<typeof ModerationConfigSchema>;

export const AssistantConfigSchema = z.object({
  /**
   * Salon dédié à l'assistant IA (agentic). Vide/null = le bot répond à sa
   * mention dans tous les salons ; défini = il ne répond que dans ce salon.
   */
  channelId: z
    .string()
    .refine((v) => v === '' || /^\d{15,21}$/.test(v), 'Must be a channel ID or empty')
    .default(''),
});
export type AssistantConfig = z.infer<typeof AssistantConfigSchema>;

/** Gate de vérification anti-raid à l'arrivée (captcha math via modal). */
export const SecurityConfigSchema = z.object({
  /** Gate activé : tout nouveau membre doit se vérifier sinon kick. */
  verificationEnabled: z.boolean().default(false),
  /** Salon où poster le message de vérification (null = le salon système). */
  verificationChannelId: z.string().nullable().default(null),
  /** Rôle attribué après vérification réussie. */
  verifiedRoleId: z.string().nullable().default(null),
  /** Kick si non vérifié après N minutes (0 = jamais kick). */
  kickMinutes: z.number().int().min(0).max(120).default(5),
});
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

/**
 * Configuration d'un serveur — un seul document JSON typé (pattern single-document).
 * Tout champ manquant est comblé par les defaults Zod : l'évolution du schéma
 * ne nécessite pas de migration pour les nouvelles options.
 */
export const GuildConfigSchema = z.object({
  /** Langue par défaut du serveur (annonces, welcome). Les users gardent leur propre langue. */
  defaultLocale: SupportedLocale.default('fr'),
  welcome: WelcomeConfigSchema.prefault({}),
  farewell: FarewellConfigSchema.prefault({}),
  logs: LogsConfigSchema.prefault({}),
  tickets: TicketsConfigSchema.prefault({}),
  roles: ReactionRolesConfigSchema.prefault({}),
  levels: LevelsConfigSchema.prefault({}),
  moderation: ModerationConfigSchema.prefault({}),
  assistant: AssistantConfigSchema.prefault({}),
  security: SecurityConfigSchema.prefault({}),
  /** Messages d'erreur personnalisés par code — template avec placeholders de l'exception. */
  errorMessages: z.record(z.string(), z.string()).default({}),
});
export type GuildConfig = z.infer<typeof GuildConfigSchema>;

/** Clé de configuration éditable via /config set (registre explicite, pilote l'autocomplétion). */
export interface ConfigKeyDescriptor {
  /** Chemin dans le document, ex: "welcome.channelId". */
  path: string;
  type: 'string' | 'boolean' | 'number' | 'channel' | 'role' | 'locale';
  description: string;
}

export const CONFIG_KEYS: ConfigKeyDescriptor[] = [
  { path: 'defaultLocale', type: 'locale', description: 'Langue par défaut du serveur' },
  { path: 'welcome.enabled', type: 'boolean', description: 'Activer les messages de bienvenue' },
  { path: 'welcome.channelId', type: 'channel', description: 'Salon des messages de bienvenue' },
  { path: 'welcome.template', type: 'string', description: 'Template du message de bienvenue' },
  { path: 'welcome.cardEnabled', type: 'boolean', description: 'Carte image de bienvenue' },
  { path: 'welcome.deleteOnLeave', type: 'boolean', description: 'Supprimer le message si le membre quitte' },
  { path: 'welcome.autoRoleId', type: 'role', description: "Rôle automatique à l'arrivée" },
  { path: 'farewell.enabled', type: 'boolean', description: 'Activer les messages de départ' },
  { path: 'farewell.channelId', type: 'channel', description: 'Salon des messages de départ' },
  { path: 'farewell.template', type: 'string', description: 'Template du message de départ' },
  { path: 'moderation.sanctionChannelId', type: 'channel', description: 'Salon réservé aux sanctions' },
  { path: 'moderation.muteDerank', type: 'boolean', description: 'Retirer les rôles pendant un mute' },
  { path: 'tickets.categoryId', type: 'channel', description: 'Catégorie des salons de ticket' },
  { path: 'tickets.panelChannelId', type: 'channel', description: 'Salon du panneau de tickets' },
  { path: 'tickets.staffRoleId', type: 'role', description: 'Rôle staff des tickets' },
  { path: 'tickets.logChannelId', type: 'channel', description: 'Salon des transcripts de tickets' },
  { path: 'assistant.channelId', type: 'channel', description: "Salon dédié de l'IA (vide = mention dans tous les salons)" },
  { path: 'levels.enabled', type: 'boolean', description: 'XP et niveaux actifs sur les messages' },
  { path: 'levels.xpPerMessage', type: 'number', description: "XP gagné par message (cooldown passé)" },
  { path: 'levels.announceChannelId', type: 'channel', description: 'Salon des annonces de level-up (vide = salon courant)' },
  { path: 'security.verificationEnabled', type: 'boolean', description: 'Gate de vérification à l\u0027arrivée (captcha math)' },
  { path: 'security.verificationChannelId', type: 'channel', description: 'Salon du message de vérification' },
  { path: 'security.verifiedRoleId', type: 'role', description: 'Rôle attribué après vérification' },
  { path: 'security.kickMinutes', type: 'number', description: 'Kick si non vérifié après N minutes (0 = jamais)' },
];
