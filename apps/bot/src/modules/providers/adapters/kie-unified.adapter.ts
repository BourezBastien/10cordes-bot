import { AbstractProviderAdapter } from '../provider-adapter';
import { assertProviderUrl, providerFetch, readJson } from '../provider-http';
import { ProviderError, capabilityLabel, type ChatResult, type ChatTurnInput, type ConnectionCheckResult, type ProviderConfig, type ProviderExecutionResult, type ProviderModel, type ProviderRequest } from '../provider.types';
import { parseChatCompletion } from '../../../shared/llm/chat-response';
import { buildChatRequestBody, encodeApiTools } from '../../../shared/llm/chat-request';
import type { LlmFormatLeakError } from '../../../shared/llm/format-leak.error';
import { fileLog } from '../../logging/file-log.service';
import { KIE_MODEL_CATALOG, decodeKieModels } from './kie-unified.catalog';
import { assertKieOk, cancelledError, createKieTask, pollKieTask } from './kie-unified.jobs';
import { carriesSecret } from './kie-unified.json';
import { kieTaskData } from './kie-unified.results';
import { kiePollTiming, kieTaskInput } from './kie-unified.tasks';

/** Chemins du chat et des modèles, relatifs à l'URL de base (`https://api.kie.ai`). */
const KIE_CHAT_PATH = '/v1/chat/completions';
const KIE_MODELS_PATH = '/openai/v1/models';
/** Un tour bloquant peut être long (raisonnement) : bien au-delà des 30 s par défaut des requêtes. */
const CHAT_TIMEOUT_MS = 120_000;

/** `reasoning_effort` n'est envoyé qu'à l'endpoint DeepSeek : ailleurs le champ est omis (rejeté en 400). */
function sendsReasoningEffort(baseUrl: string): boolean {
  const host = new URL(baseUrl).hostname.toLowerCase();
  return host === 'deepseek.com' || host.endsWith('.deepseek.com');
}

/** Traçabilité d'une fuite de balises internes (diagnose.mjs consomme ces lignes), comme le client LLM. */
function traceLeak(turn: ChatTurnInput, leak: LlmFormatLeakError): void {
  fileLog()?.event('warn', 'llm', 'format_leak', { cause: turn.options.cause, sample: leak.sample });
}

/** La clé ne sort JAMAIS : une réponse réussie qui la recopie est refusée, jamais rendue. */
function guarded<T>(value: T, config: ProviderConfig): T {
  if (carriesSecret(value, config.apiKey)) throw new ProviderError('La réponse du fournisseur recopie la clé : refusée.', 'http');
  return value;
}

/**
 * kie.ai, une clé pour tout le catalogue : conversation synchrone compatible
 * OpenAI, et tâches asynchrones (image, vidéo, musique, voix) créées puis
 * sondées. Adaptateur SANS ÉTAT : la clé arrive à chaque appel et n'en sort
 * jamais (résultat, erreur, journal).
 */
export class KieUnifiedAdapter extends AbstractProviderAdapter {
  override readonly protocol = 'kie-unified' as const;
  override readonly capabilities = ['chat.default', 'chat.reasoning', 'chat.ingestion', 'image.generate', 'image.edit', 'music.generate', 'tts.speak', 'video.generate'] as const;

  /** `GET /openai/v1/models` : la clé ouvre bien le catalogue. */
  async testConnection(config: ProviderConfig): Promise<ConnectionCheckResult> {
    const count = (await this.discoverModels(config)).length;
    return { ok: true, summary: `Connecté : ${count} modèle(s)`, modelsFound: count };
  }

  /** Catalogue statique (média prouvé) puis modèles de conversation découverts, dédoublonnés par identifiant. */
  async discoverModels(config: ProviderConfig): Promise<ProviderModel[]> {
    const response = await providerFetch(config, KIE_MODELS_PATH);
    await assertKieOk(response, config);
    const models = new Map<string, ProviderModel>();
    for (const model of KIE_MODEL_CATALOG) models.set(model.id, { ...model });
    for (const model of decodeKieModels(await readJson(response))) {
      if (!models.has(model.id)) models.set(model.id, model);
    }
    return guarded([...models.values()], config);
  }

  /** Crée la tâche de la capacité, la sonde, et rend son résultat normalisé (ou `pending` au-delà du délai). */
  async execute(config: ProviderConfig, request: ProviderRequest, signal?: AbortSignal): Promise<ProviderExecutionResult> {
    // Annulée avant la création : on ne lance pas une tâche payante que personne n'attend.
    if (signal?.aborted) throw cancelledError();
    const taskId = await createKieTask(config, kieTaskInput(request), signal);
    const outcome = await pollKieTask(config, taskId, kiePollTiming(request.capability, request.params), signal);
    if (!outcome.record) {
      const pending = `Tâche encore en cours après ${Math.round(outcome.elapsedMs / 1000)} s (taskId ${taskId}).`;
      return guarded({ ok: true, summary: pending, data: { pending: true, taskId } }, config);
    }
    const data = kieTaskData(request.capability, outcome.record, request.params, taskId);
    const count = Array.isArray(data.urls) ? data.urls.length : 1;
    const files = `${count} fichier${count > 1 ? 's' : ''}`;
    return guarded({ ok: true, summary: `${capabilityLabel(request.capability)} réussie par ${request.modelId} (${files}, taskId ${taskId}).`, data }, config);
  }

  /** `POST /v1/chat/completions`, bloquant, au format interne du bot. */
  async chat(config: ProviderConfig, turn: ChatTurnInput): Promise<ChatResult> {
    const reasoningEffort = sendsReasoningEffort(assertProviderUrl(config.baseUrl)) ? (turn.options.reasoningEffort ?? null) : null;
    const body = buildChatRequestBody({
      model: turn.modelId,
      messages: turn.messages,
      apiTools: encodeApiTools(turn.tools),
      options: turn.options,
      reasoningEffort,
      host: config.baseUrl,
    });
    const response = await providerFetch(config, KIE_CHAT_PATH, { method: 'POST', body: JSON.stringify(body), timeoutMs: CHAT_TIMEOUT_MS });
    await assertKieOk(response, config);
    // Contrôle AVANT l'émission : un delta est publié à mesure, il ne doit jamais porter la clé.
    const result = guarded(parseChatCompletion(await readJson(response), (leak) => traceLeak(turn, leak)), config);
    // Sans streaming, le texte arrive d'un bloc : un seul delta, et seulement pour une réponse (pas un appel d'outil).
    if (turn.onDelta && result.content && result.toolCalls.length === 0) turn.onDelta(result.content);
    return result;
  }
}
