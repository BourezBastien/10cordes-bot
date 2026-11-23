import { describe, expect, it } from 'vitest';
import {
  CollectionNameRejectedError,
  CollectionQuotaExceededError,
  CollectionQuotaPolicy,
  DYNAMIC_COLLECTION_NAME_PATTERN,
} from './collection-quota.policy';

describe('CollectionQuotaPolicy · noms de collections dynamiques', () => {
  const policy = new CollectionQuotaPolicy();

  it('accepte les noms au format attendu par les recettes', () => {
    for (const name of ['casino_balance', 'giveaway_entries', 'ab', 'a1', 'x'.repeat(48), 'tier-list']) {
      expect(policy.isWellFormedName(name)).toBe(true);
    }
    expect(DYNAMIC_COLLECTION_NAME_PATTERN.source).toBe('^[a-z0-9][a-z0-9_-]{1,47}$');
  });

  it('refuse un nom mal formé avec une erreur domaine actionnable', () => {
    const rejected = ['', 'a', 'Casino', 'casino balance', 'casino.balance', '_prive', '-tiret', 'x'.repeat(49), 'é'];
    for (const name of rejected) {
      expect(policy.isWellFormedName(name)).toBe(false);
      expect(() => policy.assertWellFormedName(name)).toThrow(CollectionNameRejectedError);
    }
    try {
      policy.assertWellFormedName('Casino Balance');
      throw new Error('attendu : un refus');
    } catch (error) {
      expect(error).toBeInstanceOf(CollectionNameRejectedError);
      expect((error as CollectionNameRejectedError).collectionName).toBe('Casino Balance');
      expect((error as Error).message).toContain('2 à 48 caractères');
    }
  });
});

describe('CollectionQuotaPolicy · quotas', () => {
  it('applique les plafonds décidés : 50 collections et 10 000 enregistrements par serveur', () => {
    const policy = new CollectionQuotaPolicy();
    expect(policy.maxCollectionsPerGuild).toBe(50);
    expect(policy.maxRecordsPerGuild).toBe(10_000);
    expect(policy.canOpenCollection(49)).toBe(true);
    expect(policy.canOpenCollection(50)).toBe(false);
    expect(policy.canWriteRecord(9_999)).toBe(true);
    expect(policy.canWriteRecord(10_000)).toBe(false);
  });

  it('lève une CollectionQuotaExceededError qui nomme la limite atteinte', () => {
    const policy = new CollectionQuotaPolicy();
    expect(() => policy.assertCanOpenCollection(50)).toThrow(CollectionQuotaExceededError);
    expect(() => policy.assertCanWriteRecord(10_000)).toThrow(CollectionQuotaExceededError);
    expect(() => policy.assertCanOpenCollection(3)).not.toThrow();
    expect(() => policy.assertCanWriteRecord(3)).not.toThrow();
    try {
      policy.assertCanOpenCollection(50);
      throw new Error('attendu : un refus');
    } catch (error) {
      const quota = error as CollectionQuotaExceededError;
      expect(quota.limit).toBe('collections');
      expect(quota.used).toBe(50);
      expect(quota.max).toBe(50);
      expect(quota.message).toContain('50 sur 50');
    }
  });

  it('accepte des plafonds personnalisés (tests, serveurs spécifiques)', () => {
    const strict = new CollectionQuotaPolicy({ maxCollectionsPerGuild: 2, maxRecordsPerGuild: 5 });
    expect(strict.canOpenCollection(1)).toBe(true);
    expect(() => strict.assertCanOpenCollection(2)).toThrow(/2 sur 2/u);
    expect(() => strict.assertCanWriteRecord(5)).toThrow(/5 sur 5/u);
    expect(strict.describe()).toBe('2 collections et 5 enregistrements par serveur au maximum');
  });
});
