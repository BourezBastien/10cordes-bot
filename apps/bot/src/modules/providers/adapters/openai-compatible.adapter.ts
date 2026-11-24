import { AbstractProviderAdapter } from '../provider-adapter';
import {
  ProviderError,
  type Capability,
  type ChatResult,
  type ChatTurnInput,
  type ConnectionCheckResult,
  type ProviderConfig,
  type ProviderExecutionResult,
  type ProviderModel,
  type ProviderProtocol,
  type ProviderRequest,
} from '../provider.types';
import { executeChatCapability, postChatCompletion } from './openai-compatible.chat';
import { editImage, generateImage, synthesizeSpeech } from './openai-compatible.media';
import { discoverRemoteModels, listModelIds } from './openai-compatible.models';
import { failureSummary, redactDeep, redactError, redactSecret } from './generic-http.errors';

const CHAT_CAPABILITIES: readonly string[] = ['chat.default', 'chat.reasoning', 'chat.ingestion'];

/**
 * Protocole « compatible OpenAI » : OpenAI, DeepSeek, OpenRouter, Groq, Z.ai,
 * DashScope, Gemini (mode compatible). La base URL porte déjà son préfixe de
 * version (`https://api.openai.com/v1`) : les chemins s'y ajoutent tels quels.
 * Adaptateur sans état : la configuration (et la clé déchiffrée) arrive à
 * chaque appel, et la clé ne ressort jamais (résultat, erreur, journal).
 */
export class OpenAiCompatibleAdapter extends AbstractProviderAdapter {
  readonly protocol: ProviderProtocol = 'openai-chat';

  readonly capabilities: readonly Capability[] = [
    'chat.default',
    'chat.reasoning',
    'chat.ingestion',
    'image.generate',
    'image.edit',
    'tts.speak',
  ];

  /** GET /models : la clé est acceptée si le catalogue se lit. */
  async testConnection(config: ProviderConfig): Promise<ConnectionCheckResult> {
    try {
      const modelsFound = (await listModelIds(config)).length;
      return { ok: true, summary: `Connecté : ${modelsFound} modèle(s) disponible(s).`, modelsFound };
    } catch (error) {
      return { ok: false, summary: failureSummary(error, config.apiKey), modelsFound: 0 };
    }
  }

  async discoverModels(config: ProviderConfig): Promise<ProviderModel[]> {
    return this.guarded(config, () => discoverRemoteModels(config));
  }

  async chat(config: ProviderConfig, turn: ChatTurnInput): Promise<ChatResult> {
    return this.guarded(config, () => postChatCompletion(config, turn));
  }

  async execute(config: ProviderConfig, request: ProviderRequest, signal?: AbortSignal): Promise<ProviderExecutionResult> {
    const result = await this.guarded(config, () => executeCapability(config, request, signal));
    return { ok: result.ok, summary: redactSecret(result.summary, config.apiKey), data: redactDeep(result.data, config.apiKey) };
  }

  /** Toute erreur qui porte la clé ressort masquée (type et statut conservés), même si elle vient du socle. */
  private async guarded<T>(config: ProviderConfig, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw redactError(error, config.apiKey);
    }
  }
}

function executeCapability(config: ProviderConfig, request: ProviderRequest, signal?: AbortSignal): Promise<ProviderExecutionResult> {
  const { capability } = request;
  if (CHAT_CAPABILITIES.includes(capability)) return executeChatCapability(config, request, signal);
  switch (capability) {
    case 'image.generate':
      return generateImage(config, request, signal);
    case 'image.edit':
      return editImage(config, request, signal);
    case 'tts.speak':
      return synthesizeSpeech(config, request, signal);
    default:
      throw new ProviderError(`Le protocole openai-chat ne sert pas « ${capability} ».`, 'unsupported');
  }
}
