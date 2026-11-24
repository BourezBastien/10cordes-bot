import { describe, expect, it } from 'vitest';
import { ProviderError } from '../providers/provider.types';
import { ProviderAuthError, ProviderTimeoutError, ProviderUnavailableError, QUOTA_EXHAUSTED_MESSAGE, QuotaExhaustedError, isFallbackWorthy, throwProviderError } from './llm.errors';

/** Une réponse HTTP d'échec doit toujours devenir une erreur TYPÉE du fournisseur. */

const throws = (status: number, detail: string): Error => {
  try {
    throwProviderError(status, detail);
  } catch (error) {
    return error as Error;
  }
  throw new Error('throwProviderError n\u0027a rien levé');
};

describe('throwProviderError · table de décision des statuts HTTP', () => {
  it('402 ou solde insuffisant : crédits épuisés', () => {
    expect(throws(402, '')).toBeInstanceOf(QuotaExhaustedError);
    expect(throws(400, 'Error: insufficient_balance for this key')).toBeInstanceOf(QuotaExhaustedError);
  });

  it('401 et 403 : clé rejetée', () => {
    expect(throws(401, 'invalid api key')).toBeInstanceOf(ProviderAuthError);
    expect(throws(403, 'forbidden')).toBeInstanceOf(ProviderAuthError);
  });

  it('5xx : fournisseur indisponible', () => {
    expect(throws(500, 'oops')).toBeInstanceOf(ProviderUnavailableError);
    expect(throws(503, '')).toBeInstanceOf(ProviderUnavailableError);
  });

  it('tout autre statut : erreur générique, détail tronqué à 200 caractères', () => {
    const error = throws(429, `rate limited ${'x'.repeat(400)}`);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(QuotaExhaustedError);
    expect(error.message).toBe(`LLM 429: rate limited ${'x'.repeat(187)}`);
    expect(error.message.length).toBe(209);
  });

  it('la notice de quota est la même pour la boucle et la livraison, sans fournisseur nommé ni tiret cadratin', () => {
    expect(QUOTA_EXHAUSTED_MESSAGE).toContain('crédits du fournisseur IA sont épuisés');
    expect(QUOTA_EXHAUSTED_MESSAGE).not.toMatch(/deepseek|anthropic|openai/iu);
    expect(QUOTA_EXHAUSTED_MESSAGE).not.toContain('\u2014');
  });
});

/** Une seule table de décision pour la bascule sur le fournisseur de repli, erreurs du client comme des adaptateurs. */
describe('isFallbackWorthy · erreurs qui font basculer sur le fournisseur de repli', () => {
  it.each([
    ['429 du client', throws(429, 'rate limited')],
    ['5xx du client', throws(503, 'unavailable')],
    ['panne réseau', new ProviderUnavailableError()],
    ['délai dépassé', new ProviderTimeoutError()],
    ['limite de débit d\u0027un adaptateur', new ProviderError('HTTP 429', 'rate-limit', 429)],
    ['erreur serveur d\u0027un adaptateur', new ProviderError('HTTP 503', 'unavailable', 503)],
    ['délai d\u0027un adaptateur', new ProviderError('trop lent', 'timeout')],
  ])('%s : bascule', (_label, error) => {
    expect(isFallbackWorthy(error)).toBe(true);
  });

  it.each([
    ['401 du client', throws(401, 'bad key')],
    ['crédits épuisés', throws(402, '')],
    ['400 du client', throws(400, 'bad request')],
    ['clé refusée par un adaptateur', new ProviderError('HTTP 401', 'auth', 401)],
    ['crédits épuisés côté adaptateur', new ProviderError('HTTP 402', 'quota', 402)],
    ['demande invalide', new ProviderError('modèle inconnu', 'invalid')],
    ['capacité non servie', new ProviderError('non supporté', 'unsupported')],
    ['erreur neutre', new Error('réseau cassé')],
    ['annulation', new DOMException('aborted', 'AbortError')],
  ])('%s : jamais de bascule', (_label, error) => {
    expect(isFallbackWorthy(error)).toBe(false);
  });
});
