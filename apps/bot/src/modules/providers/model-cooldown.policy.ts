/*
 * POLITIQUE DE REFROIDISSEMENT D'UN MODÈLE. Après une limite de débit (429),
 * un crédit épuisé (402), une erreur serveur (5xx) ou une panne de réseau, le
 * modèle qui a échoué est mis de côté pour un temps : la demande part aussitôt
 * sur le modèle de repli, sans un appel de plus vers un modèle qui vient de
 * refuser.
 *
 * La règle du repli ne change pas : une limite de débit, une erreur serveur,
 * un délai ou une panne de réseau basculent ; un crédit épuisé ne bascule
 * jamais (c'est à l'administrateur de recharger le compte). Un refroidissement
 * pour 402 épargne seulement l'appel : la demande échoue aussitôt avec la
 * même erreur, et le modèle est réessayé à l'échéance, ou dès qu'un contrôle
 * de connexion ou une modification du fournisseur réussit.
 *
 * La durée vient de la réponse du fournisseur quand elle la dit (Retry-After,
 * en-têtes de réinitialisation de limite), sinon d'un défaut. Un plafond borne
 * ce que dit le fournisseur : il ne peut pas mettre un modèle de côté pour la
 * journée. Une clé refusée (401, 403) n'est pas un refroidissement : c'est une
 * configuration à corriger, et chaque demande doit continuer à le dire.
 *
 * Fonctions pures : l'erreur se lit sur sa nature (`kind`, `status`, `name`),
 * jamais sur une classe importée, pour ne rien faire dépendre de l'assistant.
 */

export type CooldownReason = 'rate_limited' | 'no_credits' | 'server_error' | 'network_error';

export interface CooldownDecision {
  reason: CooldownReason;
  /** Durée du refroidissement, en millisecondes. */
  ms: number;
  /** Vrai quand la règle du repli autorise la bascule pour cet échec. */
  reroute: boolean;
}

/** Durées par défaut, en millisecondes, quand la réponse n'en dit pas plus. */
export const DEFAULT_COOLDOWN_MS = {
  rateLimited: 60_000,
  paymentRequired: 5 * 60_000,
  serverError: 30_000,
  networkError: 15_000,
} as const;

/** Plafond d'un refroidissement dicté par un en-tête. */
export const MAX_COOLDOWN_MS = 15 * 60_000;

type HeadersLike = Headers | Record<string, string | string[] | undefined> | undefined | null;

/** En-tête par son nom, sans casse ni préfixe de fournisseur gênant. */
function headerOf(headers: HeadersLike, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Une durée écrite `1m26.4s`, `7.66s`, `2h3m`, `450ms` (façon Groq). */
export function parseResetDuration(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const pattern = /(\d+(?:\.\d+)?)(ms|h|m|s)/gu;
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of value.matchAll(pattern)) {
    matched = true;
    const quantity = Number(amount);
    total += unit === 'h' ? quantity * 3_600_000 : unit === 'm' ? quantity * 60_000 : unit === 's' ? quantity * 1_000 : quantity;
  }
  return matched ? Math.ceil(total) : undefined;
}

/** Secondes, date HTTP ou timestamp : ce qu'un en-tête de réinitialisation annonce, en millisecondes dès maintenant. */
export function parseRetryDelay(value: string | undefined, now: number): number | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/u.test(text)) {
    const number = Number(text);
    if (!Number.isFinite(number)) return undefined;
    // Un timestamp (secondes ou millisecondes) plutôt qu'un nombre de secondes.
    if (number >= 1e12) return Math.max(0, number - now);
    if (number >= 1e9) return Math.max(0, number * 1_000 - now);
    return Math.round(number * 1_000);
  }
  const asDate = Date.parse(text);
  return Number.isNaN(asDate) ? parseResetDuration(text) : Math.max(0, asDate - now);
}

/** Délai que la réponse annonce, `Retry-After` d'abord, puis les réinitialisations de limite. */
export function announcedDelayMs(headers: HeadersLike, now: number): number | undefined {
  for (const name of ['retry-after', 'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'retry-after-ms']) {
    const delay = parseRetryDelay(headerOf(headers, name), now);
    if (delay !== undefined && delay > 0) return delay;
  }
  return undefined;
}

/** Statut HTTP que porte une erreur, quand elle en porte un. */
export function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

/** Nature d'une erreur typée d'un adaptateur (`ProviderError.kind`). */
function kindOf(error: unknown): string | undefined {
  const kind = (error as { kind?: unknown } | null)?.kind;
  return typeof kind === 'string' ? kind : undefined;
}

/** Nom de la classe d'une erreur du client LLM (`QuotaExhaustedError`, `ProviderTimeoutError`...). */
function nameOf(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

/** En-têtes de la réponse, quand l'erreur les a gardés. */
function headersOf(error: unknown): HeadersLike {
  return (error as { headers?: HeadersLike } | null)?.headers;
}

/**
 * Refroidissement que mérite un échec : `null` quand il n'en mérite pas
 * (clé refusée, requête malformée, capacité non servie).
 */
export function cooldownFor(error: unknown, now: number = Date.now()): CooldownDecision | null {
  const status = statusOf(error);
  const kind = kindOf(error);
  const name = nameOf(error);
  if (kind === 'rate-limit' || status === 429) {
    return { reason: 'rate_limited', ms: Math.min(announcedDelayMs(headersOf(error), now) ?? DEFAULT_COOLDOWN_MS.rateLimited, MAX_COOLDOWN_MS), reroute: true };
  }
  if (kind === 'quota' || status === 402 || name === 'QuotaExhaustedError') {
    return { reason: 'no_credits', ms: DEFAULT_COOLDOWN_MS.paymentRequired, reroute: false };
  }
  if (kind === 'timeout' || status === 408 || name === 'ProviderTimeoutError') {
    return { reason: 'network_error', ms: DEFAULT_COOLDOWN_MS.networkError, reroute: true };
  }
  if (kind === 'unavailable' || name === 'ProviderUnavailableError' || (status !== undefined && status >= 500)) {
    return { reason: 'server_error', ms: DEFAULT_COOLDOWN_MS.serverError, reroute: true };
  }
  return null;
}
