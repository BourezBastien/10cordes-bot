import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfig, ProviderModel } from '../provider.types';
import { ProviderEditModalHandler } from './provider-hub.handlers';

/**
 * Modale « Fournisseur IA » (création et modification). Une soumission réelle
 * exige une interaction Discord (non simulable par un rig) : ces tests fixent
 * ce qui est enregistré, que la clé ne paraît jamais, et que le panneau
 * d'origine est rafraîchi. Les services du module sont des doublures.
 */

const GUILD = '1550000000000000001';
const OWNER = '1550000000000000002';
const ADMIN = '1550000000000000003';
const PROVIDER = 'cmProviderId0000000000000';
const MESSAGE = '1550000000000000005';
const SECRET = 'sk-test-secret';
const NEW_KEY = 'sk-nouvelle-cle';
const CATALOG: ProviderModel[] = [{ id: 'gpt-4o', kind: 'chat' }, { id: 'gpt-4o-mini', kind: 'chat' }];
const FIELDS_OK = { slug: ' OpenAI ', displayName: 'OpenAI officiel', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', apiKey: NEW_KEY, extraConfig: '{"temperature": 0.4}' };

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

function harness() {
  const config: ProviderConfig = {
    id: PROVIDER, guildId: GUILD, slug: 'openai', displayName: 'OpenAI', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer', authHeaderName: null, apiKey: SECRET, customHeaders: {}, extraConfig: {}, models: CATALOG, enabled: true,
  };
  const adapter = {
    capabilities: ['chat.default'],
    testConnection: vi.fn(async () => ({ ok: true, summary: 'Clé acceptée', modelsFound: 2 })),
    discoverModels: vi.fn(async () => CATALOG),
  };
  const store = {
    list: vi.fn(async () => [config]),
    get: vi.fn(async () => config),
    upsert: vi.fn(async () => config),
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

const CREATE = { customId: 'provider-edit', fields: FIELDS_OK };
const EDIT = { customId: `provider-edit~p=${PROVIDER}&m=${MESSAGE}`, fields: { ...FIELDS_OK, apiKey: '' } };

describe('modale provider-edit · enregistrement', () => {
  it('création : upsert reçoit les champs nets, puis connexion et catalogue ; la clé ne paraît jamais', async () => {
    const h = harness();
    const interaction = fakeInteraction(CREATE);
    await run(h, interaction);
    expect(h.store.upsert).toHaveBeenCalledTimes(1);
    expect(h.store.upsert).toHaveBeenCalledWith(GUILD, { slug: 'openai', displayName: 'OpenAI officiel', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', apiKey: NEW_KEY, extraConfig: { temperature: 0.4 } }, ADMIN);
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

  it('modification, clé laissée vide : la clé actuelle est conservée et le panneau d\u0027origine est rafraîchi', async () => {
    const h = harness();
    const interaction = fakeInteraction(EDIT);
    await run(h, interaction);
    expect(h.store.upsert).toHaveBeenCalledWith(GUILD, expect.objectContaining({ apiKey: undefined }), ADMIN);
    expect(h.adapter.testConnection).toHaveBeenCalledWith(h.config);
    expect(interaction.channel.messages.edit).toHaveBeenCalledWith(MESSAGE, expect.anything());
    const json = JSON.stringify(interaction.channel.messages.edit.mock.calls[0]?.[1]);
    expect(json).toContain(`provider:capability~p=${PROVIDER}`);
    expect(json).not.toContain(SECRET);
    expect(ephemeralTexts(interaction).at(-1)).not.toContain('Le slug a changé');
  });

  it('slug changé, clé vide : un nouveau fournisseur emporte la clé, et la confirmation le dit', async () => {
    const h = harness();
    const interaction = fakeInteraction({ ...EDIT, fields: { ...EDIT.fields, slug: 'OpenAI-Pro' } });
    await run(h, interaction);
    expect(h.store.upsert).toHaveBeenCalledWith(GUILD, expect.objectContaining({ slug: 'openai-pro', apiKey: SECRET }), ADMIN);
    expect(h.store.remove).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('Le slug a changé');
    expect(JSON.stringify(ephemeralTexts(interaction))).not.toContain(SECRET);
  });

  it('sans clé : rien à contrôler, la confirmation le dit', async () => {
    const h = harness();
    h.store.upsert.mockResolvedValue({ ...h.config, apiKey: null });
    const interaction = fakeInteraction({ ...CREATE, fields: { ...FIELDS_OK, apiKey: '' } });
    await run(h, interaction);
    expect(h.adapter.testConnection).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('Aucune clé enregistrée');
  });

  it.each([
    ['protocole inconnu', { protocol: 'soap' }, 'Protocole inconnu'],
    ['options JSON invalides', { extraConfig: '{temperature:' }, 'options JSON'],
    ['options JSON qui ne sont pas un objet', { extraConfig: '[1, 2]' }, 'options JSON'],
  ] as const)('%s : rien n\u0027est enregistré, la raison est donnée', async (_label, patch, reason) => {
    const h = harness();
    const interaction = fakeInteraction({ ...CREATE, fields: { ...FIELDS_OK, ...patch } });
    await expect(run(h, interaction)).resolves.toBeUndefined();
    expect(h.store.upsert).not.toHaveBeenCalled();
    expect(interaction.channel.messages.edit).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain(reason);
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
