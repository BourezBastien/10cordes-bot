import { setTimeout as delay } from 'node:timers/promises';
import { providerFetch, providerHttpError, readJson } from '../provider-http';
import { ProviderError, type ProviderConfig, type ProviderErrorKind } from '../provider.types';
import { asNumber, asRecord, asText, redactSecret } from './kie-unified.json';
import { collectResultUrls } from './kie-unified.results';
import { KIE_CREATE_TASK_PATH, KIE_RECORD_INFO_PATH, type KiePollTiming, type KieTaskBody } from './kie-unified.tasks';

/**
 * Tâches asynchrones kie.ai (image, vidéo, musique, voix). L'API répond
 * HTTP 200 même quand elle refuse : le verdict est dans `code` (200 = succès),
 * qui reprend les valeurs d'un statut HTTP (401, 402, 429, 500...). On crée la
 * tâche, puis on sonde `recordInfo` jusqu'à son terme ou au délai d'attente.
 */

/** Issue du sondage. */
export interface KiePollOutcome {
  /** Contenu de `data` (resultJson, response...) une fois la tâche réussie ; null si elle tourne encore. */
  record: Record<string, unknown> | null;
  elapsedMs: number;
}

const REQUEST_TIMEOUT_MS = 30_000;
/** Garde-fou de terminaison : de loin au-delà de 300 s d'attente à 5 s d'intervalle. */
const MAX_POLLS = 10_000;

/** Message lisible d'un corps d'erreur : forme OpenAI (`error.message`), forme kie (`msg`), sinon le texte brut. */
export function errorDetail(text: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return text;
  }
  if (typeof payload === 'string') return payload;
  const body = asRecord(payload);
  const error = body.error;
  return (typeof error === 'string' ? error : undefined) ?? asText(asRecord(error).message) ?? asText(body.msg) ?? asText(body.message) ?? text;
}

function excerpt(message: string, config: ProviderConfig): string {
  return redactSecret(message, config.apiKey).replace(/\s+/gu, ' ').trim().slice(0, 160);
}

/** Une réponse non 2xx est une erreur typée ; le détail vient du corps et ne contient jamais la clé. */
export async function assertKieOk(response: Response, config: ProviderConfig): Promise<void> {
  if (response.ok) return;
  throw providerHttpError(response.status, excerpt(errorDetail(await response.text().catch(() => '')), config));
}

function logicErrorKind(code: number): ProviderErrorKind {
  if (code === 401 || code === 403) return 'auth';
  if (code === 402) return 'quota';
  if (code === 429) return 'rate-limit';
  if (code >= 500) return 'unavailable';
  if (code === 400 || code === 404 || code === 422) return 'invalid';
  return 'http';
}

/** Refus LOGIQUE : HTTP 200, mais `code` vaut autre chose que 200 (ou la réponse n'a ni code ni taskId). */
export function kieLogicError(code: number | undefined, message: string, config: ProviderConfig, taskId?: string): ProviderError {
  const detail = excerpt(message, config);
  const where = taskId ? `la tâche ${taskId}` : 'la demande';
  const reason = code === undefined ? 'réponse sans code ni taskId' : `code ${code}`;
  return new ProviderError(`kie.ai a refusé ${where} (${reason})${detail ? ` : ${detail}` : '.'}`, code === undefined ? 'http' : logicErrorKind(code));
}

/** La demande a été annulée par l'appelant : jamais éligible à une bascule (une relance coûterait une seconde tâche). */
export function cancelledError(taskId?: string): ProviderError {
  return new ProviderError(taskId ? `Demande annulée (tâche ${taskId}).` : 'Demande annulée.', 'http');
}

async function waitBeforePoll(intervalMs: number, taskId: string, signal?: AbortSignal): Promise<void> {
  try {
    await delay(intervalMs, undefined, { signal });
  } catch {
    throw cancelledError(taskId);
  }
}

/**
 * Un appel au fournisseur. Si l'appelant annule PENDANT la requête, le socle
 * typait l'interruption en « timeout » (donc éligible à une bascule) : une
 * annulation n'est pas un délai dépassé, elle ne relance jamais la tâche ailleurs.
 */
async function requested(run: () => Promise<Response>, signal?: AbortSignal, taskId?: string): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (signal?.aborted) throw cancelledError(taskId);
    throw error;
  }
}

/** `POST /api/v1/jobs/createTask` : identifiant de la tâche créée. */
export async function createKieTask(config: ProviderConfig, body: KieTaskBody, signal?: AbortSignal): Promise<string> {
  const response = await requested(async () => providerFetch(config, KIE_CREATE_TASK_PATH, { method: 'POST', body: JSON.stringify(body), signal, timeoutMs: REQUEST_TIMEOUT_MS }), signal);
  await assertKieOk(response, config);
  const payload = asRecord(await readJson(response));
  const code = asNumber(payload.code);
  const taskId = asText(asRecord(payload.data).taskId);
  if (code === 200 && taskId) return taskId;
  throw kieLogicError(code, asText(payload.msg) ?? '', config);
}

function failedTaskError(data: Record<string, unknown>, config: ProviderConfig, taskId: string): ProviderError {
  const reason = excerpt(asText(data.failMsg) ?? asText(data.errorMsg) ?? asText(data.failCode) ?? 'raison non précisée', config);
  return new ProviderError(`La tâche kie.ai ${taskId} a échoué : ${reason}`, 'http');
}

/** États que kie.ai donne à une tâche terminée, en succès ou en échec. */
const FAILED_STATES: ReadonlySet<string> = new Set(['failed', 'fail', 'error', 'cancelled', 'canceled']);
const DONE_STATES: ReadonlySet<string> = new Set(['success', 'succeed', 'succeeded', 'completed', 'complete', 'finished', 'done']);

/**
 * Issue d'une sonde. kie.ai rend l'état d'une tâche dans `state` (waiting,
 * puis success), pas dans `status` : forme observée le 24/11 sur une tâche
 * z-image, prête en 8 s, qu'une lecture de `status` laissait attendre le
 * délai entier. `status` reste lu comme alias, et une tâche à l'état inconnu
 * qui porte déjà des fichiers produits compte comme réussie.
 */
function isDone(record: Record<string, unknown>, config: ProviderConfig, taskId: string): boolean {
  const state = (asText(record.state) ?? asText(record.status) ?? '').toLowerCase();
  if (FAILED_STATES.has(state)) throw failedTaskError(record, config, taskId);
  if (DONE_STATES.has(state) || asNumber(record.successFlag) === 1) return true;
  const files = collectResultUrls(record);
  // Un défaut que kie.ai n'a pas formulé en état : un code ou un message d'échec, sans fichier produit.
  const failed = (record.failCode !== null && record.failCode !== undefined && record.failCode !== '') || Boolean(asText(record.failMsg));
  if (failed && files.length === 0) throw failedTaskError(record, config, taskId);
  return files.length > 0;
}

/** `GET /api/v1/jobs/recordInfo?taskId=...` : contenu de `data` de la tâche. */
async function fetchRecord(config: ProviderConfig, taskId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await requested(async () => providerFetch(config, KIE_RECORD_INFO_PATH, { query: { taskId }, signal, timeoutMs: REQUEST_TIMEOUT_MS }), signal, taskId);
  await assertKieOk(response, config);
  const payload = asRecord(await readJson(response));
  const code = asNumber(payload.code);
  if (code !== undefined && code !== 200) throw kieLogicError(code, asText(payload.msg) ?? '', config, taskId);
  return asRecord(payload.data);
}

/**
 * Sonde la tâche toutes les `pollIntervalMs`, et une dernière fois au bout
 * de `maxWaitMs` au plus tard. Rend `record: null` quand ce délai est atteint
 * (la tâche continue côté kie.ai) : ce n'est pas une erreur. Lève dès que
 * kie.ai déclare la tâche en échec.
 */
export async function pollKieTask(config: ProviderConfig, taskId: string, timing: KiePollTiming, signal?: AbortSignal): Promise<KiePollOutcome> {
  const startedAt = Date.now();
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timing.maxWaitMs) return { record: null, elapsedMs };
    // La dernière attente est écrêtée au temps restant : on ne dépasse jamais le délai d'une intervalle entière.
    await waitBeforePoll(Math.min(timing.pollIntervalMs, timing.maxWaitMs - elapsedMs), taskId, signal);
    const record = await fetchRecord(config, taskId, signal);
    if (isDone(record, config, taskId)) return { record, elapsedMs: Date.now() - startedAt };
  }
  return { record: null, elapsedMs: Date.now() - startedAt };
}
