import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../test/fake-db';
import { mergeCatalog } from './provider-store.json';
import { GuildProviderService } from './provider-store.service';
import { InMemoryModelCooldownStore } from './model-cooldown.store';
import { ProviderError } from './provider.types';
import type { ProviderModel } from './provider.types';

/**
 * Catalogue des modèles d'un fournisseur, écrit par le VRAI store dans une
 * base en mémoire. Ce que fixent ces tests : un rafraîchissement du catalogue
 * découvert ne perd jamais un slug saisi à la main, et un slug saisi à la main
 * ne refuse jamais une liaison.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';
const ACTOR = '1550000000000000002';
const SECRETS = { token: 'x', ENCRYPTION_SECRET: KEY } as never;

function harness() {
  const db = fakeDb();
  const audit = { record: vi.fn() };
  const store = new GuildProviderService(db as never, audit as never, SECRETS, new InMemoryModelCooldownStore());
  return { db, audit, store, catalog: store.catalog };
}

/** Fournisseur déjà enregistré sur le serveur (son identifiant vient de la base). */
async function seeded() {
  const h = harness();
  const provider = await h.store.upsert(GUILD, { slug: 'main', protocol: 'openai-chat', baseUrl: 'https://api.example.com/v1', apiKey: KEY }, 'system');
  return { ...h, provider };
}

/** Identifiant et origine de chaque modèle, lus dans la colonne du catalogue. */
function entriesOf(db: ReturnType<typeof fakeDb>, providerId: string): Array<[string, string | undefined]> {
  const models: ProviderModel[] = JSON.parse(String(db.guildProvider.rows.get(providerId)?.cachedModelsJson ?? '[]'));
  return models.map((model) => [model.id, model.origin]);
}

describe('mergeCatalog', () => {
  it('les modèles découverts remplacent les découverts ; les slugs saisis à la main restent', () => {
    const merged = mergeCatalog(
      [{ id: 'a', kind: 'chat' }, { id: 'c', kind: 'chat' }],
      [{ id: 'a', kind: 'chat' }, { id: 'b', kind: 'chat' }, { id: 'mine', origin: 'manual' }],
    );
    expect(merged).toEqual([
      { id: 'a', kind: 'chat' },
      { id: 'c', kind: 'chat' },
      { id: 'mine', origin: 'manual' },
    ]);
  });

  it('un slug saisi à la main que le fournisseur liste désormais garde sa marque', () => {
    expect(mergeCatalog([{ id: 'mine', kind: 'tts' }], [{ id: 'mine', origin: 'manual' }])).toEqual([{ id: 'mine', kind: 'tts', origin: 'manual' }]);
  });
});

describe('ProviderCatalogStore · rafraîchir le catalogue découvert', () => {
  it('un slug saisi à la main survit à un rafraîchissement, à sa marque', async () => {
    const { db, store, catalog, provider } = await seeded();
    await store.saveModels(GUILD, provider.id, [{ id: 'a', kind: 'chat' }, { id: 'b', kind: 'chat' }]);
    await catalog.addManual(GUILD, provider.id, 'ma-voix', ACTOR);
    await store.saveModels(GUILD, provider.id, [{ id: 'a', kind: 'chat' }, { id: 'c', kind: 'chat' }]);

    expect(entriesOf(db, provider.id)).toEqual([
      ['a', undefined],
      ['c', undefined],
      ['ma-voix', 'manual'],
    ]);
  });
});

describe('ProviderCatalogStore · slug saisi à la main', () => {
  it('s\u0027ajoute sans famille déclarée, et survit quand le fournisseur se met à le lister', async () => {
    const { db, store, catalog, provider } = await seeded();
    const added = await catalog.addManual(GUILD, provider.id, '  ma-voix  ', ACTOR);
    expect(added).toEqual([{ id: 'ma-voix', origin: 'manual' }]);
    // Saisi à la main : aucune famille devinée, donc aucune liaison refusée (un modèle découvert, lui, peut en refuser).
    await expect(store.bindRoute(GUILD, 'image.generate', { providerId: provider.id, modelId: 'ma-voix' }, ACTOR)).resolves.toEqual({ followedBy: [] });

    await store.saveModels(GUILD, provider.id, [{ id: 'ma-voix', kind: 'music' }]);
    expect(entriesOf(db, provider.id)).toEqual([['ma-voix', 'manual']]);
  });

  it('déjà au catalogue : rien ne change, rien n\u0027est audité', async () => {
    const { audit, catalog, provider } = await seeded();
    await catalog.addManual(GUILD, provider.id, 'ma-voix', ACTOR);
    audit.record.mockClear();

    const models = await catalog.addManual(GUILD, provider.id, 'ma-voix', ACTOR, 'api');
    expect(models.map((model) => model.id)).toEqual(['ma-voix']);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('chaque ajout et chaque retrait est audité, avec la source de l\u0027appelant', async () => {
    const { db, audit, catalog, provider } = await seeded();
    await catalog.addManual(GUILD, provider.id, 'ma-voix', ACTOR);
    expect(audit.record).toHaveBeenLastCalledWith({ guildId: GUILD, source: 'agent', action: 'provider.model_added', actorId: ACTOR, metadata: { providerId: provider.id, slug: 'main', modelId: 'ma-voix' } });

    await catalog.addManual(GUILD, provider.id, 'autre', ACTOR, 'api');
    expect(audit.record).toHaveBeenLastCalledWith({ guildId: GUILD, source: 'api', action: 'provider.model_added', actorId: ACTOR, metadata: { providerId: provider.id, slug: 'main', modelId: 'autre' } });

    const removed = await catalog.removeManual(GUILD, provider.id, 'ma-voix', ACTOR, 'api');
    expect(removed.outcome).toBe('removed');
    expect(removed.models.map((model) => model.id)).toEqual(['autre']);
    expect(entriesOf(db, provider.id)).toEqual([['autre', 'manual']]);
    expect(audit.record).toHaveBeenLastCalledWith({ guildId: GUILD, source: 'api', action: 'provider.model_removed', actorId: ACTOR, metadata: { providerId: provider.id, slug: 'main', modelId: 'ma-voix' } });
  });

  it('un modèle que le fournisseur liste ne se retire pas, un modèle inconnu non plus : rien n\u0027est écrit', async () => {
    const { db, audit, catalog, provider } = await seeded();
    await catalog.save(GUILD, provider.id, [{ id: 'listed', kind: 'chat' }]);
    await catalog.addManual(GUILD, provider.id, 'mine', ACTOR);
    const before = db.guildProvider.rows.get(provider.id)?.cachedModelsJson;
    audit.record.mockClear();

    expect((await catalog.removeManual(GUILD, provider.id, 'listed', ACTOR, 'api')).outcome).toBe('discovered');
    expect((await catalog.removeManual(GUILD, provider.id, 'ghost', ACTOR, 'api')).outcome).toBe('missing');
    expect(db.guildProvider.rows.get(provider.id)?.cachedModelsJson).toBe(before);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('un fournisseur inconnu sur ce serveur est refusé', async () => {
    const { catalog } = await seeded();
    await expect(catalog.addManual(GUILD, 'ghost', 'ma-voix', ACTOR)).rejects.toBeInstanceOf(ProviderError);
    await expect(catalog.removeManual(GUILD, 'ghost', 'ma-voix', ACTOR)).rejects.toThrow('Fournisseur introuvable');
  });
});
