import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COOLDOWN_MS, ProviderHealthService } from './provider-health.service';
import { ProviderError, type ProviderErrorKind } from './provider.types';

/**
 * Santé des fournisseurs, en mémoire. Ce que fixent ces tests : un état ne
 * vient que d'une issue d'appel ; une panne passagère se répare toute seule
 * au bout de 60 s, une clé refusée non ; et aucun texte retenu ne porte la clé.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';
const OTHER_GUILD = '1550000000000000002';
const PROVIDER = 'provider-1';
const T0 = Date.UTC(2026, 10, 25, 12, 0, 0);

const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();
const UNKNOWN = { state: 'unknown', cooldownUntil: null, lastError: null, lastHttpStatus: null, lastCheckedAt: null } as const;

describe('ProviderHealthService', () => {
  let health: ProviderHealthService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    health = new ProviderHealthService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sans appel retenu depuis le démarrage, un fournisseur est inconnu', () => {
    expect(health.statusOf(GUILD, PROVIDER)).toEqual(UNKNOWN);
    health.record(GUILD, 'other-provider', { ok: true });
    expect(health.statusOf(GUILD, PROVIDER)).toEqual(UNKNOWN);
    expect(health.statusOf(OTHER_GUILD, 'other-provider')).toEqual(UNKNOWN);
  });

  it('un appel réussi passe le fournisseur en actif, et efface ce que l\u0027appel précédent avait laissé', () => {
    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('HTTP 401', 'auth', 401) });
    health.record(GUILD, PROVIDER, { ok: true });
    expect(health.statusOf(GUILD, PROVIDER)).toEqual({ state: 'active', cooldownUntil: null, lastError: null, lastHttpStatus: null, lastCheckedAt: at(0) });
  });

  it('une limite de débit met le fournisseur au repos forcé pendant 60 s, puis l\u0027état de fond reprend sans nouvel appel', () => {
    health.record(GUILD, PROVIDER, { ok: true });
    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('HTTP 429', 'rate-limit', 429) });

    const cooling = health.statusOf(GUILD, PROVIDER);
    expect(cooling.state).toBe('cooldown');
    expect(Date.parse(cooling.cooldownUntil ?? '') - Date.now()).toBe(COOLDOWN_MS);
    expect(cooling).toMatchObject({ lastError: 'HTTP 429', lastHttpStatus: 429, lastCheckedAt: at(0) });

    vi.setSystemTime(T0 + COOLDOWN_MS - 1);
    expect(health.statusOf(GUILD, PROVIDER).state).toBe('cooldown');
    vi.setSystemTime(T0 + COOLDOWN_MS + 1);
    expect(health.statusOf(GUILD, PROVIDER)).toMatchObject({ state: 'active', cooldownUntil: null, lastError: 'HTTP 429' });
  });

  it('un refroidissement sans succès antérieur rend à l\u0027état inconnu', () => {
    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('trop lent', 'timeout') });
    expect(health.statusOf(GUILD, PROVIDER)).toMatchObject({ state: 'cooldown', cooldownUntil: at(COOLDOWN_MS), lastHttpStatus: null });
    vi.setSystemTime(T0 + COOLDOWN_MS + 1);
    expect(health.statusOf(GUILD, PROVIDER).state).toBe('unknown');
  });

  it.each<ProviderErrorKind>(['rate-limit', 'unavailable', 'timeout'])('une erreur « %s » est passagère : repos forcé', (kind) => {
    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('panne', kind) });
    expect(health.statusOf(GUILD, PROVIDER).state).toBe('cooldown');
  });

  it.each<ProviderErrorKind>(['auth', 'quota', 'invalid', 'unsupported'])('une erreur « %s » est durable : elle reste jusqu\u0027au prochain succès', (kind) => {
    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('refus', kind, 422) });
    expect(health.statusOf(GUILD, PROVIDER)).toMatchObject({ state: 'error', cooldownUntil: null, lastError: 'refus', lastHttpStatus: 422 });
    vi.setSystemTime(T0 + 60 * 60 * 1000);
    expect(health.statusOf(GUILD, PROVIDER).state).toBe('error');
    health.record(GUILD, PROVIDER, { ok: true });
    expect(health.statusOf(GUILD, PROVIDER).state).toBe('active');
  });

  it('une erreur durable par-dessus un refroidissement prend la place ; un refroidissement par-dessus une erreur la rend à l\u0027erreur ensuite', () => {
    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('HTTP 429', 'rate-limit', 429) });
    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('HTTP 401', 'auth', 401) });
    expect(health.statusOf(GUILD, PROVIDER)).toMatchObject({ state: 'error', cooldownUntil: null });

    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('HTTP 503', 'unavailable', 503) });
    expect(health.statusOf(GUILD, PROVIDER).state).toBe('cooldown');
    vi.setSystemTime(T0 + COOLDOWN_MS + 1);
    expect(health.statusOf(GUILD, PROVIDER).state).toBe('error');
  });

  it('une erreur sans sorte est une panne de réseau (passagère), sauf ce qu\u0027en sait l\u0027appelant', () => {
    health.record(GUILD, PROVIDER, { ok: false, error: new TypeError('fetch failed') });
    expect(health.statusOf(GUILD, PROVIDER).state).toBe('cooldown');

    health.record(OTHER_GUILD, PROVIDER, { ok: false, error: new Error('Configuration IA invalide (401).'), transient: false, secret: KEY });
    expect(health.statusOf(OTHER_GUILD, PROVIDER)).toMatchObject({ state: 'error', lastError: 'Configuration IA invalide (401).' });

    health.record(OTHER_GUILD, PROVIDER, { ok: false, error: new Error('indisponible'), transient: true });
    expect(health.statusOf(OTHER_GUILD, PROVIDER).state).toBe('cooldown');
  });

  it('une erreur typée se lit sur sa sorte, avant ce qu\u0027en dit l\u0027appelant', () => {
    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('HTTP 429', 'rate-limit', 429), transient: false });
    expect(health.statusOf(GUILD, PROVIDER).state).toBe('cooldown');
  });

  it('une erreur `http` avec un statut est une erreur ; sans statut (demande annulée, réponse refusée), elle ne dit rien du fournisseur', () => {
    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('Demande annulée.', 'http') });
    expect(health.statusOf(GUILD, PROVIDER)).toEqual(UNKNOWN);

    health.record(GUILD, PROVIDER, { ok: true });
    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('La réponse recopie la clé : refusée.', 'http') });
    expect(health.statusOf(GUILD, PROVIDER).state).toBe('active');

    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('HTTP 404 : modèle inconnu', 'http', 404) });
    expect(health.statusOf(GUILD, PROVIDER)).toMatchObject({ state: 'error', lastHttpStatus: 404 });
  });

  it('le message retenu est masqué avant d\u0027être tronqué à 300 caractères', () => {
    health.record(GUILD, PROVIDER, { ok: false, error: new Error(`${KEY} ${'x'.repeat(400)}`), transient: false, secret: KEY });
    const { lastError } = health.statusOf(GUILD, PROVIDER);
    expect(lastError).toHaveLength(300);
    expect(lastError).not.toContain(KEY);
    expect(lastError).toContain('[clé masquée]');
    // Une valeur lancée qui n'est pas une Error se lit quand même.
    health.record(GUILD, PROVIDER, { ok: false, error: 'refus nu', transient: false });
    expect(health.statusOf(GUILD, PROVIDER).lastError).toBe('refus nu');
  });

  it('les états sont propres à un serveur, et rien n\u0027est retenu sans fournisseur', () => {
    health.record(GUILD, PROVIDER, { ok: true });
    health.record(OTHER_GUILD, PROVIDER, { ok: false, error: new ProviderError('HTTP 401', 'auth', 401) });
    expect(health.statusOf(GUILD, PROVIDER).state).toBe('active');
    expect(health.statusOf(OTHER_GUILD, PROVIDER).state).toBe('error');

    health.record(GUILD, null, { ok: true });
    health.record(GUILD, undefined, { ok: true });
    expect(health.statusOf(GUILD, PROVIDER).state).toBe('active');
  });

  it('la fin annoncée par le refroidissement du modèle est celle montrée ; un second échec ne la raccourcit pas, un succès sur un autre modèle la garde', () => {
    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('HTTP 429', 'rate-limit', 429), transient: true, cooldownUntil: T0 + 120_000 });
    expect(health.statusOf(GUILD, PROVIDER)).toMatchObject({ state: 'cooldown', cooldownUntil: at(120_000) });
    health.record(GUILD, PROVIDER, { ok: false, error: new ProviderError('HTTP 503', 'unavailable', 503), transient: true });
    expect(health.statusOf(GUILD, PROVIDER)).toMatchObject({ state: 'cooldown', cooldownUntil: at(120_000) });
    // Un succès sur un autre modèle du fournisseur : l'erreur s'efface, le repos dure tant qu'un modèle y est encore.
    health.record(GUILD, PROVIDER, { ok: true, cooldownUntil: T0 + 30_000 });
    expect(health.statusOf(GUILD, PROVIDER)).toMatchObject({ state: 'cooldown', cooldownUntil: at(30_000), lastError: null });
    health.record(GUILD, PROVIDER, { ok: true, cooldownUntil: null });
    expect(health.statusOf(GUILD, PROVIDER)).toMatchObject({ state: 'active', cooldownUntil: null });
  });
});
