import { z } from 'zod';

/** Contraintes d'un module sur un serveur : whitelists, cooldowns et quotas. */
export const ModuleConstraintsSchema = z.object({
  /** Salons autorisés — vide = tous les salons. */
  channels: z.array(z.string()).default([]),
  /** Rôles requis pour utiliser le module. */
  requiredRoles: z.array(z.string()).default([]),
  /** Utilisateurs exemptés des restrictions (whitelist user). */
  exemptUsers: z.array(z.string()).default([]),
  /** Cooldown par utilisateur (ms) — null = aucun. */
  cooldownMs: z.number().int().min(0).nullable().default(null),
  /** Quota d'actions par rôle par fenêtre glissante (mod quotas). */
  roleQuotas: z
    .array(
      z.object({
        roleId: z.string(),
        maxActions: z.number().int().min(1),
        windowMs: z.number().int().min(1_000),
      }),
    )
    .default([]),
  /** Bypass cooldown/quotas pour les administrateurs du serveur. */
  adminBypass: z.boolean().default(true),
});
export type ModuleConstraints = z.infer<typeof ModuleConstraintsSchema>;

/** État d'un module sur un serveur. */
export interface GuildModuleStateView {
  moduleId: string;
  enabled: boolean;
  constraints: ModuleConstraints;
}
