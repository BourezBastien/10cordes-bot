import { AbstractProviderAdapter } from '../provider-adapter';
import { providerFetch, readPath } from '../provider-http';
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
import { findOperation, readGenericConfig, validatedOperation, type GenericOperation } from './generic-http.config';
import { assertProviderOk, failureSummary, redactDeep, redactError, redactSecret } from './generic-http.errors';
import { renderPath, renderStrings, renderValue } from './generic-http.render';

export type { GenericOperation } from './generic-http.config';

const NO_TEST_SUMMARY = 'Aucun contrôle défini pour ce fournisseur (opérations sur mesure).';

/** Un tour de conversation (messages, tool_calls) ne se décrit pas en une opération : ces capacités ne sont jamais servies ici. */
const CHAT_CAPABILITIES: readonly string[] = ['chat.default', 'chat.reasoning', 'chat.ingestion'];

/**
 * Branche n'importe quelle API REST sans écrire de code : chaque capacité
 * (native comme `custom.*`) est décrite par une opération de `extraConfig`
 * (méthode, chemin, gabarits d'en-têtes, de requête et de corps). Adaptateur
 * sans état ; aucune capacité n'est servie d'office.
 */
export class GenericHttpAdapter extends AbstractProviderAdapter {
  readonly protocol: ProviderProtocol = 'generic-http';

  readonly capabilities: readonly Capability[] = [];

  /** Vraie pour toute capacité DÉCRITE par une opération de ce fournisseur, sauf un tour de conversation. */
  protected override supportsCustom(capability: string, config: ProviderConfig): boolean {
    if (CHAT_CAPABILITIES.includes(capability)) return false;
    return findOperation(readGenericConfig(config.extraConfig).operations, capability) !== null;
  }

  /** Jamais servi : associer la capacité à un fournisseur de conversation. */
  async chat(_config: ProviderConfig, _turn: ChatTurnInput): Promise<ChatResult> {
    throw new ProviderError('Le protocole generic-http ne sert pas la conversation.', 'unsupported');
  }

  /** Le contrôle déclaré, s'il existe (succès sur un 2xx) ; sinon rien à tester, les opérations sont sur mesure. */
  async testConnection(config: ProviderConfig): Promise<ConnectionCheckResult> {
    const { models, test } = readGenericConfig(config.extraConfig);
    if (!test) return { ok: true, summary: NO_TEST_SUMMARY, modelsFound: models.length };
    try {
      const response = await callOperation(config, validatedOperation(test, 'test'), {});
      await assertProviderOk(response, config);
      return { ok: true, summary: `Connecté : ${models.length} modèle(s) saisi(s).`, modelsFound: models.length };
    } catch (error) {
      return { ok: false, summary: failureSummary(error, config.apiKey), modelsFound: 0 };
    }
  }

  async discoverModels(config: ProviderConfig): Promise<ProviderModel[]> {
    return readGenericConfig(config.extraConfig).models;
  }

  async execute(config: ProviderConfig, request: ProviderRequest, signal?: AbortSignal): Promise<ProviderExecutionResult> {
    const result = await this.guarded(config, () => executeOperation(config, request, signal));
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

/** Le modèle de la route est offert aux gabarits (`{{modelId}}`) ; un paramètre explicite du même nom le remplace. */
async function executeOperation(config: ProviderConfig, request: ProviderRequest, signal?: AbortSignal): Promise<ProviderExecutionResult> {
  const { operations } = readGenericConfig(config.extraConfig);
  const described = findOperation(operations, request.capability);
  if (described === null) throw new ProviderError(`Aucune opération « ${request.capability} » décrite pour ce fournisseur.`, 'unsupported');
  const operation = validatedOperation(described, request.capability);
  const response = await callOperation(config, operation, { modelId: request.modelId, ...request.params }, signal);
  await assertProviderOk(response, config);
  return operationResult(response, operation, config);
}

async function callOperation(
  config: ProviderConfig,
  operation: GenericOperation,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const body = operation.body === undefined ? undefined : JSON.stringify(renderValue(operation.body, params));
  return providerFetch(config, renderPath(operation.path, params), {
    method: operation.method,
    headers: renderStrings(operation.headers, params),
    query: renderStrings(operation.query, params),
    ...(body === undefined ? {} : { body }),
    signal,
  });
}

/** `data` porte la valeur lue, sous le dernier segment du chemin de réponse (« result » sans chemin), puis le statut HTTP. */
async function operationResult(response: Response, operation: GenericOperation, config: ProviderConfig): Promise<ProviderExecutionResult> {
  const text = await response.text().catch(() => '');
  const summary = `${operation.method} ${operation.path} : HTTP ${response.status}`;
  const path = operation.responsePath;
  if (!path) return { ok: true, summary, data: { result: parseJson(text), status: response.status } };
  const value = readPath(parseJson(text), path);
  if (value === undefined) {
    // Un 200 sans la valeur attendue est le plus souvent une erreur livrée en JSON.
    const excerpt = redactSecret(text, config.apiKey).replace(/\s+/gu, ' ').trim().slice(0, 160);
    throw new ProviderError(`Chemin de réponse « ${path} » introuvable. HTTP ${response.status}${excerpt ? ` : ${excerpt}` : ''}`, 'http', response.status);
  }
  return { ok: true, summary, data: { [lastSegment(path)]: value, status: response.status } };
}

/** Corps JSON entier ; sinon `{ text }` (le corps n'est pas du JSON, ou est vide). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function lastSegment(path: string): string {
  return path.split('.').filter((segment) => segment.length > 0).at(-1) ?? 'result';
}
