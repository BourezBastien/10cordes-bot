import { describe, expect, it, vi } from 'vitest';
import { ModalService } from '@spraxium/components';
import { ComponentType, MessageFlags } from 'discord.js';
import { MODAL_MAX_COMPONENTS } from '../../../shared/ui/modal-limits';
import { ProviderError, type ProviderConfig } from '../provider.types';
import { ProviderAddButtonHandler, ProviderDeleteButtonHandler, ProviderEditButtonHandler, ProviderPageButtonHandler, ProviderRefreshButtonHandler, ProviderTestButtonHandler } from './provider-hub.buttons.handlers';

/**
 * Boutons du panneau « Fournisseurs et modèles ». Un vrai clic exige une
 * interaction Discord (non simulable par un rig) : ces tests fixent l'effet
 * attendu de chaque handler sur des doublures des services du module (ni
 * base de données, ni réseau). La garde est couverte pour les dix handlers
 * dans provider-hub.handlers.spec.ts.
 */

const GUILD = '1550000000000000001';
const OWNER = '1550000000000000002';
const ADMIN = '1550000000000000003';
const PROVIDER = 'cmProviderId0000000000000';
const SECRET = 'sk-test-secret';
// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';
/** Champs de la modale, dans l'ordre ; à l'ajout, seul le protocole est prérempli. */
const FIELDS = ['name', 'protocol', 'baseUrl', 'apiKey', 'advanced'];
const ADD_VALUES = [undefined, 'openai-chat', undefined, undefined, undefined];

/** Modale montrée : identifiants, valeurs, caractère exigé de chaque champ. */
function shownFields(interaction: FakeInteraction): Array<{ custom_id: string; value?: string; required?: boolean }> {
  const modal = shownModal(interaction);
  return modal.components.map((entry) => ({ custom_id: entry.component.custom_id, value: entry.component.value, required: entry.component.required }));
}

interface FakeInteraction {
  id: string;
  customId: string;
  user: { id: string };
  guild: { ownerId: string };
  memberPermissions: { toArray: () => string[] };
  guildId: string | null;
  message: { id: string; edit: ReturnType<typeof vi.fn> };
  reply: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
}

function fakeInteraction({ owner = false, customId = '' }: { owner?: boolean; customId?: string } = {}): FakeInteraction {
  return {
    id: 'interaction-9',
    customId,
    user: { id: owner ? OWNER : ADMIN },
    guild: { ownerId: OWNER },
    memberPermissions: { toArray: () => (owner ? [] : ['Administrator']) },
    guildId: GUILD,
    message: { id: '1550000000000000005', edit: vi.fn().mockResolvedValue(undefined) },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
}

function harness() {
  const config: ProviderConfig = {
    id: PROVIDER, guildId: GUILD, slug: 'openai', displayName: 'OpenAI', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer', authHeaderName: null, apiKey: SECRET, customHeaders: {}, extraConfig: { temperature: 0.7 }, models: [{ id: 'gpt-4o', kind: 'chat' }], enabled: true,
  };
  const catalog = [{ id: 'gpt-4o', kind: 'chat' }, { id: 'gpt-4o-mini', kind: 'chat' }];
  const adapter = {
    capabilities: ['chat.default'],
    testConnection: vi.fn(async () => ({ ok: true, summary: 'Clé acceptée', modelsFound: 2 })),
    discoverModels: vi.fn(async () => catalog),
  };
  const store = {
    list: vi.fn(async (): Promise<ProviderConfig[]> => [config]),
    get: vi.fn(async (): Promise<ProviderConfig | null> => config),
    upsert: vi.fn(async (): Promise<ProviderConfig> => config),
    remove: vi.fn(async () => true),
    saveModels: vi.fn(async () => undefined),
    bindRoute: vi.fn(async (): Promise<{ followedBy: string[] }> => ({ followedBy: [] })),
    routes: vi.fn(async () => []),
  };
  return { config, catalog, adapter, store, registry: { resolve: vi.fn(() => adapter) } };
}

type Harness = ReturnType<typeof harness>;

/** Textes Components V2 des messages éphémères (reply, puis editReply après un acquittement). */
function ephemeralTexts(interaction: FakeInteraction): string[] {
  const calls = [...interaction.reply.mock.calls, ...interaction.editReply.mock.calls];
  return calls.map((call) => {
    const payload = call[0] as { components?: Array<{ toJSON: () => { content?: string } }> };
    return payload.components?.map((component) => component.toJSON().content ?? '').join('\n') ?? '';
  });
}

/** Panneau envoyé à l'édition du message, sérialisé : customIds des menus, options par défaut, boutons. */
function shownPanel(interaction: FakeInteraction): { selects: string[]; defaults: string[][]; buttons: string[] } {
  type Node = { type: number; custom_id?: string; components?: Node[]; options?: Array<{ value: string; default?: boolean }> };
  const json = JSON.parse(JSON.stringify(interaction.message.edit.mock.calls[0]?.[0])) as { components: Array<{ components: Node[] }> };
  const flat = (json.components[0]?.components ?? []).filter((node) => node.type === ComponentType.ActionRow).flatMap((row) => row.components ?? []);
  const selects = flat.filter((node) => node.type === ComponentType.StringSelect);
  return {
    selects: selects.map((node) => node.custom_id ?? ''),
    defaults: selects.map((node) => (node.options ?? []).filter((option) => option.default).map((option) => option.value)),
    buttons: flat.filter((node) => node.type === ComponentType.Button).map((node) => node.custom_id ?? ''),
  };
}

const shownModal = (interaction: FakeInteraction): { custom_id: string; components: Array<{ component: { custom_id: string; value?: string; required?: boolean } }> } =>
  interaction.showModal.mock.calls[0]?.[0];
const asInteraction = (interaction: FakeInteraction): never => interaction as never;
const modals = (): ModalService => new ModalService({} as never);
const editHandler = (h: Harness): ProviderEditButtonHandler => new ProviderEditButtonHandler(h.store as never, h.registry as never, modals());

describe('provider:add et provider:edit', () => {
  it('« Ajouter » : la modale est la PREMIÈRE réponse, dans la limite de Discord, et désigne le panneau à rafraîchir au retour', async () => {
    const h = harness();
    const interaction = fakeInteraction({ customId: 'provider:add' });
    await new ProviderAddButtonHandler(h.store as never, h.registry as never, modals()).handle(asInteraction(interaction));
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.message.edit).not.toHaveBeenCalled();
    const modal = shownModal(interaction);
    expect(modal.custom_id).toBe('provider-edit~m=1550000000000000005');
    // Incident du 24/11 : six champs, Discord rejetait la modale entière.
    expect(modal.components.length).toBeLessThanOrEqual(MODAL_MAX_COMPONENTS);
    const fields = shownFields(interaction);
    expect(fields.map((field) => field.custom_id)).toEqual(FIELDS);
    expect(fields.map((field) => field.value)).toEqual(ADD_VALUES);
  });

  it('la clé et la config avancée sont explicitement facultatives : Discord les exige sinon', async () => {
    const interaction = fakeInteraction({ customId: 'provider:add' });
    await new ProviderAddButtonHandler(harness().store as never, harness().registry as never, modals()).handle(asInteraction(interaction));
    const required = Object.fromEntries(shownFields(interaction).map((field) => [field.custom_id, field.required]));
    expect(required).toEqual({ name: true, protocol: true, baseUrl: true, apiKey: false, advanced: false });
  });

  it('propriétaire du serveur : autorisé comme un administrateur', async () => {
    const interaction = fakeInteraction({ owner: true, customId: 'provider:add' });
    await new ProviderAddButtonHandler(harness().store as never, harness().registry as never, modals()).handle(asInteraction(interaction));
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
  });

  it('« Modifier » : la modale est préremplie, sans la clé, et désigne le fournisseur et le panneau', async () => {
    const h = harness();
    const interaction = fakeInteraction({ customId: `provider:edit~p=${PROVIDER}` });
    await editHandler(h).handle(asInteraction(interaction));
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    const modal = shownModal(interaction);
    expect(modal.custom_id).toBe(`provider-edit~p=${PROVIDER}&m=1550000000000000005`);
    const values = Object.fromEntries(shownFields(interaction).map((field) => [field.custom_id, field.value]));
    expect(values).toEqual({ [NAME]: 'OpenAI', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', apiKey: undefined, advanced: '{"temperature":0.7}' });
    expect(JSON.stringify(modal)).not.toContain(SECRET);
  });

  it('« Modifier » un fournisseur disparu : refus éphémère, aucune modale', async () => {
    const h = harness();
    h.store.get.mockResolvedValue(null);
    const interaction = fakeInteraction({ customId: 'provider:edit~p=parti' });
    await editHandler(h).handle(asInteraction(interaction));
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('introuvable');
  });
});

describe('provider:test', () => {
  const CUSTOM_ID = `provider:test~p=${PROVIDER}~c=chat.default~n=1`;
  const run = (h: Harness, interaction: FakeInteraction): Promise<void> => new ProviderTestButtonHandler(h.store as never, h.registry as never).handle(asInteraction(interaction));

  it('contrôle la connexion, puis retient le catalogue découvert, puis réaffiche et rend le verdict', async () => {
    const h = harness();
    const interaction = fakeInteraction({ customId: CUSTOM_ID });
    await run(h, interaction);
    expect(h.adapter.testConnection).toHaveBeenCalledTimes(1);
    expect(h.adapter.testConnection).toHaveBeenCalledWith(h.config);
    expect(h.adapter.testConnection.mock.invocationCallOrder[0]).toBeLessThan(h.adapter.discoverModels.mock.invocationCallOrder[0]);
    expect(h.adapter.discoverModels.mock.invocationCallOrder[0]).toBeLessThan(h.store.saveModels.mock.invocationCallOrder[0]);
    expect(h.store.saveModels).toHaveBeenCalledWith(GUILD, PROVIDER, h.catalog);
    expect(shownPanel(interaction).selects[2]).toBe(CUSTOM_ID.replace('provider:test', 'provider:model'));
    expect(ephemeralTexts(interaction).at(-1)).toContain('Connexion réussie');
  });

  it('connexion refusée : ni découverte ni catalogue, la raison est montrée', async () => {
    const h = harness();
    h.adapter.testConnection.mockResolvedValue({ ok: false, summary: 'HTTP 401 : clé invalide', modelsFound: 0 });
    const interaction = fakeInteraction({ customId: CUSTOM_ID });
    await run(h, interaction);
    expect(h.adapter.discoverModels).not.toHaveBeenCalled();
    expect(h.store.saveModels).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('Connexion échouée : HTTP 401 : clé invalide');
  });

  it('sans adaptateur pour le protocole : le clic n\u0027est pas muet, rien n\u0027est levé', async () => {
    const h = harness();
    h.registry.resolve.mockImplementation(() => {
      throw new ProviderError('Aucun adaptateur pour le protocole openai-chat.', 'unsupported');
    });
    const interaction = fakeInteraction({ customId: CUSTOM_ID });
    await expect(run(h, interaction)).resolves.toBeUndefined();
    expect(h.adapter.testConnection).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('Aucun adaptateur');
  });
});

describe('provider:refresh', () => {
  const run = (h: Harness, interaction: FakeInteraction): Promise<void> => new ProviderRefreshButtonHandler(h.store as never, h.registry as never).handle(asInteraction(interaction));

  it('redécouvre le catalogue et le retient, puis réaffiche le panneau', async () => {
    const h = harness();
    const interaction = fakeInteraction({ customId: `provider:refresh~p=${PROVIDER}~c=chat.default~n=1` });
    await run(h, interaction);
    expect(h.adapter.discoverModels).toHaveBeenCalledWith(h.config);
    expect(h.adapter.testConnection).not.toHaveBeenCalled();
    expect(h.store.saveModels).toHaveBeenCalledWith(GUILD, PROVIDER, h.catalog);
    expect(interaction.message.edit).toHaveBeenCalledTimes(1);
    expect(ephemeralTexts(interaction).at(-1)).toContain('Catalogue actualisé : 2 modèle(s) retenus');
  });

  it('une erreur de la découverte devient un message éphémère avec la référence, sans rejet', async () => {
    const h = harness();
    h.adapter.discoverModels.mockRejectedValue(new Error('Requête impossible'));
    const interaction = fakeInteraction({ customId: `provider:refresh~p=${PROVIDER}~c=chat.default~n=1` });
    await expect(run(h, interaction)).resolves.toBeUndefined();
    expect(h.store.saveModels).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('Requête impossible [interaction-9]');
  });
});

describe('provider:delete', () => {
  const run = (h: Harness, interaction: FakeInteraction): Promise<void> => new ProviderDeleteButtonHandler(h.store as never, h.registry as never).handle(asInteraction(interaction));

  it('supprime le fournisseur, puis réaffiche le panneau sans lui en conservant la capacité', async () => {
    const h = harness();
    const interaction = fakeInteraction({ customId: `provider:delete~p=${PROVIDER}~c=video.generate` });
    await run(h, interaction);
    expect(h.store.remove).toHaveBeenCalledWith(GUILD, PROVIDER, ADMIN);
    expect(h.store.remove.mock.invocationCallOrder[0]).toBeLessThan(interaction.message.edit.mock.invocationCallOrder[0]);
    const panel = shownPanel(interaction);
    expect(panel.buttons).toEqual(['provider:add']);
    expect(panel.selects[1]).toBe('provider:capability');
    expect(panel.defaults[1]).toEqual(['video.generate']);
    expect(ephemeralTexts(interaction).at(-1)).toContain('**openai** supprimé');
  });

  it('déjà supprimé : refus éphémère, rien à supprimer', async () => {
    const h = harness();
    h.store.get.mockResolvedValue(null);
    const interaction = fakeInteraction({ customId: `provider:delete~p=parti~c=video.generate` });
    await run(h, interaction);
    expect(h.store.remove).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('introuvable');
  });
});

describe('provider:page', () => {
  const CUSTOM_ID = `provider:page~p=${PROVIDER}~c=chat.default~n=3`;
  const run = (h: Harness, interaction: FakeInteraction): Promise<void> => new ProviderPageButtonHandler(h.store as never, h.registry as never).handle(asInteraction(interaction));

  it('réaffiche le panneau sur la page demandée', async () => {
    const h = harness();
    h.store.list.mockResolvedValue([{ ...h.config, models: Array.from({ length: 60 }, (_, index) => ({ id: `m${index}` })) }]);
    const interaction = fakeInteraction({ customId: CUSTOM_ID });
    await run(h, interaction);
    expect(shownPanel(interaction).selects[2]).toBe(`provider:model~p=${PROVIDER}~c=chat.default~n=3`);
    expect(ephemeralTexts(interaction).at(-1)).toContain('Page 3');
  });

  it('page demandée au-delà du catalogue : ramenée à la dernière, et la confirmation nomme la page affichée', async () => {
    const interaction = fakeInteraction({ customId: CUSTOM_ID });
    await run(harness(), interaction);
    expect(shownPanel(interaction).selects[2]).toBe(`provider:model~p=${PROVIDER}~c=chat.default~n=1`);
    expect(ephemeralTexts(interaction).at(-1)).toContain('Page 1');
  });

  it('un panneau disparu ne fait pas échouer l\u0027action : elle est confirmée quand même', async () => {
    const interaction = fakeInteraction({ customId: CUSTOM_ID });
    interaction.message.edit.mockRejectedValue(new Error('Unknown Message'));
    await expect(run(harness(), interaction)).resolves.toBeUndefined();
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    expect(ephemeralTexts(interaction).at(-1)).toContain('Page 1');
  });
});
