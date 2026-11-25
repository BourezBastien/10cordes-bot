import { describe, expect, it, vi } from 'vitest';
import { normalizeOrigin, trustedOriginsOf } from './auth-origins';
import { discordIdOf } from './discord-identity';

/** Origines autorisées du dashboard, et identité Discord d'une session. */

describe('trustedOriginsOf', () => {
  it('rien sans réglage', () => {
    expect(trustedOriginsOf(undefined)).toEqual([]);
    expect(trustedOriginsOf(null)).toEqual([]);
    expect(trustedOriginsOf('   ')).toEqual([]);
  });

  it('une ou plusieurs origines, séparées par des virgules ou des espaces', () => {
    expect(trustedOriginsOf('https://panel.exemple.test')).toEqual(['https://panel.exemple.test']);
    expect(trustedOriginsOf('https://panel.exemple.test, http://localhost:5173')).toEqual(['https://panel.exemple.test', 'http://localhost:5173']);
    expect(trustedOriginsOf('https://a.exemple.test  https://b.exemple.test,\nhttps://c.exemple.test')).toEqual(['https://a.exemple.test', 'https://b.exemple.test', 'https://c.exemple.test']);
  });

  it('nettoyées : minuscules, sans barre finale ni chemin, sans doublon', () => {
    expect(trustedOriginsOf('HTTPS://Panel.Exemple.test/, https://panel.exemple.test/tableau-de-bord')).toEqual(['https://panel.exemple.test']);
  });

  it('une valeur illisible ou « null » n\u0027est jamais une origine de confiance', () => {
    expect(trustedOriginsOf('null, pas-une-url, ::')).toEqual([]);
    expect(normalizeOrigin('null')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
  });

  it('seules les pages http et https ont une origine', () => {
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeOrigin('file:///tmp/page.html')).toBeNull();
    expect(normalizeOrigin('capacitor://localhost')).toBeNull();
    expect(trustedOriginsOf('javascript:alert(1), https://panel.exemple.test')).toEqual(['https://panel.exemple.test']);
    expect(normalizeOrigin('HTTPS://Panel.Exemple.test/chemin?x=1')).toBe('https://panel.exemple.test');
  });
});

describe('discordIdOf', () => {
  const findFirst = vi.fn();

  function prisma() {
    return { account: { findFirst } } as never;
  }

  it('rend le snowflake rangé dans le compte lié Discord de la session', async () => {
    findFirst.mockResolvedValue({ accountId: '1550000000000000002' });
    expect(await discordIdOf(prisma(), 'user-better-auth')).toBe('1550000000000000002');
    expect(findFirst).toHaveBeenCalledWith({ where: { userId: 'user-better-auth', providerId: 'discord' }, select: { accountId: true } });
  });

  it('sans compte lié, ou un identifiant qui n\u0027est pas un snowflake : null', async () => {
    findFirst.mockResolvedValue(null);
    expect(await discordIdOf(prisma(), 'u')).toBeNull();
    for (const accountId of ['', 'abc', '123', '1550000000000000002111222333444555666777888999000']) {
      findFirst.mockResolvedValue({ accountId });
      expect(await discordIdOf(prisma(), 'u'), accountId).toBeNull();
    }
  });
});
