import { defineTool, type BotTool, type ToolResult } from '@10cordes/shared';
import { z } from 'zod';
import type { GuildProviderService, ResolvedRoute } from './provider-store.service';
import { CAPABILITY_LABELS, NATIVE_CAPABILITIES, ProviderError, capabilityLabel } from './provider.types';
import { describeRoute } from './provider-views';

/**
 * Tools `capability.*` : associer chaque capacité du bot (conversation,
 * raisonnement, ingestion, image, musique, voix, vidéo, recherche web, ou
 * toute capacité custom.*) au modèle d'un fournisseur, en langage naturel.
 */

export interface CapabilityToolsDeps {
  readonly store: GuildProviderService;
}

const GUILD_REQUIRED = 'Contexte de serveur requis.';
const CAPABILITY = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_.-]{1,47}$/u, 'capacité native (chat.default, image.generate...) ou custom.nom-en-kebab-case');

function describeFailure(error: unknown): string {
  return error instanceof ProviderError || error instanceof Error ? error.message : 'Opération impossible.';
}

/** Lignes du tableau des capacités : route active, ou « non routée ». */
function routeLines(routes: ResolvedRoute[]): string[] {
  const slugOf = (providerId: string): string => routes.find((route) => route.provider.id === providerId)?.provider.slug ?? providerId;
  const described = routes.map((route) =>
    describeRoute(
      {
        capability: route.capability,
        providerId: route.provider.id,
        modelId: route.modelId,
        fallbackProviderId: route.fallback?.provider.id ?? null,
        fallbackModelId: route.fallback?.modelId ?? null,
        enabled: true,
      },
      slugOf,
    ),
  );
  const custom = described.filter((candidate) => candidate.capability.startsWith('custom.'));
  return NATIVE_CAPABILITIES.map((capability) => {
    const route = described.find((candidate) => candidate.capability === capability);
    return `- **${CAPABILITY_LABELS[capability]}** (\`${capability}\`) : ${route ? `\`${route.providerSlug}\` / \`${route.modelId}\`${route.fallback ? ` (repli : ${route.fallback})` : ''}` : 'non routée'}`;
  }).concat(custom.map((candidate) => `- **${capabilityLabel(candidate.capability)}** (\`${candidate.capability}\`) : \`${candidate.providerSlug}\` / \`${candidate.modelId}\``));
}

/** Tools de routage des capacités (ordre d'enregistrement : bind, list). */
export function buildCapabilityTools(deps: CapabilityToolsDeps): BotTool[] {
  const base: Pick<BotTool, 'requiredModules' | 'destructive' | 'category'> = { requiredModules: [], destructive: false, category: 'providers' };
  return [
    defineTool({
      ...base,
      name: 'capability.bind',
      description:
        'Associe une capacité du bot au modèle d\u0027un fournisseur pour ce serveur, avec un fournisseur de repli facultatif (bascule automatique sur quota, erreur serveur ou délai). Capacités natives : chat.default, chat.reasoning, chat.ingestion, image.generate, image.edit, music.generate, tts.speak, video.generate, web.search ; ou custom.*.',
      paramsSchema: z.object({
        capability: CAPABILITY,
        provider: z.string().min(1).max(60).describe('Slug ou identifiant du fournisseur'),
        model: z.string().min(1).max(120).describe('Identifiant exact du modèle (provider.models)'),
        fallbackProvider: z.string().min(1).max(60).optional(),
        fallbackModel: z.string().min(1).max(120).optional(),
        params: z.unknown().optional().describe('Surcharge de paramètres pour cette capacité (objet ou JSON)'),
      }),
      permissions: ['Administrator'],
      systemPrompt:
        'Pour « utilise tel modèle pour le chat / la musique / les images ». L\u0027identifiant de modèle vient de provider.models. La capacité prend effet immédiatement, sans redémarrage.',
      handler: async (input, ctx): Promise<ToolResult> => {
        if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
        const provider = await deps.store.get(ctx.guildId, input.provider);
        if (!provider) return { ok: false, summary: `Fournisseur **${input.provider}** introuvable.` };
        let params: Record<string, unknown> | undefined;
        if (input.params !== undefined && input.params !== '') {
          try {
            const parsed: unknown = typeof input.params === 'string' ? JSON.parse(input.params) : input.params;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('format');
            params = parsed as Record<string, unknown>;
          } catch {
            return { ok: false, summary: 'Paramètres invalides : donne un objet JSON.' };
          }
        }
        const fallbackProvider = input.fallbackProvider ? await deps.store.get(ctx.guildId, input.fallbackProvider) : null;
        if (input.fallbackProvider && !fallbackProvider) return { ok: false, summary: `Fournisseur de repli **${input.fallbackProvider}** introuvable.` };
        const fallback = fallbackProvider ? `, repli \`${fallbackProvider.slug}\` / \`${input.fallbackModel ?? input.model}\`` : '';
        try {
          const { followedBy } = await deps.store.bindRoute(
            ctx.guildId,
            input.capability,
            { providerId: provider.id, modelId: input.model, fallbackProviderId: fallbackProvider?.id ?? null, fallbackModelId: input.fallbackModel ?? null, params },
            ctx.userId,
          );
          // Les routes de conversation qui partageaient ce modèle ont suivi.
          const followers = followedBy.length > 0 ? ` ${followedBy.map((capability) => capabilityLabel(capability)).join(' et ')} partageaient ce modèle : elles suivent.` : '';
          return { ok: true, summary: `**${capabilityLabel(input.capability)}** (\`${input.capability}\`) : \`${provider.slug}\` / \`${input.model}\`${fallback}.${followers}`, data: { followedBy } };
        } catch (error) {
          return { ok: false, summary: `Route refusée : ${describeFailure(error)}` };
        }
      },
    }),
    defineTool({
      ...base,
      name: 'capability.list',
      description: 'Montre quel modèle exécute chaque capacité du bot sur ce serveur (et son repli éventuel).',
      paramsSchema: z.object({}),
      permissions: ['ManageGuild'],
      systemPrompt: 'Read-only. Premier appel pour « quel modèle est utilisé pour... ».',
      handler: async (_input, ctx): Promise<ToolResult> => {
        if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
        const routes = await deps.store.routes(ctx.guildId);
        const lines = routeLines(routes);
        const routed = routes.filter((route) => route.provider.enabled).length;
        return { ok: true, summary: `Capacités du serveur (${routed} routée(s) sur ${NATIVE_CAPABILITIES.length} natives) :\n${lines.join('\n')}`, data: { routed } };
      },
    }),
  ];
}
