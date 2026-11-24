import type { CapabilityCredentials } from './provider.types';
import type { GuildIntegrationService } from '../integrations/guild-integration.service';
import type { CapabilityRouterService } from './capability-router.service';

/**
 * Moteurs d'image d'un serveur, en une ligne pour le prompt : ce que le
 * modèle a le droit d'utiliser, pour arbitrer entre PixelLab (pixel art) et
 * le modèle d'image routé (rendu réaliste, illustration, photo).
 */

export interface ImageEngines {
  /** L'intégration PixelLab est active (clé présente). */
  pixellab: boolean;
  /** `fournisseur / modèle` qui sert une capacité, null si non routée. */
  generate: string | null;
  edit: string | null;
}

export function describeImageEngines(engines: ImageEngines): string {
  const parts: string[] = [];
  if (engines.pixellab) parts.push('PixelLab ACTIF (pixel art, sprites, icônes, émojis : image.icon pour une icône, image.emoji pour un émoji)');
  if (engines.generate) parts.push(`image.generate → ${engines.generate} (outil generateImage : tout autre rendu que le pixel art)`);
  if (engines.edit) parts.push(`image.edit → ${engines.edit}`);
  if (parts.length === 0) return 'MOTEURS D\u0027IMAGE de ce serveur : AUCUN. Une demande d\u0027image reçoit un refus honnête en une phrase (jamais d\u0027invention).';
  return `MOTEURS D\u0027IMAGE de ce serveur : ${parts.join(' ; ')}.`;
}

/** Les moteurs d'image d'un serveur, tels que l'agent les voit. */
export async function imageEnginesLine(router: CapabilityRouterService, integrations: GuildIntegrationService, guildId: string): Promise<string> {
  const [pixellab, generate, edit] = await Promise.all([
    integrations.active(guildId, 'pixellab').catch(() => false),
    router.resolve(guildId, 'image.generate').catch(() => null),
    router.resolve(guildId, 'image.edit').catch(() => null),
  ]);
  const target = (route: { provider: { slug: string }; modelId: string } | null): string | null => (route ? `${route.provider.slug} / ${route.modelId}` : null);
  return describeImageEngines({ pixellab, generate: target(generate), edit: target(edit) });
}

/** Clé et URL de PixelLab sur un serveur (intégration), null si inactive. */
export async function pixelLabCredentials(integrations: GuildIntegrationService, guildId: string | null, baseUrl: string): Promise<CapabilityCredentials | null> {
  const resolved = await integrations.resolve(guildId, 'pixellab').catch(() => null);
  const apiKey = resolved?.enabled ? resolved.config.apiKey : null;
  return apiKey ? { apiKey, baseUrl: resolved?.config.baseUrl || baseUrl, modelId: '' } : null;
}
