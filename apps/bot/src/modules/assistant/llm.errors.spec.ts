import { describe, expect, it } from 'vitest';
import { ProviderAuthError, ProviderUnavailableError, QUOTA_EXHAUSTED_MESSAGE, QuotaExhaustedError, throwProviderError } from './llm.errors';

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

  it('la notice de quota est la même pour la boucle et la livraison, sans tiret cadratin', () => {
    expect(QUOTA_EXHAUSTED_MESSAGE).toContain('crédits DeepSeek épuisés');
    expect(QUOTA_EXHAUSTED_MESSAGE).not.toContain('\u2014');
  });
});
