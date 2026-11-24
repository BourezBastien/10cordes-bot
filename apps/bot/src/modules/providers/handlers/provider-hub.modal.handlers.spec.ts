import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfig, ProviderModel } from '../provider.types';
import { ProviderEditModalHandler } from './provider-hub.handlers';

/**
 * Modale « Fournisseur IA » (création et modification). Une soumission réelle
 * exige une interaction Discord (non simulable par un rig) : ces tests fixent
 * ce qui est enregistré, que la clé ne paraît jamais, et que le panneau
 * d'origine est rafraîchi. Les services du module sont des doublures.
 *
 * Incident du 24/11 : la modale portait six champs (slug et nom compris),
 * Discord la refusait entière. Elle en porte cinq, et le slug se déduit du nom.
 */

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';

const GUILD = '1550000000000000001';
const OWNER = '1550000000000000002';
const ADMIN = '1550000000000000003';
const PROVIDER = 'cmProviderId0000000000000';
const MESSAGE = '1550000000000000005';
/** Clés fictives, sans valeur utilisable. */
const SECRET = 'test-key-not-real-current';
const NEW_KEY = 'test-key-not-real-new';
const CATALOG: ProviderModel[] = [{ id: 'gpt-4o', kind: 'chat' }, { id: 'gpt-4o-mini', kind: 'chat' }];
const FIELDS_OK = { [NAME]: 'OpenAI', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', apiKey: NEW_KEY, advanced: '{"temperature": 0.4}' };

interface FakeInteraction {
  id: string;
  customId: string;
  user: { id: string };
  guild: { ownerId: string };
  memberPermissions: { toArray: () => string[] };
  guildId: string | null;
  /** Une soumission de modale ne porte jamais le message du panneau. */
  message: undefined;
  channel: { isTextBased: () => boolean; messages: { edit: ReturnType<typeof vi.fn> } };
  reply: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  fields: { getTextInputValue: (id: string) => string };
}

function fakeInteraction({ customId = 'provider-edit', fields = {}, id = 'interaction-9' }: { customId?: string; fields?: Record<string, string>; id?: string } = {}): FakeInteraction {
  return {
    id,
    customId,
    user: { id: ADMIN },
    guild: { ownerId: OWNER },
    memberPermissions: { toArray: () => ['Administrator'] },
    guildId: GUILD,
    message: undefined,
    channel: { isTextBased: () => true, messages: { edit: vi.fn().mockResolvedValue(undefined) } },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    fields: { getTextInputValue: (field: string) => fields[field] ?? '' },
  };
}

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: PROVIDER,
    guildId: GUILD,
    slug: 'openai',
    displayName: 'OpenAI',
    protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    authHeaderName: null,
    apiKey: SECRET,
    customHeaders: {},
    extraConfig: {},
    models: CATALOG,
    enabled: true,
    ...overrides,
  };
}

function harness() {
  const config = provider();
  const adapter = {
    capabilities: ['chat.default'],
    testConnection: vi.fn(async () => ({ ok: true, summary: 'Clé acceptée', modelsFound: 2 })),
    discoverModels: vi.fn(async () => CATALOG),
  };
  // Un fournisseur « openai » existe déjà : c'est la situation d'une modification.
  // Les créations le retirent, sauf celles qui testent la collision de slug.
  const store = {
    list: vi.fn(async (): Promise<ProviderConfig[]> => [config]),
    get: vi.fn(async (): Promise<ProviderConfig | null> => config),
    upsert: vi.fn(async (_guildId: string, _input: Record<string, unknown>): Promise<ProviderConfig> => config),
    remove: vi.fn(async () => true),
    saveModels: vi.fn(async () => undefined),
    bindRoute: vi.fn(async (): Promise<{ followedBy: string[] }> => ({ followedBy: [] })),
    routes: vi.fn(async () => []),
  };
  return { config, adapter, store, registry: { resolve: vi.fn(() => adapter) } };
}

type Harness = ReturnType<typeof harness>;

const run = (h: Harness, interaction: FakeInteraction): Promise<void> => new ProviderEditModalHandler(h.store as never, h.registry as never).handle(interaction as never);

/** Textes Components V2 des messages éphémères. */
function ephemeralTexts(interaction: FakeInteraction): string[] {
  const calls = [...interaction.reply.mock.calls, ...interaction.editReply.mock.calls];
  return calls.map((call) => {
    const payload = call[0] as { components?: Array<{ toJSON: () => { content?: string } }> };
    return payload.components?.map((component) => component.toJSON().content ?? '').join('\n') ?? '';
  });
}

/** Ce que le store a reçu (hors le serveur et l'auteur). */
const savedInput = (h: Harness): Record<string, unknown> => h.store.upsert.mock.calls[0]?.[1] ?? {};

const CREATE = { customId: 'provider-edit', fields: FIELDS_OK };
const EDIT = { customId: `provider-edit~p=${PROVIDER}&m=${MESSAGE}`, fields: { ...FIELDS_OK, apiKey: '' } };

describe('modale provider-edit · création', () => {
  it('le nom devient le nom affiché et le slug en est déduit ; connexion puis catalogue ; la clé ne paraît jamais', async () => {
    const h = harness();
    h.store.list.mockResolvedValue([]);
    const interaction = fakeInteraction(CREATE);
    await run(h, interaction);
    expect(h.store.upsert).toHaveBeenCalledTimes(1);
    expect(h.store.upsert).toHaveBeenCalledWith(GUILD, { slug: 'openai', displayName: 'OpenAI', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', apiKey: NEW_KEY, extraConfig: { temperature: 0.4 } }, ADMIN);
    expect(h.adapter.testConnection).toHaveBeenCalledTimes(1);
    expect(h.adapter.testConnection.mock.invocationCallOrder[0]).toBeLessThan(h.adapter.discoverModels.mock.invocationCallOrder[0]);
    expect(h.adapter.discoverModels.mock.invocationCallOrder[0]).toBeLessThan(h.store.saveModels.mock.invocationCallOrder[0]);
    expect(h.store.saveModels).toHaveBeenCalledWith(GUILD, PROVIDER, CATALOG);
    const text = JSON.stringify(ephemeralTexts(interaction));
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(NEW_KEY);
    expect(ephemeralTexts(interaction).at(-1)).toContain('**openai** enregistré');
    // Sans identifiant de panneau dans la modale, rien n'est réaffiché.
    expect(interaction.channel.messages.edit).not.toHaveBeenCalled();
  });

  it.each([
    ['OpenRouter', 'openrouter'],
    ['Kie.ai', 'kie-ai'],
    ['Google AI Studio', 'google-ai-studio'],
    ['Éléphant IA', 'elephant-ia'],
    ['  Claude   3.5  ', 'claude-3-5'],
    ['a'.repeat(60), 'a'.repeat(48)],
  ])('« %s » donne le slug « %s »', async (typed, slug) => {
    const h = harness();
    await run(h, fakeInteraction({ ...CREATE, fields: { ...FIELDS_OK, [NAME]: typed } }));
    expect(savedInput(h)).toMatchObject({ slug });
  });

  it('nom déjà pris sur le serveur : le slug suivant qui est libre', async () => {
    for (const [existing, expected] of [
      [['openai'], 'openai-2'],
      [['openai', 'openai-2'], 'openai-3'],
      [['openai', 'openai-3'], 'openai-2'],
      [['autre'], 'openai'],
    ] as const) {
      const h = harness();
      h.store.list.mockResolvedValue(existing.map((slug) => provider({ slug })));
      await run(h, fakeInteraction(CREATE));
      expect(savedInput(h)).toMatchObject({ slug: expected });
    }
  });

  it('nom sans lettres ni chiffres : refusé en clair, rien n\u0027est enregistré', async () => {
    const h = harness();
    const interaction = fakeInteraction({ ...CREATE, fields: { ...FIELDS_OK, [NAME]: '***' } });
    await expect(run(h, interaction)).resolves.toBeUndefined();
    expect(h.store.upsert).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('Nom invalide');
  });

  it('sans clé : rien à contrôler, la confirmation le dit', async () => {
    const h = harness();
    h.store.upsert.mockResolvedValue({ ...h.config, apiKey: null });
    const interaction = fakeInteraction({ ...CREATE, fields: { ...FIELDS_OK, apiKey: '' } });
    await run(h, interaction);
    expect(h.adapter.testConnection).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('Aucune clé enregistrée');
  });
});

describe('modale provider-edit · modification', () => {
  it('clé laissée vide : la clé actuelle est conservée et le panneau d\u0027origine est rafraîchi', async () => {
    const h = harness();
    const interaction = fakeInteraction(EDIT);
    await run(h, interaction);
    expect(h.store.upsert).toHaveBeenCalledWith(GUILD, expect.objectContaining({ apiKey: undefined }), ADMIN);
    expect(h.adapter.testConnection).toHaveBeenCalledWith(h.config);
    expect(interaction.channel.messages.edit).toHaveBeenCalledWith(MESSAGE, expect.anything());
    const json = JSON.stringify(interaction.channel.messages.edit.mock.calls[0]?.[1]);
    expect(json).toContain(`provider:capability~p=${PROVIDER}`);
    expect(json).not.toContain(SECRET);
  });

  it('le slug ne change jamais : c\u0027est l\u0027identifiant, ses routes en dépendent', async () => {
    const h = harness();
    const interaction = fakeInteraction({ ...EDIT, fields: { ...EDIT.fields, [NAME]: 'OpenAI professionnel' } });
    await run(h, interaction);
    expect(h.store.upsert).toHaveBeenCalledWith(GUILD, expect.objectContaining({ slug: 'openai', displayName: 'OpenAI professionnel' }), ADMIN);
    expect(JSON.stringify(ephemeralTexts(interaction))).not.toContain(SECRET);
  });

  it('nouvelle clé saisie : elle remplace l\u0027actuelle', async () => {
    const h = harness();
    await run(h, fakeInteraction({ ...EDIT, fields: { ...EDIT.fields, apiKey: NEW_KEY } }));
    expect(h.store.upsert).toHaveBeenCalledWith(GUILD, expect.objectContaining({ apiKey: NEW_KEY }), ADMIN);
  });

  it('fournisseur disparu : refus éphémère, rien n\u0027est enregistré', async () => {
    const h = harness();
    h.store.get.mockResolvedValue(null);
    const interaction = fakeInteraction(EDIT);
    await run(h, interaction);
    expect(h.store.upsert).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('introuvable');
  });
});

describe('modale provider-edit · config avancée', () => {
  it('authentification et en-têtes vont dans leurs colonnes, le reste en options', async () => {
    const h = harness();
    const advanced = '{"authType":"header","authHeaderName":"X-API-Key","customHeaders":{"X-Org":"acme"},"temperature":0.3}';
    await run(h, fakeInteraction({ ...CREATE, fields: { ...FIELDS_OK, advanced } }));
    expect(savedInput(h)).toMatchObject({ authType: 'header', authHeaderName: 'X-API-Key', customHeaders: { 'X-Org': 'acme' }, extraConfig: { temperature: 0.3 } });
  });

  it.each([['vide', ''], ['objet vide', '{}']])('%s : rien ne change pour l\u0027authentification, les en-têtes ni les options', async (_label, advanced) => {
    const h = harness();
    await run(h, fakeInteraction({ ...CREATE, fields: { ...FIELDS_OK, advanced } }));
    const input = savedInput(h);
    for (const key of ['authType', 'authHeaderName', 'customHeaders', 'extraConfig']) expect(input).not.toHaveProperty(key);
  });

  it.each([
    ['JSON invalide', '{"temperature":', 'Config avancée invalide'],
    ['JSON qui n\u0027est pas un objet', '[1, 2]', 'Config avancée invalide'],
    ['type d\u0027authentification inconnu', '{"authType":"basic"}', 'authType'],
    ['en-têtes qui ne sont pas des chaînes', '{"customHeaders":{"X-Org":5}}', 'customHeaders'],
    ['en-têtes qui ne sont pas un objet', '{"customHeaders":"acme"}', 'customHeaders'],
    ['nom d\u0027en-tête vide', '{"authHeaderName":" "}', 'authHeaderName'],
  ] as const)('%s : rien n\u0027est enregistré, la raison est donnée', async (_label, advanced, reason) => {
    const h = harness();
    const interaction = fakeInteraction({ ...CREATE, fields: { ...FIELDS_OK, advanced } });
    await expect(run(h, interaction)).resolves.toBeUndefined();
    expect(h.store.upsert).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain(reason);
  });

  it('protocole inconnu : rien n\u0027est enregistré, la raison est donnée', async () => {
    const h = harness();
    const interaction = fakeInteraction({ ...CREATE, fields: { ...FIELDS_OK, protocol: 'soap' } });
    await expect(run(h, interaction)).resolves.toBeUndefined();
    expect(h.store.upsert).not.toHaveBeenCalled();
    expect(interaction.channel.messages.edit).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('Protocole inconnu');
  });
});

describe('modale provider-edit · contrôle de connexion', () => {
  it('le fournisseur reste enregistré quand le contrôle est refusé ou échoue : jamais « action impossible »', async () => {
    for (const refused of [{ ok: false, summary: 'HTTP 401 : clé invalide', modelsFound: 0 }, new Error('Requête impossible')]) {
      const h = harness();
      if (refused instanceof Error) h.adapter.testConnection.mockRejectedValue(refused);
      else h.adapter.testConnection.mockResolvedValue(refused);
      const interaction = fakeInteraction(CREATE);
      await expect(run(h, interaction)).resolves.toBeUndefined();
      expect(h.adapter.discoverModels).not.toHaveBeenCalled();
      expect(h.store.saveModels).not.toHaveBeenCalled();
      const text = ephemeralTexts(interaction).at(-1) ?? '';
      expect(text).toContain('**openai** enregistré');
      expect(text).toContain('La connexion échoue');
      expect(text).not.toContain('Action impossible');
    }
  });

  it('catalogue irrécupérable après un contrôle réussi : la connexion est annoncée réussie, le catalogue manquant', async () => {
    const h = harness();
    h.adapter.discoverModels.mockRejectedValue(new Error('Requête impossible'));
    const interaction = fakeInteraction(CREATE);
    await run(h, interaction);
    expect(h.store.saveModels).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('catalogue non récupéré : Requête impossible');
  });
});
