import { describe, expect, it, vi } from 'vitest';
import { ModalService } from '@spraxium/components';
import { ComponentType, MessageFlags } from 'discord.js';
import { ProviderError, type ProviderConfig } from '../provider.types';
import { HUB_ADD, HUB_EMPTY } from '../presenters/provider-hub.presenter';
import { ProviderCapabilityComponent, ProviderCapabilityHandler, ProviderEditModal, ProviderEditModalHandler, ProviderModelComponent, ProviderModelHandler, ProviderSelectComponent, ProviderSelectHandler } from './provider-hub.handlers';
import { ProviderAddButtonHandler, ProviderDeleteButtonHandler, ProviderEditButtonHandler, ProviderPageButtonHandler, ProviderRefreshButtonHandler, ProviderTestButtonHandler } from './provider-hub.buttons.handlers';
import { parseHubParams } from './provider-hub.params';

/**
 * Menus du panneau « Fournisseurs et modèles », et garde commune à tous ses
 * handlers. Un vrai clic exige une interaction Discord (non simulable par un
 * rig) : ces tests fixent les métadonnées du dispatcher, le refus d'un non
 * administrateur sans effet, et l'effet attendu de chaque handler. Les
 * services du module sont des doublures : ni base de données, ni réseau.
 * (Boutons : provider-hub.buttons.handlers.spec.ts ; modale :
 * provider-hub.modal.handlers.spec.ts ; vue : provider-hub.view.spec.ts.)
 */

const GUILD = '1550000000000000001';
const OWNER = '1550000000000000002';
const ADMIN = '1550000000000000003';
const MEMBER = '1550000000000000004';
const PROVIDER = 'cmProviderId0000000000000';
const SECRET = 'sk-test-secret';
const FIELDS = ['slug', 'displayName', 'protocol', 'baseUrl', 'apiKey', 'extraConfig'];

interface FakeInteraction {
  id: string;
  customId: string;
  values: string[];
  user: { id: string };
  guild: { ownerId: string } | null;
  memberPermissions: { toArray: () => string[] };
  guildId: string | null;
  message: { id: string; edit: ReturnType<typeof vi.fn> };
  reply: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
}

interface FakeOptions {
  role?: 'owner' | 'admin' | 'member';
  /** Message direct : hors serveur. */
  direct?: boolean;
  customId?: string;
  values?: string[];
}

function fakeInteraction(options: FakeOptions = {}): FakeInteraction {
  const { role = 'admin', direct = false, customId = '', values = [] } = options;
  return {
    id: 'interaction-9',
    customId,
    values,
    user: { id: role === 'owner' ? OWNER : role === 'admin' ? ADMIN : MEMBER },
    guild: direct ? null : { ownerId: OWNER },
    memberPermissions: { toArray: () => (role === 'admin' ? ['Administrator'] : []) },
    guildId: direct ? null : GUILD,
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
    authType: 'bearer', authHeaderName: null, apiKey: SECRET, customHeaders: {}, extraConfig: {}, models: [{ id: 'gpt-4o', kind: 'chat' }], enabled: true,
  };
  const adapter = {
    capabilities: ['chat.default'],
    testConnection: vi.fn(async () => ({ ok: true, summary: 'Clé acceptée', modelsFound: 2 })),
    discoverModels: vi.fn(async () => [{ id: 'gpt-4o', kind: 'chat' }]),
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
  return { config, adapter, store, registry: { resolve: vi.fn(() => adapter) } };
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
function shownPanel(interaction: FakeInteraction): { raw: string; selects: string[]; defaults: string[][]; buttons: string[] } {
  type Node = { type: number; custom_id?: string; components?: Node[]; options?: Array<{ value: string; default?: boolean }> };
  const json = JSON.parse(JSON.stringify(interaction.message.edit.mock.calls[0]?.[0])) as { components: Array<{ components: Node[] }> };
  const flat = (json.components[0]?.components ?? []).filter((node) => node.type === ComponentType.ActionRow).flatMap((row) => row.components ?? []);
  const selects = flat.filter((node) => node.type === ComponentType.StringSelect);
  return {
    raw: JSON.stringify(json),
    selects: selects.map((node) => node.custom_id ?? ''),
    defaults: selects.map((node) => (node.options ?? []).filter((option) => option.default).map((option) => option.value)),
    buttons: flat.filter((node) => node.type === ComponentType.Button).map((node) => node.custom_id ?? ''),
  };
}

const asInteraction = (interaction: FakeInteraction): never => interaction as never;
const modals = (): ModalService => new ModalService({} as never);
const selectHandler = (h: Harness): ProviderSelectHandler => new ProviderSelectHandler(h.store as never, h.registry as never, modals());
/** Ordre d'appel : croissant, comparable entre deux doublures. */
const order = (mock: { mock: { invocationCallOrder: number[] } }): number => mock.mock.invocationCallOrder[0] ?? 0;

describe('routage du panneau (métadonnées du dispatcher)', () => {
  it('chaque menu est lié à son composant, décoré avec sa base', () => {
    const menus = [
      [ProviderSelectHandler, ProviderSelectComponent, 'provider:select'],
      [ProviderCapabilityHandler, ProviderCapabilityComponent, 'provider:capability'],
      [ProviderModelHandler, ProviderModelComponent, 'provider:model'],
    ] as const;
    for (const [handler, component, customId] of menus) {
      expect(Reflect.getOwnMetadata('spraxium:select_handler', handler)).toMatchObject({ component });
      expect(Reflect.getOwnMetadata('spraxium:select_component', component)).toMatchObject({ customId });
    }
  });

  it('chaque bouton est lié à son composant, décoré avec sa base', () => {
    const buttons = [
      [ProviderAddButtonHandler, 'provider:add'],
      [ProviderEditButtonHandler, 'provider:edit'],
      [ProviderTestButtonHandler, 'provider:test'],
      [ProviderRefreshButtonHandler, 'provider:refresh'],
      [ProviderDeleteButtonHandler, 'provider:delete'],
      [ProviderPageButtonHandler, 'provider:page'],
    ] as const;
    for (const [handler, customId] of buttons) {
      const meta = Reflect.getOwnMetadata('spraxium:button_handler', handler) as { component: new () => unknown };
      expect(Reflect.getOwnMetadata('spraxium:button_component', meta.component)).toMatchObject({ customId });
    }
  });

  it('la modale porte l\u0027id, le titre et ses six champs dans l\u0027ordre, la clé en paragraphe facultative', () => {
    expect(Reflect.getOwnMetadata('spraxium:modal_handler', ProviderEditModalHandler)).toMatchObject({ builder: ProviderEditModal });
    expect(Reflect.getOwnMetadata('spraxium:modal_component', ProviderEditModal)).toMatchObject({ id: 'provider-edit', title: 'Fournisseur IA' });
    const json = modals().build(ProviderEditModal).toJSON();
    expect(json.components.map((entry) => ('component' in entry ? entry.component.custom_id : null))).toEqual(FIELDS);
    const inputs = json.components.flatMap((entry) => ('component' in entry && entry.component.type === ComponentType.TextInput ? [entry.component] : []));
    expect(inputs.map((input) => input.required)).toEqual([true, false, true, true, false, false]);
    expect(inputs[4]).toMatchObject({ style: 2, placeholder: 'Laisser vide conserve la clé actuelle' });
  });

  it('les paramètres d\u0027un customId se relisent, avec les deux séparateurs', () => {
    expect(parseHubParams(`provider:test~p=${PROVIDER}~c=video.generate~n=3`)).toEqual({ p: PROVIDER, c: 'video.generate', n: 3, m: null });
    expect(parseHubParams(`provider-edit~p=${PROVIDER}&m=155`)).toEqual({ p: PROVIDER, c: null, n: 1, m: '155' });
    expect(parseHubParams('provider:add')).toEqual({ p: null, c: null, n: 1, m: null });
    expect(parseHubParams('provider:page~p=a~c=chat.default~n=0').n).toBe(1);
  });
});

describe('garde : seul un administrateur du serveur agit', () => {
  const runners: Array<[string, (h: Harness, i: FakeInteraction) => Promise<void>]> = [
    ['provider:select', (h, i) => selectHandler(h).handle(asInteraction(i))],
    ['provider:capability', (h, i) => new ProviderCapabilityHandler(h.store as never, h.registry as never).handle(asInteraction(i))],
    ['provider:model', (h, i) => new ProviderModelHandler(h.store as never, h.registry as never).handle(asInteraction(i))],
    ['provider:add', (h, i) => new ProviderAddButtonHandler(h.store as never, h.registry as never, modals()).handle(asInteraction(i))],
    ['provider:edit', (h, i) => new ProviderEditButtonHandler(h.store as never, h.registry as never, modals()).handle(asInteraction(i))],
    ['provider:test', (h, i) => new ProviderTestButtonHandler(h.store as never, h.registry as never).handle(asInteraction(i))],
    ['provider:refresh', (h, i) => new ProviderRefreshButtonHandler(h.store as never, h.registry as never).handle(asInteraction(i))],
    ['provider:delete', (h, i) => new ProviderDeleteButtonHandler(h.store as never, h.registry as never).handle(asInteraction(i))],
    ['provider:page', (h, i) => new ProviderPageButtonHandler(h.store as never, h.registry as never).handle(asInteraction(i))],
    ['provider-edit', (h, i) => new ProviderEditModalHandler(h.store as never, h.registry as never).handle(asInteraction(i))],
  ];

  it.each(runners)('%s : non administrateur ou hors serveur, refus éphémère sans aucun effet', async (_label, run) => {
    for (const options of [{ role: 'member' as const }, { direct: true }]) {
      const h = harness();
      const interaction = fakeInteraction({ ...options, customId: `provider:model~p=${PROVIDER}~c=chat.default~n=1`, values: ['gpt-4o'] });
      await expect(run(h, interaction)).resolves.toBeUndefined();
      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(interaction.message.edit).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const sent = interaction.reply.mock.calls[0]?.[0] as { flags: number };
      expect(sent.flags & MessageFlags.Ephemeral).toBeTruthy();
      expect(sent.flags & MessageFlags.IsComponentsV2).toBeTruthy();
      for (const effect of [h.store.list, h.store.get, h.store.upsert, h.store.remove, h.store.saveModels, h.store.bindRoute, h.adapter.testConnection, h.adapter.discoverModels]) {
        expect(effect).not.toHaveBeenCalled();
      }
      expect(ephemeralTexts(interaction).join('\n')).toContain('Seul un administrateur');
    }
  });
});

describe('provider:select', () => {
  it('« Ajouter un fournisseur » : la modale est la PREMIÈRE réponse, rien avant, champs vides', async () => {
    const interaction = fakeInteraction({ values: [HUB_ADD], customId: 'provider:select~c=video.generate' });
    await selectHandler(harness()).handle(asInteraction(interaction));
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.message.edit).not.toHaveBeenCalled();
    const modal = interaction.showModal.mock.calls[0]?.[0] as { custom_id: string; components: Array<{ component: { custom_id: string; value?: string } }> };
    expect(modal.custom_id).toBe('provider-edit~m=1550000000000000005');
    expect(modal.components.map((entry) => entry.component.value)).toEqual(FIELDS.map(() => undefined));
  });

  it('sélection : le panneau est réaffiché avec ce fournisseur et la capacité courante, puis confirmé', async () => {
    const interaction = fakeInteraction({ values: [PROVIDER], customId: 'provider:select~c=video.generate' });
    await selectHandler(harness()).handle(asInteraction(interaction));
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    const panel = shownPanel(interaction);
    expect(panel.selects).toEqual(['provider:select~c=video.generate', `provider:capability~p=${PROVIDER}`, `provider:model~p=${PROVIDER}~c=video.generate~n=1`]);
    expect(panel.defaults[0]).toEqual([PROVIDER]);
    expect(panel.raw).not.toContain(SECRET);
    expect(ephemeralTexts(interaction).at(-1)).toContain('**openai** sélectionné');
  });

  it('fournisseur disparu : refus éphémère, panneau intact', async () => {
    const h = harness();
    h.store.get.mockResolvedValue(null);
    const interaction = fakeInteraction({ values: ['parti'], customId: 'provider:select~c=chat.default' });
    await selectHandler(h).handle(asInteraction(interaction));
    expect(interaction.message.edit).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('introuvable');
  });
});

describe('provider:capability', () => {
  it('le panneau est réaffiché avec la capacité choisie, le fournisseur est conservé', async () => {
    const h = harness();
    const interaction = fakeInteraction({ values: ['video.generate'], customId: `provider:capability~p=${PROVIDER}` });
    await new ProviderCapabilityHandler(h.store as never, h.registry as never).handle(asInteraction(interaction));
    const panel = shownPanel(interaction);
    expect(panel.defaults[1]).toEqual(['video.generate']);
    expect(panel.selects[2]).toBe(`provider:model~p=${PROVIDER}~c=video.generate~n=1`);
    expect(ephemeralTexts(interaction).at(-1)).toContain('**Vidéo** sélectionnée');
  });
});

describe('provider:model', () => {
  const CUSTOM_ID = `provider:model~p=${PROVIDER}~c=video.generate~n=1`;
  const run = (h: Harness, interaction: FakeInteraction): Promise<void> => new ProviderModelHandler(h.store as never, h.registry as never).handle(asInteraction(interaction));

  it('lie le modèle choisi au bon serveur, à la bonne capacité, au bon fournisseur, puis réaffiche et confirme', async () => {
    const h = harness();
    const interaction = fakeInteraction({ values: ['veo-3'], customId: CUSTOM_ID });
    await run(h, interaction);
    expect(h.store.bindRoute).toHaveBeenCalledTimes(1);
    expect(h.store.bindRoute).toHaveBeenCalledWith(GUILD, 'video.generate', { providerId: PROVIDER, modelId: 'veo-3' }, ADMIN);
    expect(order(h.store.bindRoute)).toBeLessThan(order(interaction.message.edit));
    expect(ephemeralTexts(interaction).at(-1)).toContain('**Vidéo** routée vers `openai / veo-3`');
    expect(ephemeralTexts(interaction).at(-1)).not.toContain('elles suivent');
  });

  it('les routes de conversation qui partageaient le modèle l\u0027ont suivi : la confirmation le dit', async () => {
    const h = harness();
    h.store.bindRoute.mockResolvedValue({ followedBy: ['chat.reasoning', 'chat.ingestion'] });
    const interaction = fakeInteraction({ values: ['gpt-4o'], customId: `provider:model~p=${PROVIDER}~c=chat.default~n=1` });
    await run(h, interaction);
    const text = ephemeralTexts(interaction).at(-1) ?? '';
    expect(text).toContain('**Conversation (défaut)** routée vers `openai / gpt-4o`');
    expect(text).toContain('Raisonnement (actions complexes) et Ingestion et mémoire partageaient ce modèle : elles suivent.');
  });

  it('option sentinelle ou état incomplet : rien n\u0027est lié, le membre est prévenu', async () => {
    for (const [values, customId] of [[[HUB_EMPTY], CUSTOM_ID], [['veo-3'], 'provider:model~c=video.generate~n=1']] as const) {
      const h = harness();
      const interaction = fakeInteraction({ values: [...values], customId });
      await run(h, interaction);
      expect(h.store.bindRoute).not.toHaveBeenCalled();
      expect(ephemeralTexts(interaction).at(-1)).toContain('Aucun modèle');
    }
  });

  it('une exception est rattrapée : réponse éphémère avec la référence, sans rejet', async () => {
    const h = harness();
    h.store.bindRoute.mockRejectedValue(new ProviderError('Fournisseur introuvable sur ce serveur.', 'invalid'));
    const interaction = fakeInteraction({ values: ['veo-3'], customId: CUSTOM_ID });
    await expect(run(h, interaction)).resolves.toBeUndefined();
    expect(interaction.message.edit).not.toHaveBeenCalled();
    expect(ephemeralTexts(interaction).at(-1)).toContain('Fournisseur introuvable sur ce serveur. [interaction-9]');
  });
});
