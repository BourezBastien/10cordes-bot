import { safeFetch } from '../../shared/utils/safe-fetch';
import { WEBHOOK_BODY_MAX_BYTES, WEBHOOK_TIMEOUT_MS, type WebhookRequestPlan } from './webhook-request.builder';

/**
 * Échange HTTP d'un connecteur : le seul endroit d'où part la requête. Tout
 * passe par la garde des requêtes sortantes (https, hôte refusé sur sa forme
 * ET sur son adresse résolue, à chaque saut), avec un délai pour tout
 * l'échange et une réponse plafonnée. Rien ne lève : un échec rend sa raison,
 * dans un message qui ne porte ni en-tête ni secret.
 *
 * Les redirections sont suivies à la main, vers la MÊME origine seulement.
 * Suivies par le runtime, une redirection d'un connecteur emporterait ses
 * en-têtes secrets chez un tiers : les identifiants d'un connecteur ne
 * quittent jamais l'origine que le staff a configurée.
 */

export type WebhookExchangeResult =
  | {
      ok: true;
      status: number;
      /** Corps de la réponse finale, ou une chaîne vide quand il n'était pas lu. */
      body: string;
      ms: number;
      /** La réponse est une redirection vers une autre origine, qui n'a pas été suivie. */
      unfollowedRedirect: boolean;
    }
  | { ok: false; summary: string; ms: number };

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
/** En-têtes qui décrivent un corps : sans objet quand la redirection le fait tomber. */
const BODY_HEADERS = ['content-encoding', 'content-language', 'content-location', 'content-type', 'content-length'];
const TIMEOUT_SUMMARY = `Le connecteur n\u0027a pas répondu dans le délai (${Math.round(WEBHOOK_TIMEOUT_MS / 1000)} s).`;

/** Réponse plus grosse que le plafond d'un connecteur. */
class ResponseTooLargeError extends Error {
  constructor() {
    super(`Réponse trop lourde (plafond : ${Math.round(WEBHOOK_BODY_MAX_BYTES / 1024)} Ko).`);
    this.name = 'ResponseTooLargeError';
  }
}

/** Envoie la requête d'un connecteur et lit sa réponse. */
export async function sendWebhookRequest(request: WebhookRequestPlan): Promise<WebhookExchangeResult> {
  const startedAt = Date.now();
  const deadline = startedAt + WEBHOOK_TIMEOUT_MS;
  try {
    let url = request.url;
    let init: RequestInit = { method: request.method, headers: request.headers, ...(request.body === null ? {} : { body: request.body }) };
    for (let hop = 0; ; hop += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { ok: false, summary: TIMEOUT_SUMMARY, ms: Date.now() - startedAt };
      const response = await safeFetch(url, { ...init, redirect: 'manual', timeoutMs: remaining });
      const location = response.headers.get('location');
      if (!REDIRECT_STATUSES.has(response.status) || !location || hop >= MAX_REDIRECTS) {
        const body = await readBodyOf(response, request.extractPath);
        return { ok: true, status: response.status, body, ms: Date.now() - startedAt, unfollowedRedirect: false };
      }
      const next = nextUrlOf(location, url);
      await discardBodyOf(response);
      if (!next || next.origin !== new URL(url).origin) {
        return { ok: true, status: response.status, body: '', ms: Date.now() - startedAt, unfollowedRedirect: true };
      }
      init = replayed(init, response.status);
      url = next.href;
    }
  } catch (error) {
    return { ok: false, summary: describeExchangeFailure(error), ms: Date.now() - startedAt };
  }
}

/**
 * Raison lisible d'un échec d'échange : refus de la garde (message conservé,
 * il ne porte que l'adresse), délai, réseau, réponse trop lourde.
 */
export function describeExchangeFailure(error: unknown): string {
  if (error instanceof ResponseTooLargeError) return error.message;
  const name = error instanceof Error ? error.name : '';
  if (/timeout|abort/iu.test(name)) return TIMEOUT_SUMMARY;
  if (error instanceof TypeError) return 'Requête impossible : réseau ou hôte injoignable.';
  if (error instanceof Error) return error.message.slice(0, 200);
  return 'Requête impossible.';
}

/** Requête du saut suivant, comme le runtime le ferait : un 303 (ou un 301, 302 sur un POST) repart en GET sans corps. */
function replayed(init: RequestInit, status: number): RequestInit {
  const method = (init.method ?? 'GET').toUpperCase();
  const withoutBody = status === 303 ? method !== 'HEAD' : (status === 301 || status === 302) && method === 'POST';
  if (!withoutBody) return init;
  const headers = new Headers(init.headers);
  for (const header of BODY_HEADERS) headers.delete(header);
  return { method: 'GET', headers };
}

function nextUrlOf(location: string, base: string): URL | null {
  try {
    return new URL(location, base);
  } catch {
    return null;
  }
}

async function discardBodyOf(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/**
 * Corps de la réponse, lu seulement quand un chemin doit y être extrait, et
 * plafonné sur sa longueur déclarée puis sur les octets reçus. Miroir de
 * `readBounded` (safe-fetch.ts, non exporté) : le statut HTTP est nécessaire
 * et `safeFetchText`, qui le lit, ne le rend pas.
 */
async function readBodyOf(response: Response, extractPath: string | null): Promise<string> {
  if (extractPath === null) {
    await discardBodyOf(response);
    return '';
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > WEBHOOK_BODY_MAX_BYTES) {
    await discardBodyOf(response);
    throw new ResponseTooLargeError();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > WEBHOOK_BODY_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}
