import { describe, expect, it, vi } from 'vitest';
import { GuildProviderService } from './provider-store.service';
import { InMemoryModelCooldownStore } from './model-cooldown.store';
import { hasKeys, parseRecord, reservedKeys, visibleOptions } from './provider-store.json';
import { sameTarget } from './provider-route.links';

/**
 * Store des fournisseurs et des routes. Trois règles fixées ici, nées du
 * moteur multi-fournisseurs : les routes de conversation suivent le modèle
 * de la conversation par défaut tant qu'elles le partagent exactement ; lier
 * une route sans tout préciser conserve son repli et ses paramètres ; les
 * options réservées d'un fournisseur ne se perdent pas.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';
const MAIN = 'provider-main';
const OTHER = 'provider-other';

type RouteRow = {
  id: string;
  guildId: string;
  capability: string;
  providerId: string;
  modelId: string;
  fallbackProviderId: string | null;
  fallbackModelId: string | null;
  paramsJson: string | null;
  enabled: boolean;
  updatedAt?: Date;
};

const row = (capability: string, providerId: string, modelId: string, overrides: Partial<RouteRow> = {}): RouteRow => ({
  id: `route-${capability}`,
  guildId: GUILD,
  capability,
  providerId,
  modelId,
  fallbackProviderId: null,
  fallbackModelId: null,
  paramsJson: null,
  enabled: true,
  ...overrides,
});

/** Base en mémoire : les lignes de routes, deux fournisseurs connus (MAIN et OTHER), par identifiant ou par slug. */
function harness(rows: RouteRow[]) {
  const table = new Map(rows.map((route) => [route.capability, { ...route }]));
  const prisma = {
    guildProvider: {
      findFirst: vi.fn(async (args: { where: { id?: string; OR?: Array<{ id?: string; slug?: string }> } }): Promise<{ id: string; slug: string; cachedModelsJson?: string | null } | null> => {
        const wanted = [args.where.id, ...(args.where.OR ?? []).map((clause) => clause.id ?? clause.slug)].find(Boolean);
        return wanted === MAIN || wanted === OTHER ? { id: wanted, slug: wanted } : null;
      }),
      // Seul OTHER est déjà porteur d'un slug : un renommage vers lui est refusé.
      findUnique: vi.fn(async (args: { where: { guildId_slug: { slug: string } } }) => (args.where.guildId_slug.slug === OTHER ? { id: OTHER, slug: OTHER } : null)),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({ id: args.where.id, ...args.data })),
    },
    capabilityRoute: {
      findUnique: vi.fn(async (args: { where: { guildId_capability: { capability: string } } }) => table.get(args.where.guildId_capability.capability) ?? null),
      upsert: vi.fn(async (args: { where: { guildId_capability: { capability: string } }; create: RouteRow; update: Partial<RouteRow> }) => {
        const key = args.where.guildId_capability.capability;
        const saved = { ...(table.get(key) ?? args.create), ...args.update };
        table.set(key, saved);
        return saved;
      }),
      update: vi.fn(async (args: { where: { guildId_capability: { capability: string } }; data: Partial<RouteRow> }) => {
        const key = args.where.guildId_capability.capability;
        const saved = { ...(table.get(key) ?? row(key, '', '')), ...args.data };
        table.set(key, saved);
        return saved;
      }),
    },
  };
  const audit = { record: vi.fn() };
  const store = new GuildProviderService(prisma as never, audit as never, { token: 'x', ENCRYPTION_SECRET: KEY } as never, new InMemoryModelCooldownStore());
  return { store, prisma, audit, route: (capability: string) => table.get(capability) };
}

describe('GuildProviderService · routes de conversation liées', () => {
  it('changer le modèle de la conversation par défaut entraîne le raisonnement et l\u0027ingestion qui partageaient ce modèle', async () => {
    const h = harness([row('chat.default', MAIN, 'flash'), row('chat.reasoning', MAIN, 'flash'), row('chat.ingestion', MAIN, 'flash'), row('image.generate', MAIN, 'flash')]);
    const { followedBy } = await h.store.bindRoute(GUILD, 'chat.default', { providerId: OTHER, modelId: 'big' }, 'system');
    expect(followedBy).toEqual(['chat.reasoning', 'chat.ingestion']);
    expect(h.route('chat.default')).toMatchObject({ providerId: OTHER, modelId: 'big' });
    expect(h.route('chat.reasoning')).toMatchObject({ providerId: OTHER, modelId: 'big' });
    expect(h.route('chat.ingestion')).toMatchObject({ providerId: OTHER, modelId: 'big' });
    // Une capacité d'une autre famille ne suit jamais.
    expect(h.route('image.generate')).toMatchObject({ providerId: MAIN, modelId: 'flash' });
    expect(h.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'capability.bound', metadata: expect.objectContaining({ followedBy: ['chat.reasoning', 'chat.ingestion'] }) }));
  });

  it('une route réglée séparément (autre modèle, ou un repli) ne suit pas', async () => {
    const h = harness([
      row('chat.default', MAIN, 'flash'),
      row('chat.reasoning', OTHER, 'claude'),
      row('chat.ingestion', MAIN, 'flash', { fallbackProviderId: OTHER }),
    ]);
    const { followedBy } = await h.store.bindRoute(GUILD, 'chat.default', { providerId: OTHER, modelId: 'big' }, 'system');
    expect(followedBy).toEqual([]);
    expect(h.route('chat.reasoning')).toMatchObject({ providerId: OTHER, modelId: 'claude' });
    expect(h.route('chat.ingestion')).toMatchObject({ providerId: MAIN, modelId: 'flash', fallbackProviderId: OTHER });
  });

  it('lier le raisonnement ou l\u0027ingestion ne déplace jamais les autres routes', async () => {
    const h = harness([row('chat.default', MAIN, 'flash'), row('chat.reasoning', MAIN, 'flash'), row('chat.ingestion', MAIN, 'flash')]);
    expect((await h.store.bindRoute(GUILD, 'chat.reasoning', { providerId: OTHER, modelId: 'claude' }, 'system')).followedBy).toEqual([]);
    expect(h.route('chat.default')).toMatchObject({ providerId: MAIN, modelId: 'flash' });
    expect(h.route('chat.ingestion')).toMatchObject({ providerId: MAIN, modelId: 'flash' });
  });

  it('sans route par défaut préalable, il n\u0027y a rien à faire suivre', async () => {
    const h = harness([row('chat.reasoning', MAIN, 'flash')]);
    expect((await h.store.bindRoute(GUILD, 'chat.default', { providerId: MAIN, modelId: 'flash' }, 'system')).followedBy).toEqual([]);
    expect(h.route('chat.reasoning')).toMatchObject({ providerId: MAIN, modelId: 'flash' });
  });
});

describe('GuildProviderService · lier une route', () => {
  it('repli et paramètres non précisés : les actuels sont conservés ; un repli à null est retiré', async () => {
    const h = harness([row('music.generate', MAIN, 'V6_MINI', { fallbackProviderId: OTHER, fallbackModelId: 'V5', paramsJson: '{"style":"chill"}' })]);
    await h.store.bindRoute(GUILD, 'music.generate', { providerId: MAIN, modelId: 'V6' }, 'system');
    expect(h.route('music.generate')).toMatchObject({ modelId: 'V6', fallbackProviderId: OTHER, fallbackModelId: 'V5', paramsJson: '{"style":"chill"}' });

    await h.store.bindRoute(GUILD, 'music.generate', { providerId: MAIN, modelId: 'V6', fallbackProviderId: null }, 'system');
    expect(h.route('music.generate')).toMatchObject({ modelId: 'V6', fallbackProviderId: null, fallbackModelId: null, paramsJson: '{"style":"chill"}' });
  });

  it('le repli se donne par identifiant ou par slug, et un inconnu est refusé', async () => {
    const h = harness([]);
    await h.store.bindRoute(GUILD, 'music.generate', { providerId: MAIN, modelId: 'V6', fallbackProviderId: OTHER, fallbackModelId: 'V5' }, 'system');
    expect(h.route('music.generate')).toMatchObject({ fallbackProviderId: OTHER, fallbackModelId: 'V5' });
    await expect(h.store.bindRoute(GUILD, 'music.generate', { providerId: MAIN, modelId: 'V6', fallbackProviderId: 'ghost' }, 'system')).rejects.toThrow('repli introuvable');
  });

  it('une capacité mal formée est refusée avant tout écriture', async () => {
    const h = harness([]);
    await expect(h.store.bindRoute(GUILD, 'Musique', { providerId: MAIN, modelId: 'V6' }, 'system')).rejects.toThrow('Capacité invalide');
    expect(h.prisma.capabilityRoute.upsert).not.toHaveBeenCalled();
  });

  it('un modèle du catalogue qui ne sert pas la capacité : refus nommé, et rien n\u0027est écrit', async () => {
    const h = harness([]);
    h.prisma.guildProvider.findFirst.mockResolvedValue({ id: MAIN, slug: 'kie-ai', cachedModelsJson: JSON.stringify([{ id: 'V6_MINI', kind: 'music' }, { id: 'z-image', kind: 'image' }]) });
    await expect(h.store.bindRoute(GUILD, 'music.generate', { providerId: MAIN, modelId: 'z-image' }, 'system')).rejects.toThrow('Modèles de kie-ai qui la servent : V6_MINI');
    expect(h.prisma.capabilityRoute.upsert).not.toHaveBeenCalled();
    // Le modèle qui sert la capacité passe ; un identifiant saisi à la main passe aussi (on ne sait pas, on ne l'interdit pas).
    await h.store.bindRoute(GUILD, 'image.generate', { providerId: MAIN, modelId: 'z-image' }, 'system');
    await h.store.bindRoute(GUILD, 'tts.speak', { providerId: MAIN, modelId: 'ma-voix' }, 'system');
    expect(h.route('image.generate')).toMatchObject({ providerId: MAIN, modelId: 'z-image' });
    expect(h.route('tts.speak')).toMatchObject({ modelId: 'ma-voix' });
  });
});

describe('GuildProviderService · renommer un fournisseur', () => {
  it('même ligne et même identifiant : seules les données de nom changent, et la route reste sur le fournisseur', async () => {
    const h = harness([row('music.generate', MAIN, 'V6_MINI')]);
    expect(await h.store.rename(GUILD, MAIN, 'kie-ai', 'admin')).toBe(true);
    expect(h.prisma.guildProvider.update).toHaveBeenCalledWith({ where: { id: MAIN }, data: { slug: 'kie-ai' } });
    expect(h.audit.record).toHaveBeenCalledWith(expect.objectContaining({ guildId: GUILD, action: 'provider.renamed', actorId: 'admin', metadata: { providerId: MAIN, from: 'provider-main', to: 'kie-ai' } }));
    expect(h.route('music.generate')).toMatchObject({ providerId: MAIN, modelId: 'V6_MINI' });
  });

  it('un slug déjà pris, un fournisseur inconnu, ou le slug actuel', async () => {
    const h = harness([]);
    await expect(h.store.rename(GUILD, MAIN, 'provider-other')).rejects.toThrow('déjà pris');
    expect(h.prisma.guildProvider.update).not.toHaveBeenCalled();
    expect(await h.store.rename(GUILD, 'ghost', 'libre')).toBe(false);
    // Déjà ce slug : rien à écrire, et le nom est nettoyé comme à la création.
    await h.store.rename(GUILD, OTHER, 'KIE-AI');
    expect(h.prisma.guildProvider.update).toHaveBeenCalledWith({ where: { id: OTHER }, data: { slug: 'kie-ai' } });
  });
});

describe('sameTarget', () => {
  const base = { providerId: MAIN, modelId: 'flash', fallbackProviderId: null, fallbackModelId: null, paramsJson: null };
  it('identique seulement à cible strictement égale', () => {
    expect(sameTarget(base, { ...base })).toBe(true);
    expect(sameTarget(base, { ...base, modelId: 'big' })).toBe(false);
    expect(sameTarget(base, { ...base, paramsJson: '{"temperature":0.2}' })).toBe(false);
    expect(sameTarget(base, { ...base, fallbackProviderId: OTHER })).toBe(false);
    expect(sameTarget(base, null)).toBe(false);
    expect(sameTarget(undefined, base)).toBe(false);
  });
});

describe('GuildProviderService · clé et options d\u0027un fournisseur', () => {
  const previous = {
    id: MAIN,
    guildId: GUILD,
    slug: 'deepseek-official',
    displayName: 'IA',
    protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com',
    authType: 'bearer',
    authHeaderName: null,
    encryptedApiKey: 'v1:kept',
    customHeadersJson: '{"X-Title":"10cordes"}',
    extraConfigJson: '{"_source":"instance:llm","_model":"flash"}',
    cachedModelsJson: null,
    enabled: true,
  };

  function providerHarness() {
    const writes: Array<{ create: Record<string, unknown>; update: Record<string, unknown> }> = [];
    const prisma = {
      guildProvider: {
        findUnique: vi.fn(async () => previous),
        upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          writes.push(args);
          return { id: MAIN, ...args.create, ...Object.fromEntries(Object.entries(args.update).filter(([, value]) => value !== undefined)) };
        }),
      },
    };
    const store = new GuildProviderService(prisma as never, { record: vi.fn() } as never, { token: 'x', ENCRYPTION_SECRET: KEY } as never, new InMemoryModelCooldownStore());
    const last = () => writes.at(-1)?.update ?? {};
    return { store, last };
  }

  const base = { slug: 'deepseek-official', protocol: 'openai-chat' as const, baseUrl: 'https://api.deepseek.com' };

  it('sans nouvelle clé, l\u0027actuelle est conservée ; une chaîne vide l\u0027efface', async () => {
    const h = providerHarness();
    await h.store.upsert(GUILD, { ...base, displayName: 'IA' }, 'system');
    expect(h.last().encryptedApiKey).toBe('v1:kept');
    await h.store.upsert(GUILD, { ...base, apiKey: '' }, 'system');
    expect(h.last().encryptedApiKey).toBeNull();
  });

  it('options et en-têtes absents ou vides : les actuels sont conservés', async () => {
    const h = providerHarness();
    await h.store.upsert(GUILD, { ...base, displayName: 'IA', extraConfig: {}, customHeaders: {} }, 'system');
    expect(h.last().extraConfigJson).toBeUndefined();
    expect(h.last().customHeadersJson).toBeUndefined();
  });

  it('de nouvelles options fusionnent avec les clés réservées d\u0027origine (elles ne se perdent pas)', async () => {
    const h = providerHarness();
    await h.store.upsert(GUILD, { ...base, displayName: 'IA', extraConfig: { temperature: 0.3 } }, 'system');
    expect(JSON.parse(String(h.last().extraConfigJson))).toEqual({ _source: 'instance:llm', _model: 'flash', temperature: 0.3 });
    expect(h.last().customHeadersJson).toBeUndefined();
  });

  it('un formulaire ne montre ni ne saisit les clés réservées', () => {
    const options = parseRecord(previous.extraConfigJson);
    expect(visibleOptions(options)).toEqual({});
    expect(reservedKeys(options)).toEqual({ _source: 'instance:llm', _model: 'flash' });
    expect(hasKeys(undefined)).toBe(false);
    expect(hasKeys({})).toBe(false);
    expect(hasKeys({ a: 1 })).toBe(true);
  });

  it('une URL d\u0027un hôte privé ou non https est refusée (garde des requêtes sortantes)', async () => {
    const h = providerHarness();
    await expect(h.store.upsert(GUILD, { ...base, baseUrl: 'http://api.deepseek.com' }, 'system')).rejects.toThrow('https');
    await expect(h.store.upsert(GUILD, { ...base, baseUrl: 'https://192.168.1.20/v1' }, 'system')).rejects.toThrow('192.168.1.20');
  });
});
