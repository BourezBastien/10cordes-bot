import type { BotTool } from '@10cordes/shared';
import { z } from 'zod';
import type { GuildConfigService } from '../guild-config/guild-config.service';
import type { ImagelabService } from '../imagelab/imagelab.service';
import type { ChatCompletionResult, ChatMessage, ChatOptions, LlmStatus, OpenAiTool } from './llm.types';

/** Ce que les tools peuvent demander au client LLM configuré (jamais la clé). */
export interface LlmClientFacade {
  /** Ce serveur peut-il converser : ses fournisseurs routés, sinon la configuration d'instance. */
  isConfiguredFor(guildId: string | null): Promise<boolean>;
  status(): LlmStatus;
  chat(messages: ChatMessage[], tools: OpenAiTool[], options: ChatOptions): Promise<ChatCompletionResult>;
}

export interface LlmToolsDeps {
  readonly llm: LlmClientFacade;
  readonly config: GuildConfigService;
  readonly imagelab: ImagelabService;
}

/** Tool translate : réutilise le LLM configuré (aucune API externe en plus). */
function translateTool(llm: LlmClientFacade): BotTool {
  return {
    name: 'translate',
    description: 'Traduit un texte vers la langue cible (réutilise le modèle IA configuré).',
    category: 'assistant',
    paramsSchema: z.object({
      text: z.string().min(1).max(4000),
      target: z.string().min(2).max(30).default('français').describe('Langue cible (ex: français, english, español)'),
    }),
    requiredModules: [],
    permissions: [],
    destructive: false,
    systemPrompt:
      'Renvoie UNIQUEMENT la traduction, sans commentaire ni guillemets ajoutés. Préserve le ton, les noms propres et le markdown.',
    handler: async (input, ctx) => {
      if (!(await llm.isConfiguredFor(ctx.guildId))) return { ok: false, summary: 'Le module IA n\u0027est pas configuré.' };
      const { text, target } = input as { text: string; target?: string };
      const completion = await llm
        .chat(
          [
            { role: 'system', content: `Traduis le texte suivant en ${target ?? 'français'}. Réponds UNIQUEMENT avec la traduction.` },
            { role: 'user', content: text },
          ],
          [],
          { userId: ctx.userId, guildId: ctx.guildId, cause: 'consolidation' },
        )
        .catch(() => null);
      if (!completion?.content) return { ok: false, summary: 'Traduction impossible (fournisseur IA injoignable).' };
      return { ok: true, summary: completion.content };
    },
  };
}

/** Tool setDedicatedChannel : désigne le salon où l'agent engage sans mention. */
function dedicatedChannelTool(config: GuildConfigService): BotTool {
  return {
    name: 'setDedicatedChannel',
    description: "Désigne le salon dédié de l'agent IA : tous les messages y sont traités sans mention. Salon actuel si channelId omis.",
    category: 'assistant',
    paramsSchema: z.object({ channelId: z.string().min(1).optional() }),
    requiredModules: [],
    permissions: ['ManageGuild'],
    destructive: false,
    systemPrompt: "Configure le salon dédié de l'agent quand l'utilisateur le demande, en résolvant le nom via getChannels.",
    handler: async (input, ctx) => {
      if (ctx.guildId === null) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { channelId } = input as { channelId?: string };
      const target = channelId ?? ctx.channelId;
      if (!target) return { ok: false, summary: 'Aucun salon identifiable.' };
      await config.patch(ctx.guildId, { assistant: { channelId: target } });
      return { ok: true, summary: `Salon dédié IA : <#${target}>. Tous les messages y sont traités sans mention.` };
    },
  };
}

/** Tool getAIStatus : l'agent vérifie lui-même l'état des connexions IA. */
function statusTool(llm: LlmClientFacade, imagelab: ImagelabService): BotTool {
  return {
    name: 'getAIStatus',
    description: 'Connexion IA de cette instance : fournisseur, modèle, clé (masquée), PixelLab.',
    category: 'assistant',
    paramsSchema: z.object({}).loose(),
    requiredModules: [],
    permissions: ['ManageGuild'],
    scope: 'user',
    destructive: false,
    systemPrompt:
      'Read-only. Contient des infos sensibles : la réponse est éphémère. Call FIRST when the user asks whether the IA/DeepSeek/provider is configured, connected or working.',
    handler: async () => {
      const status = llm.status();
      const lines =
        status.source === 'none'
          ? ['IA non connectée : aucun fournisseur. L\'owner peut la connecter via la modale (bouton du panneau).']
          : [
              `IA connectée via ${status.source === 'modal' ? 'la modale' : "l'environnement"} : ${status.provider} / \`${status.model}\` (clé ${status.maskedKey}).`,
            ];
      lines.push(imagelab.configured ? 'PixelLab connecté.' : 'PixelLab non configuré.');
      return { ok: true, summary: lines.join(' '), data: { ...status, pixellab: imagelab.configured } };
    },
  };
}

/** Tools exposés par le module IA (ordre d'enregistrement au boot : statut, salon dédié, traduction). */
export function buildLlmTools(deps: LlmToolsDeps): BotTool[] {
  return [statusTool(deps.llm, deps.imagelab), dedicatedChannelTool(deps.config), translateTool(deps.llm)];
}
