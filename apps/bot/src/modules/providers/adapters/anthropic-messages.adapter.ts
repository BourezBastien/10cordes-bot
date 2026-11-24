import { AbstractProviderAdapter } from '../provider-adapter';
import { providerFetch, providerHttpError, readJson } from '../provider-http';
import { ProviderError, type ChatResult, type ChatTurnInput, type ConnectionCheckResult, type ProviderConfig, type ProviderExecutionResult, type ProviderModel, type ProviderRequest } from '../provider.types';
import { asList, asRecord, asText, fromAnthropicResponse, toAnthropicRequest } from './anthropic-messages.translate';

/** Version de l'API demandée (`anthropic-version`) : la version stable d'origine, suffisante pour system, tools et tool_use. */
const ANTHROPIC_VERSION = '2023-06-01';
const MODELS_PATH = '/v1/models';
const MESSAGES_PATH = '/v1/messages';
const DEFAULT_MAX_TOKENS = 4096;
/** Un tour bloquant peut être long : bien au-delà des 30 s par défaut des requêtes. */
const CHAT_TIMEOUT_MS = 120_000;
/** La liste des modèles est paginée (`has_more`, `last_id`) : pages suivies au plus. */
const MAX_MODEL_PAGES = 5;

/**
 * En-têtes du protocole. Un seul porte la clé : `x-api-key` (natif), ou
 * `authHeaderName` quand le fournisseur est en auth `header` (le socle
 * l'écrit alors). Dans les autres modes, la vue neutralise l'auth générique
 * (Bearer, clé en paramètre d'URL) : la clé ne part que dans l'en-tête du protocole.
 */
function protocolAuth(config: ProviderConfig): { config: ProviderConfig; headers: Record<string, string> } {
  const headers: Record<string, string> = { 'anthropic-version': ANTHROPIC_VERSION };
  if (config.authType === 'header') return { config, headers };
  if (config.apiKey) headers['x-api-key'] = config.apiKey;
  return { config: { ...config, authType: 'none', apiKey: null }, headers };
}

/** Masque la clé si le fournisseur l'a renvoyée dans un message d'erreur. */
function redact(text: string, secret: string | null): string {
  return secret && secret.length >= 4 ? text.split(secret).join('[clé masquée]') : text;
}

/** La clé ne sort JAMAIS : une réponse réussie qui la recopie est refusée, jamais rendue. */
function guarded<T>(value: T, config: ProviderConfig): T {
  if (config.apiKey && config.apiKey.length >= 4 && (JSON.stringify(value) ?? '').includes(config.apiKey)) {
    throw new ProviderError('La réponse du fournisseur recopie la clé : refusée.', 'http');
  }
  return value;
}

/** Message d'erreur du corps (`{ error: { message } }`), sinon le texte brut. */
function errorDetail(text: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return text;
  }
  return asText(asRecord(asRecord(payload).error).message) ?? text;
}

/** Une réponse non 2xx est une erreur typée ; le détail vient du corps et ne contient jamais la clé. */
async function assertOk(response: Response, config: ProviderConfig): Promise<void> {
  if (response.ok) return;
  throw providerHttpError(response.status, redact(errorDetail(await response.text().catch(() => '')), config.apiKey));
}

function maxTokensOf(config: ProviderConfig): number {
  const value = config.extraConfig.maxTokens;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_TOKENS;
}

/**
 * Anthropic, protocole natif `/v1/messages` : la conversation seule, en
 * bloquant. Adaptateur SANS ÉTAT : la clé arrive à chaque appel et n'en sort
 * jamais (résultat, erreur, journal).
 */
export class AnthropicMessagesAdapter extends AbstractProviderAdapter {
  override readonly protocol = 'anthropic-messages' as const;
  override readonly capabilities = ['chat.default', 'chat.reasoning', 'chat.ingestion'] as const;

  /** `GET /v1/models`. Une passerelle sans cette liste répond 404 : toléré, la conversation reste possible. */
  async testConnection(config: ProviderConfig): Promise<ConnectionCheckResult> {
    try {
      const count = (await this.discoverModels(config)).length;
      return { ok: true, summary: `Connecté : ${count} modèle(s)`, modelsFound: count };
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) {
        return { ok: true, summary: 'Connecté (liste des modèles non disponible)', modelsFound: 0 };
      }
      throw error;
    }
  }

  /** `GET /v1/models`, pages suivies tant que `has_more` est vrai. */
  async discoverModels(config: ProviderConfig): Promise<ProviderModel[]> {
    const auth = protocolAuth(config);
    const models = new Map<string, ProviderModel>();
    let afterId: string | undefined;
    for (let page = 0; page < MAX_MODEL_PAGES; page += 1) {
      const response = await providerFetch(auth.config, MODELS_PATH, { headers: auth.headers, ...(afterId ? { query: { after_id: afterId } } : {}) });
      await assertOk(response, config);
      const payload = asRecord(await readJson(response));
      for (const entry of asList(payload.data)) {
        const item = asRecord(entry);
        const id = asText(item.id);
        if (id) models.set(id, { id, name: asText(item.display_name) ?? id, kind: 'chat' });
      }
      const lastId = asText(payload.last_id);
      if (payload.has_more !== true || !lastId || lastId === afterId) break;
      afterId = lastId;
    }
    return guarded([...models.values()], config);
  }

  /** Ce protocole ne sert que la conversation : aucune tâche à exécuter. */
  async execute(_config: ProviderConfig, request: ProviderRequest): Promise<ProviderExecutionResult> {
    throw new ProviderError(`Le protocole anthropic-messages ne sert pas « ${request.capability} » : conversation uniquement.`, 'unsupported');
  }

  /** `POST /v1/messages`, bloquant, au format interne du bot. */
  async chat(config: ProviderConfig, turn: ChatTurnInput): Promise<ChatResult> {
    const auth = protocolAuth(config);
    const response = await providerFetch(auth.config, MESSAGES_PATH, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify(toAnthropicRequest(turn, maxTokensOf(config))),
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    await assertOk(response, config);
    // Contrôle AVANT l'émission : un delta est publié à mesure, il ne doit jamais porter la clé.
    const result = guarded(fromAnthropicResponse(await readJson(response)), config);
    // Sans streaming, le texte arrive d'un bloc : un seul delta, et seulement pour une réponse (pas un appel d'outil).
    if (turn.onDelta && result.content && result.toolCalls.length === 0) turn.onDelta(result.content);
    return result;
  }
}
