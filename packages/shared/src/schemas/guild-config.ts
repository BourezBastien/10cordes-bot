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
});
export type WelcomeConfig = z.infer<typeof WelcomeConfigSchema>;

export const ModerationConfigSchema = z.object({
  /** Salon réservé aux sanctions — null = partout. */
  sanctionChannelId: z.string().nullable().default(null),
  /** Retirer les rôles pendant un mute, les restituer à la fin. */
  muteDerank: z.boolean().default(false),
});
export type ModerationConfig = z.infer<typeof ModerationConfigSchema>;

/**
 * Configuration d'un serveur — un seul document JSON typé (pattern single-document).
 * Tout champ manquant est comblé par les defaults Zod : l'évolution du schéma
 * ne nécessite pas de migration pour les nouvelles options.
 */
export const GuildConfigSchema = z.object({
  /** Langue par défaut du serveur (annonces, welcome). Les users gardent leur propre langue. */
  defaultLocale: SupportedLocale.default('fr'),
  // prefault (et non default) : la valeur de repli est RE-PARSÉE par le sous-schéma,
  // donc les defaults imbriqués (enabled=false, channelId=null…) sont appliqués.
  welcome: WelcomeConfigSchema.prefault({}),
  moderation: ModerationConfigSchema.prefault({}),
  /** Messages d'erreur personnalisés par code — template avec placeholders de l'exception. */
  errorMessages: z.record(z.string(), z.string()).default({}),
});
export type GuildConfig = z.infer<typeof GuildConfigSchema>;

/** Clé de configuration éditable via /config set (registre explicite, pilote l'autocomplétion). */
export interface ConfigKeyDescriptor {
  /** Chemin dans le document, ex: "welcome.channelId". */
  path: string;
  type: 'string' | 'boolean' | 'number' | 'channel' | 'locale';
  description: string;
}

export const CONFIG_KEYS: ConfigKeyDescriptor[] = [
  { path: 'defaultLocale', type: 'locale', description: 'Langue par défaut du serveur' },
  { path: 'welcome.enabled', type: 'boolean', description: 'Activer les messages de bienvenue' },
  { path: 'welcome.channelId', type: 'channel', description: 'Salon des messages de bienvenue' },
  { path: 'welcome.template', type: 'string', description: 'Template du message de bienvenue' },
  { path: 'welcome.cardEnabled', type: 'boolean', description: 'Carte image de bienvenue' },
  { path: 'welcome.deleteOnLeave', type: 'boolean', description: 'Supprimer le message si le membre quitte' },
  { path: 'moderation.sanctionChannelId', type: 'channel', description: 'Salon réservé aux sanctions' },
  { path: 'moderation.muteDerank', type: 'boolean', description: 'Retirer les rôles pendant un mute' },
];
