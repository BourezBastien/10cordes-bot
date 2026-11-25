import { describe, expect, it } from 'vitest';
import { ProviderError } from './provider.types';
import { announcedDelayMs, cooldownFor, DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS, parseResetDuration, parseRetryDelay } from './model-cooldown.policy';
import { InMemoryModelCooldownStore, modelKey } from './model-cooldown.store';

/*
 * Refroidissement d'un modèle : ce que mérite chaque échec, la durée que la
 * réponse du fournisseur annonce, et ce que le magasin retient.
 */

const NOW = Date.parse('2026-11-25T18:00:00.000Z');

// Clé calculée : le scanner du registre des outils lit, dans toute source suivie, une clé name suivie d'une chaîne littérale.
const NAME = 'name';

/** Une erreur portant un nom de classe, sans écrire la clé `name` en littéral. */
function named(message: string, className: string): Error {
  return Object.assign(new Error(message), { [NAME]: className });
}

/** Erreur du client LLM pour un statut HTTP, avec les en-têtes de la réponse. */
function httpError(status: number, headers: Record<string, string> = {}): Error {
  return Object.assign(named(`LLM ${status}`, 'ProviderHttpError'), { status, headers: new Headers(headers) });
}

describe('parseResetDuration', () => {
  it.each([
    ['1m26.4s', 86_400],
    ['7.66s', 7_660],
    ['2h3m', 7_380_000],
    ['450ms', 450],
    ['1s', 1_000],
  ])('lit la durée « %s »', (value, ms) => {
    expect(parseResetDuration(value)).toBe(ms);
  });

  it('ne dit rien sans durée', () => {
    expect(parseResetDuration(undefined)).toBeUndefined();
    expect(parseResetDuration('demain')).toBeUndefined();
  });
});

describe('parseRetryDelay', () => {
  it('des secondes, une date HTTP, un timestamp', () => {
    expect(parseRetryDelay('30', NOW)).toBe(30_000);
    expect(parseRetryDelay('120', NOW)).toBe(120_000);
    expect(parseRetryDelay(new Date(NOW + 45_000).toUTCString(), NOW)).toBe(45_000);
    expect(parseRetryDelay(String((NOW + 60_000) / 1_000), NOW)).toBe(60_000);
    expect(parseRetryDelay(String(NOW + 60_000), NOW)).toBe(60_000);
  });

  it('une date passée ne retient rien, une valeur illisible non plus', () => {
    expect(parseRetryDelay(new Date(NOW - 1_000).toUTCString(), NOW)).toBe(0);
    expect(parseRetryDelay('bientôt', NOW)).toBeUndefined();
  });
});

describe('announcedDelayMs', () => {
  it('Retry-After d\u0027abord, puis les réinitialisations de limite', () => {
    expect(announcedDelayMs({ 'retry-after': '12', 'x-ratelimit-reset-requests': '2m' }, NOW)).toBe(12_000);
    expect(announcedDelayMs({ 'x-ratelimit-reset-requests': '2m' }, NOW)).toBe(120_000);
    expect(announcedDelayMs({ 'x-ratelimit-reset-tokens': '1m26.4s' }, NOW)).toBe(86_400);
  });

  it('sans en-tête, ou un en-tête nul, rien n\u0027est annoncé', () => {
    expect(announcedDelayMs(undefined, NOW)).toBeUndefined();
    expect(announcedDelayMs({ 'retry-after': '0' }, NOW)).toBeUndefined();
    expect(announcedDelayMs(new Headers(), NOW)).toBeUndefined();
  });
});

describe('cooldownFor', () => {
  it.each([
    ['une limite de débit (statut)', httpError(429), 'rate_limited', DEFAULT_COOLDOWN_MS.rateLimited, true],
    ['une limite de débit (adaptateur)', new ProviderError('HTTP 429', 'rate-limit', 429), 'rate_limited', DEFAULT_COOLDOWN_MS.rateLimited, true],
    ['un crédit épuisé (statut)', httpError(402), 'no_credits', DEFAULT_COOLDOWN_MS.paymentRequired, false],
    ['un crédit épuisé (adaptateur)', new ProviderError('HTTP 402', 'quota', 402), 'no_credits', DEFAULT_COOLDOWN_MS.paymentRequired, false],
    ['une erreur serveur (statut)', httpError(503), 'server_error', DEFAULT_COOLDOWN_MS.serverError, true],
    ['une erreur serveur (adaptateur)', new ProviderError('HTTP 503', 'unavailable', 503), 'server_error', DEFAULT_COOLDOWN_MS.serverError, true],
    ['un délai (statut)', httpError(408), 'network_error', DEFAULT_COOLDOWN_MS.networkError, true],
    ['un délai (adaptateur)', new ProviderError('trop lent', 'timeout'), 'network_error', DEFAULT_COOLDOWN_MS.networkError, true],
    ['un délai (client LLM)', named('délai', 'ProviderTimeoutError'), 'network_error', DEFAULT_COOLDOWN_MS.networkError, true],
    ['une panne de réseau (client LLM)', named('réseau', 'ProviderUnavailableError'), 'server_error', DEFAULT_COOLDOWN_MS.serverError, true],
  ])('%s refroidit le modèle', (_label, error, reason, ms, reroute) => {
    expect(cooldownFor(error, NOW)).toEqual({ reason, ms, reroute });
  });

  it.each([
    ['une clé refusée', httpError(401)],
    ['une clé refusée (adaptateur)', new ProviderError('HTTP 403', 'auth', 403)],
    ['une clé refusée (client LLM)', named('clé', 'ProviderAuthError')],
    ['une requête invalide', httpError(400)],
    ['un crédit épuisé (client LLM, 400 insuffisant)', named('solde', 'QuotaExhaustedError')],
  ])('distingue %s', (_label, error) => {
    const decision = cooldownFor(error, NOW);
    // Seul un crédit épuisé refroidit, sans autoriser la bascule.
    if (error.name === 'QuotaExhaustedError') expect(decision).toEqual({ reason: 'no_credits', ms: DEFAULT_COOLDOWN_MS.paymentRequired, reroute: false });
    else expect(decision).toBeNull();
  });

  it('la durée annoncée par la réponse prime, dans la limite du plafond', () => {
    expect(cooldownFor(httpError(429, { 'retry-after': '90' }), NOW)?.ms).toBe(90_000);
    expect(cooldownFor(httpError(429, { 'retry-after': '7200' }), NOW)?.ms).toBe(MAX_COOLDOWN_MS);
    expect(cooldownFor(httpError(429, { 'x-ratelimit-reset-requests': '1m30s' }), NOW)?.ms).toBe(90_000);
  });
});

describe('InMemoryModelCooldownStore', () => {
  const key = modelKey('1550000000000000001', 'provider-1', 'model-a');

  it('rend null sans refroidissement, puis le refroidissement retenu', async () => {
    const store = new InMemoryModelCooldownStore();
    expect(await store.get(key)).toBeNull();
    const error = new Error('LLM 429.');
    await store.set(key, { reason: 'rate_limited', reroute: true, until: Date.now() + 60_000, error });
    expect(await store.get(key)).toMatchObject({ reason: 'rate_limited', reroute: true, error });
  });

  it('un refroidissement plus court ne raccourcit pas celui qui court', async () => {
    const store = new InMemoryModelCooldownStore();
    await store.set(key, { reason: 'no_credits', reroute: false, until: Date.now() + 300_000, error: new Error('crédits') });
    await store.set(key, { reason: 'server_error', reroute: true, until: Date.now() + 30_000, error: new Error('panne') });
    expect((await store.get(key))?.reason).toBe('no_credits');
    await store.set(key, { reason: 'rate_limited', reroute: true, until: Date.now() + 600_000, error: new Error('limite') });
    expect((await store.get(key))?.reason).toBe('rate_limited');
  });

  it('clearProvider oublie tout un fournisseur, et seulement lui', async () => {
    const store = new InMemoryModelCooldownStore();
    const other = modelKey('1550000000000000001', 'provider-2', 'model-a');
    const otherGuild = modelKey('1550000000000000002', 'provider-1', 'model-a');
    for (const entry of [key, modelKey('1550000000000000001', 'provider-1', 'model-b'), other, otherGuild]) {
      await store.set(entry, { reason: 'server_error', reroute: true, until: Date.now() + 30_000, error: new Error('panne') });
    }
    expect(await store.clearProvider('1550000000000000001', 'provider-1')).toBe(2);
    expect(await store.get(key)).toBeNull();
    expect(await store.get(other)).not.toBeNull();
    expect(await store.get(otherGuild)).not.toBeNull();
  });

  it('latestUntil rend la fin la plus tardive du fournisseur, et oublie ce qui est échu', async () => {
    const store = new InMemoryModelCooldownStore();
    const now = Date.now();
    expect(await store.latestUntil('1550000000000000001', 'provider-1')).toBeNull();
    await store.set(key, { reason: 'server_error', reroute: true, until: now - 1, error: new Error('échu') });
    await store.set(modelKey('1550000000000000001', 'provider-1', 'model-b'), { reason: 'no_credits', reroute: false, until: now + 300_000, error: new Error('crédits') });
    expect(await store.latestUntil('1550000000000000001', 'provider-1')).toBe(now + 300_000);
    expect(await store.get(key)).toBeNull();
  });

  it('la clé d\u0027un modèle ne se confond pas avec un autre de même nom', () => {
    expect(modelKey('g', 'p', 'a\b')).not.toBe(modelKey('g', 'p', 'a'));
    expect(modelKey('g', 'p', 'm')).not.toBe(modelKey('g', 'p2', 'm'));
  });
});
