import { defineTool, type BotTool, type ToolResult } from '@10cordes/shared';
import { z } from 'zod';
import type { ProviderAdapterRegistry } from './provider-adapter.registry';
import type { ModelCooldownStore } from './model-cooldown.store';
import type { GuildProviderService } from './provider-store.service';
import { PROVIDER_AUTH_TYPES, PROVIDER_PROTOCOLS, ProviderError, type ProviderConfig, type ProviderModel } from './provider.types';
import { probeConnection } from './provider-probe';
import { describeProvider } from './provider-views';

/**
 * Tools `provider.*` : connecter et gérer les fournisseurs IA d'un serveur
 * en langage naturel. Les clés sont chiffrées à l'écriture, masquées dans
 * l'audit (`sensitiveInputs`) et ne figurent jamais dans un résultat.
 */

export interface ProviderToolsDeps {
  readonly store: GuildProviderService;
  readonly registry: ProviderAdapterRegistry;
  /** Un contrôle qui passe lève le refroidissement des modèles du fournisseur. */
  readonly cooldowns?: Pick<ModelCooldownStore, 'clearProvider'>;
}

const GUILD_REQUIRED = 'Contexte de serveur requis.';
const SLUG = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/u, 'lettres minuscules, chiffres et tirets (2 à 48)');
const PROVIDER_REF = z.string().min(1).max(60).describe('Slug ou identifiant du fournisseur');
const MODEL_KINDS = ['chat', 'image', 'music', 'tts', 'video', 'search', 'other'] as const;

function describeFailure(error: unknown): string {
  return error instanceof ProviderError || error instanceof Error ? error.message : 'Opération impossible.';
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.slice(0, 60);
  }
}

/** Objet, ou chaîne JSON : rend un objet, sinon un message lisible. */
function asRecord(value: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: {} };
  if (typeof value === 'object' && !Array.isArray(value)) return { ok: true, value: value as Record<string, unknown> };
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ok: true, value: parsed as Record<string, unknown> };
    } catch {
      /* JSON invalide */
    }
  }
  return { ok: false, error: 'Format invalide : donne un objet JSON.' };
}

function asStringRecord(value: unknown): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const record = asRecord(value);
  if (!record.ok) return record;
  const entries = Object.entries(record.value);
  if (entries.some(([, item]) => typeof item !== 'string')) return { ok: false, error: 'En-têtes : donne un objet de chaînes (nom : valeur).' };
  return { ok: true, value: Object.fromEntries(entries) as Record<string, string> };
}

/** Contrôle la connexion puis rafraîchit le catalogue du fournisseur (le même chemin que le dashboard). */
async function checkAndCatalog(deps: ProviderToolsDeps, config: ProviderConfig): Promise<ToolResult> {
  const probe = await probeConnection(deps, config);
  if (!probe.ok) return { ok: false, summary: `Fournisseur enregistré mais injoignable : ${probe.summary}` };
  return { ok: true, summary: `${probe.summary} Catalogue enregistré.`, data: { modelsFound: probe.modelsFound } };
}

/** Tools de gestion des fournisseurs (ordre d'enregistrement : list, upsert, delete, test, models). */
export function buildProviderTools(deps: ProviderToolsDeps): BotTool[] {
  const admin: Pick<BotTool, 'requiredModules' | 'destructive' | 'category'> = { requiredModules: [], destructive: false, category: 'providers' };
  return [
    defineTool({
      ...admin,
      name: 'provider.list',
      description:
        'Liste les fournisseurs IA connectés sur ce serveur (protocole, hôte, nombre de modèles, clé enregistrée ou non) et ce que chaque protocole peut servir.',
      paramsSchema: z.object({}),
      permissions: ['ManageGuild'],
      systemPrompt: 'Read-only. Premier appel pour « quel fournisseur ou quel modèle est configuré ». Ne montre jamais de clé.',
      handler: async (_input, ctx): Promise<ToolResult> => {
        if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
        const providers = await deps.store.list(ctx.guildId);
        if (providers.length === 0) return { ok: true, summary: 'Aucun fournisseur IA connecté sur ce serveur.' };
        const views = providers.map((config) => describeProvider(config, deps.registry.resolve(config.protocol).capabilities));
        const lines = views.map(
          (view) =>
            `- **${view.slug}** (${view.protocol}, ${hostOf(view.baseUrl)}) : ${view.models} modèle(s), ${view.hasKey ? 'clé enregistrée' : 'sans clé'}${view.enabled ? '' : ', désactivé'} ; sert ${view.capabilities.join(', ')}`,
        );
        return { ok: true, summary: `Fournisseurs du serveur :\n${lines.join('\n')}`, data: { providers: views } };
      },
    }),
    defineTool({
      ...admin,
      name: 'provider.upsert',
      description:
        'Ajoute ou modifie un fournisseur de modèles IA du serveur (OpenRouter, DeepSeek, Google AI Studio, Groq, Z.ai, Anthropic, ElevenLabs, kie.ai, ou toute API OpenAI-compatible), vérifie la connexion et charge le catalogue des modèles. PixelLab n\u0027est pas un fournisseur de modèles : c\u0027est une intégration. Protocoles : openai-chat (compatible OpenAI), anthropic-messages, kie-unified, generic-http.',
      paramsSchema: z.object({
        slug: SLUG.describe('Nom court unique du fournisseur (ex : openrouter, deepseek-official, kie-ai)'),
        displayName: z.string().max(80).optional(),
        protocol: z.enum(PROVIDER_PROTOCOLS),
        baseUrl: z.string().min(8).max(300).describe('URL de base https de l\u0027API (ex : https://openrouter.ai/api/v1)'),
        apiKey: z.string().min(8).max(400).optional().describe('Clé API (chiffrée à l\u0027enregistrement). Absente : la clé actuelle est conservée'),
        authType: z.enum(PROVIDER_AUTH_TYPES).optional(),
        authHeaderName: z.string().max(64).optional(),
        customHeaders: z.unknown().optional(),
        extraConfig: z.unknown().optional().describe('Options du fournisseur (objet ou JSON) : opérations d\u0027un generic-http, maxTokens...'),
      }),
      permissions: ['Administrator'],
      sensitiveInputs: ['apiKey'],
      systemPrompt:
        'Pour « ajoute mon fournisseur X avec telle URL ». La clé donnée ici reste visible dans le message : propose plutôt le panneau (providers.panel) et sa modale pour la saisir. Après la connexion, lie les capacités avec capability.bind.',
      handler: async (input, ctx): Promise<ToolResult> => {
        if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
        const headers = asStringRecord(input.customHeaders);
        if (!headers.ok) return { ok: false, summary: headers.error };
        const extra = asRecord(input.extraConfig);
        if (!extra.ok) return { ok: false, summary: extra.error };
        try {
          const config = await deps.store.upsert(
            ctx.guildId,
            {
              slug: input.slug,
              displayName: input.displayName,
              protocol: input.protocol,
              baseUrl: input.baseUrl,
              apiKey: input.apiKey,
              authType: input.authType,
              authHeaderName: input.authHeaderName,
              customHeaders: headers.value,
              extraConfig: extra.value,
            },
            ctx.userId,
          );
          if (!config.apiKey) return { ok: true, summary: `Fournisseur **${config.slug}** enregistré sans clé : ajoute-la pour le tester.` };
          return await checkAndCatalog(deps, config);
        } catch (error) {
          return { ok: false, summary: `Fournisseur refusé : ${describeFailure(error)}` };
        }
      },
    }),
    defineTool({
      ...admin,
      destructive: true,
      name: 'provider.delete',
      description: 'Supprime un fournisseur IA du serveur (sa clé et ses routes).',
      paramsSchema: z.object({ provider: PROVIDER_REF }),
      permissions: ['Administrator'],
      systemPrompt: 'Irréversible pour la clé. Vérifie le slug avec provider.list.',
      handler: async (input, ctx): Promise<ToolResult> => {
        if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
        const removed = await deps.store.remove(ctx.guildId, input.provider, ctx.userId);
        return removed ? { ok: true, summary: `Fournisseur **${input.provider}** supprimé.` } : { ok: false, summary: `Fournisseur **${input.provider}** introuvable.` };
      },
    }),
    defineTool({
      ...admin,
      name: 'provider.test',
      description: 'Teste la connexion d\u0027un fournisseur et rafraîchit son catalogue de modèles.',
      paramsSchema: z.object({ provider: PROVIDER_REF }),
      permissions: ['ManageGuild'],
      systemPrompt: 'Read-only côté configuration (le catalogue est mis à jour).',
      handler: async (input, ctx): Promise<ToolResult> => {
        if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
        const config = await deps.store.get(ctx.guildId, input.provider);
        if (!config) return { ok: false, summary: `Fournisseur **${input.provider}** introuvable.` };
        if (!config.apiKey) return { ok: false, summary: `Aucune clé enregistrée pour **${config.slug}**.` };
        try {
          return await checkAndCatalog(deps, config);
        } catch (error) {
          return { ok: false, summary: `Test impossible : ${describeFailure(error)}` };
        }
      },
    }),
    defineTool({
      ...admin,
      name: 'provider.models',
      description: 'Liste les modèles disponibles d\u0027un fournisseur, filtrés par type (chat, image, music, tts, video) ou par texte.',
      paramsSchema: z.object({
        provider: PROVIDER_REF,
        kind: z.enum(MODEL_KINDS).optional(),
        query: z.string().max(60).optional(),
      }),
      permissions: ['ManageGuild'],
      systemPrompt: 'À appeler avant capability.bind pour choisir un identifiant de modèle exact.',
      handler: async (input, ctx): Promise<ToolResult> => {
        if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
        const config = await deps.store.get(ctx.guildId, input.provider);
        if (!config) return { ok: false, summary: `Fournisseur **${input.provider}** introuvable.` };
        let models = config.models;
        if (models.length === 0 && config.apiKey) {
          models = await deps.registry.resolve(config.protocol).discoverModels(config).catch(() => [] as ProviderModel[]);
          if (models.length > 0) await deps.store.saveModels(ctx.guildId, config.id, models);
        }
        const needle = input.query?.toLowerCase() ?? '';
        const filtered = models.filter((model) => (!input.kind || model.kind === input.kind) && (!needle || model.id.toLowerCase().includes(needle)));
        if (filtered.length === 0) return { ok: false, summary: `Aucun modèle ne correspond sur **${config.slug}** (${models.length} au catalogue).` };
        const shown = filtered.slice(0, 40);
        return {
          ok: true,
          summary: `${filtered.length} modèle(s) sur **${config.slug}** :\n${shown.map((model) => `- \`${model.id}\`${model.kind ? ` (${model.kind})` : ''}`).join('\n')}`,
          data: { models: shown.map((model) => model.id), total: filtered.length },
        };
      },
    }),
  ];
}
