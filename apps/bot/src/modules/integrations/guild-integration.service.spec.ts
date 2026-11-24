import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../test/fake-db';
import { decryptSecret } from '../../shared/crypto/secret-box';
import type { ResolvedIntegration } from './integration.service';
import { GuildIntegrationService, keyHintOf } from './guild-integration.service';

/**
 * Intégrations d'un serveur (PixelLab...) : la clé du serveur, sinon celle de
 * l'instance, chiffrée l'une comme l'autre. Ce que fixent ces tests : la clé
 * ne paraît jamais en clair, ni en base, ni dans un audit, ni dans un statut ;
 * une ligne désactivée coupe l'intégration pour ce serveur seulement.
 */

// Clé factice, sans valeur utilisable : c'est aussi la clé maîtresse de chiffrement des specs.
const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';
const OTHER = '1550000000000000002';

type Resolved = { id: string; config: Record<string, string>; source: ResolvedIntegration['source'] };
const INSTANCE: Resolved = { id: 'pixellab', config: { apiKey: `${KEY}-instance` }, source: 'db' };

function harness(instance: Record<string, Resolved> = { pixellab: INSTANCE }) {
  const db = fakeDb();
  const audit = { record: vi.fn() };
  const integrations = { get: vi.fn(async (id: string): Promise<Resolved> => instance[id] ?? { id, config: {}, source: 'none' }) };
  const service = new GuildIntegrationService(db as never, audit as never, integrations as never, { token: 'x', ENCRYPTION_SECRET: KEY } as never);
  return { db, audit, service };
}

const storedRow = (db: ReturnType<typeof fakeDb>) => [...db.guildIntegration.rows.values()].find((row) => row.guildId === GUILD);

describe('GuildIntegrationService · serveur, puis instance', () => {
  it('sans ligne pour ce serveur, l\u0027intégration d\u0027instance sert', async () => {
    const { service } = harness();
    expect(await service.resolve(GUILD, 'pixellab')).toEqual({ slug: 'pixellab', enabled: true, origin: 'instance', config: { apiKey: `${KEY}-instance` } });
    expect(await service.resolve(null, 'pixellab')).toMatchObject({ origin: 'instance' });
    expect(await service.active(GUILD, 'pixellab')).toBe(true);
    expect(await service.status(GUILD, 'pixellab')).toEqual({ slug: 'pixellab', enabled: true, origin: 'instance', hasApiKey: true, keyHint: '••••ance', model: null });
  });

  it('sans clé nulle part : origine none, inactif', async () => {
    const { service } = harness({});
    expect(await service.resolve(GUILD, 'pixellab')).toEqual({ slug: 'pixellab', enabled: true, origin: 'none', config: {} });
    expect(await service.active(GUILD, 'pixellab')).toBe(false);
    expect(await service.status(GUILD, 'pixellab')).toMatchObject({ origin: 'none', hasApiKey: false, keyHint: null });
  });

  it('la clé du serveur prime, chiffrée en base, et l\u0027audit ne la porte pas', async () => {
    const { db, audit, service } = harness();
    await service.upsert(GUILD, 'pixellab', { apiKey: `${KEY}-guild`, baseUrl: 'https://guild.example.test', model: 'pixflux' }, 'admin');

    expect(await service.resolve(GUILD, 'pixellab')).toEqual({
      slug: 'pixellab',
      enabled: true,
      origin: 'guild',
      config: { apiKey: `${KEY}-guild`, baseUrl: 'https://guild.example.test', model: 'pixflux' },
    });
    expect(String(storedRow(db)?.encryptedApiKey).startsWith('v1:')).toBe(true);
    expect(storedRow(db)?.encryptedApiKey).not.toContain(KEY);
    expect(decryptSecret(String(storedRow(db)?.encryptedApiKey), { encryption: KEY, token: 'x' })).toBe(`${KEY}-guild`);
    expect(JSON.parse(String(storedRow(db)?.configJson))).toEqual({ model: 'pixflux' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: GUILD, action: 'integration.updated', actorId: 'admin', metadata: { slug: 'pixellab', enabled: true, keyChanged: true, fields: ['apiKey', 'baseUrl', 'model'] } }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(KEY);
    // Un autre serveur n\u0027hérite pas de cette clé.
    expect(await service.resolve(OTHER, 'pixellab')).toMatchObject({ origin: 'instance', config: { apiKey: `${KEY}-instance` } });
  });

  it('clé absente à la mise à jour : conservée ; clé vide : retirée, l\u0027instance reprend', async () => {
    const { db, service } = harness();
    await service.upsert(GUILD, 'pixellab', { apiKey: `${KEY}-guild`, baseUrl: 'https://guild.example.test' }, 'admin');
    await service.upsert(GUILD, 'pixellab', { baseUrl: 'https://other.example.test' }, 'admin');
    expect(await service.resolve(GUILD, 'pixellab')).toMatchObject({ origin: 'guild', config: { apiKey: `${KEY}-guild`, baseUrl: 'https://other.example.test' } });

    await service.upsert(GUILD, 'pixellab', { apiKey: '' }, 'admin');
    expect(storedRow(db)?.encryptedApiKey).toBeNull();
    expect(await service.resolve(GUILD, 'pixellab')).toMatchObject({ origin: 'instance', config: { apiKey: `${KEY}-instance`, baseUrl: 'https://other.example.test' } });
  });

  it('une ligne désactivée coupe l\u0027intégration pour ce serveur seulement', async () => {
    const { service } = harness();
    await service.upsert(GUILD, 'pixellab', { enabled: false }, 'admin');
    expect(await service.resolve(GUILD, 'pixellab')).toEqual({ slug: 'pixellab', enabled: false, origin: 'guild', config: {} });
    expect(await service.active(GUILD, 'pixellab')).toBe(false);
    expect(await service.active(OTHER, 'pixellab')).toBe(true);
  });

  it('retirer la ligne rend la main à l\u0027instance', async () => {
    const { audit, service } = harness();
    await service.upsert(GUILD, 'pixellab', { apiKey: `${KEY}-guild` }, 'admin');
    expect(await service.remove(GUILD, 'pixellab', 'admin')).toBe(true);
    expect(await service.remove(GUILD, 'pixellab', 'admin')).toBe(false);
    expect(await service.resolve(GUILD, 'pixellab')).toMatchObject({ origin: 'instance' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'integration.removed', metadata: { slug: 'pixellab' } }));
  });

  it('un slug mal formé est refusé', async () => {
    const { service } = harness();
    await expect(service.upsert(GUILD, 'PixelLab', { apiKey: `${KEY}-guild` }, 'admin')).rejects.toThrow('Intégration invalide');
  });

  it('extrait de clé : de quoi la reconnaître, rien d\u0027autre', () => {
    expect(keyHintOf(null)).toBeNull();
    expect(keyHintOf('')).toBeNull();
    expect(keyHintOf('abcdefgh')).toBe('••••efgh');
  });
});
