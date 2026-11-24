import { describe, expect, it } from 'vitest';
import { ComponentType, MessageFlags } from 'discord.js';
import { NATIVE_CAPABILITIES, type ProviderModel } from '../provider.types';
import type { ProviderView, RouteView } from '../provider-views';
import { HUB_ADD, HUB_EMPTY, PROVIDER_HUB_IDS, PROVIDER_HUB_PAGE_SIZE, ProviderHubPresenter, hubId, type ProviderHubView } from './provider-hub.presenter';

/**
 * Panneau « Fournisseurs et modèles ». Le payload est sérialisé : les
 * validateurs de discord.js lèvent ici (plus de 25 options, champ trop long)
 * au lieu de faire rejeter le message en production.
 */

const SECRET = 'sk-test-secret-123';
const CUID = 'cmProviderId0000000000000';

interface SerializedOption {
  label: string;
  value: string;
  description?: string;
  default?: boolean;
}

interface SerializedComponent {
  type: number;
  content?: string;
  custom_id?: string;
  placeholder?: string;
  label?: string;
  options?: SerializedOption[];
  components?: SerializedComponent[];
}

interface Panel {
  raw: string;
  texts: string[];
  selects: SerializedComponent[];
  buttons: SerializedComponent[];
}

function provider(overrides: Partial<ProviderView> = {}): ProviderView {
  return {
    id: CUID,
    slug: 'openai',
    displayName: 'OpenAI',
    protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    hasKey: true,
    enabled: true,
    models: 2,
    catalog: [
      { id: 'gpt-4o', kind: 'chat', contextWindow: 128000 },
      { id: 'gpt-image-1', kind: 'image' },
    ],
    capabilities: ['chat.default'],
    ...overrides,
  };
}

function route(overrides: Partial<RouteView> = {}): RouteView {
  return { capability: 'chat.default', label: 'Conversation (défaut)', kind: 'chat', providerId: CUID, providerSlug: 'openai', modelId: 'gpt-4o', fallback: null, enabled: true, ...overrides };
}

function view(overrides: Partial<ProviderHubView> = {}): ProviderHubView {
  return { providers: [provider()], routes: [], selectedProviderId: CUID, selectedCapability: 'chat.default', page: 1, ...overrides };
}

function render(view: ProviderHubView): Panel {
  const payload = new ProviderHubPresenter().render(view);
  const json = JSON.parse(JSON.stringify(payload)) as unknown as { flags: number; components: SerializedComponent[] };
  expect(json.flags & MessageFlags.IsComponentsV2).toBeTruthy();
  expect(json.components).toHaveLength(1);
  const children = json.components[0]?.components ?? [];
  const rows = children.filter((child) => child.type === ComponentType.ActionRow).map((row) => row.components ?? []);
  const selects = rows.map((row) => row[0]).filter((component) => component?.type === ComponentType.StringSelect);
  const buttons = rows.flat().filter((component) => component.type === ComponentType.Button);
  return { raw: JSON.stringify(json), texts: children.filter((child) => child.type === ComponentType.TextDisplay).map((child) => child.content ?? ''), selects, buttons };
}

const base = (customId = ''): string => customId.split('~')[0] ?? '';
const menu = (panel: Panel, id: string): SerializedComponent => {
  const found = panel.selects.find((select) => base(select.custom_id) === id);
  if (!found) throw new Error(`Menu ${id} absent`);
  return found;
};

describe('ProviderHubPresenter · payload', () => {
  it('un seul conteneur V2 : titre, synthèse, fournisseurs, capacités, puis les trois menus dans l\u0027ordre', () => {
    const panel = render(view());
    expect(panel.texts[0]).toBe('## Fournisseurs et modèles');
    expect(panel.texts[1]).toBe(`1 fournisseur(s) connecté(s), 0 capacité(s) routée(s) sur ${NATIVE_CAPABILITIES.length}`);
    expect(panel.selects.map((select) => base(select.custom_id))).toEqual(['provider:select', 'provider:capability', 'provider:model']);
  });

  it('aucun champ ne dépasse les limites Discord (25 options, 100 caractères)', () => {
    const providers = Array.from({ length: 40 }, (_, index) => provider({ id: `${CUID}${index}`, slug: `f${index}`, displayName: 'd'.repeat(80) }));
    const panel = render(view({ providers, selectedCapability: 'image.generate', page: 2 }));
    for (const component of [...panel.selects, ...panel.buttons]) {
      expect(component.custom_id?.length ?? 0).toBeLessThan(100);
    }
    for (const select of panel.selects) {
      expect(select.options?.length ?? 0).toBeGreaterThan(0);
      expect(select.options?.length ?? 0).toBeLessThanOrEqual(PROVIDER_HUB_PAGE_SIZE);
      for (const option of select.options ?? []) {
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.label.length).toBeLessThanOrEqual(100);
        expect(option.value.length).toBeGreaterThan(0);
        expect(option.value.length).toBeLessThanOrEqual(100);
        expect((option.description ?? '').length).toBeLessThanOrEqual(100);
      }
      expect((select.options ?? []).filter((option) => option.default).length).toBeLessThanOrEqual(1);
    }
  });

  it('chaque bouton porte une base déclarée, et les six bases sont présentes quand un fournisseur est sélectionné', () => {
    const catalog = Array.from({ length: 60 }, (_, index) => ({ id: `m${index}` }));
    const ids = render(view({ page: 2, providers: [provider({ catalog, models: 60 })] })).buttons.map((button) => base(button.custom_id));
    const buttonBases = [PROVIDER_HUB_IDS.add, PROVIDER_HUB_IDS.edit, PROVIDER_HUB_IDS.test, PROVIDER_HUB_IDS.refresh, PROVIDER_HUB_IDS.delete, PROVIDER_HUB_IDS.page];
    for (const expected of buttonBases) expect(ids).toContain(expected);
    // Ajouter, Modifier, Tester, Actualiser, Supprimer, puis Précédent et Suivant au milieu du catalogue.
    expect(ids).toHaveLength(7);
  });

  it('aucune clé ne paraît, même portée par accident par une vue, et l\u0027URL ne montre que son hôte', () => {
    const stray = Object.assign(provider({ baseUrl: `https://api.example.com/v1?api_key=${SECRET}` }), { apiKey: SECRET });
    const panel = render(view({ providers: [stray] }));
    expect(panel.raw).not.toContain(SECRET);
    expect(panel.texts.join('\n')).toContain('api.example.com');
  });
});

describe('ProviderHubPresenter · menu des modèles', () => {
  const catalog: ProviderModel[] = Array.from({ length: 60 }, (_, index) => ({ id: `model-${index + 1}`, kind: 'chat' }));

  it('60 modèles : 3 pages de 25, la page 2 porte les modèles 26 à 50', () => {
    const panel = render(view({ providers: [provider({ catalog, models: 60 })], page: 2 }));
    const select = menu(panel, PROVIDER_HUB_IDS.model);
    expect(select.options?.map((option) => option.value)).toHaveLength(25);
    expect(select.options?.[0]?.value).toBe('model-26');
    expect(select.options?.at(-1)?.value).toBe('model-50');
    expect(select.placeholder).toBe('Page 2/3');
    expect(select.custom_id).toContain('~n=2');
  });

  it('plus de 25 modèles : une rangée de pagination vers les pages voisines', () => {
    const panel = render(view({ providers: [provider({ catalog, models: 60 })], page: 2 }));
    const pager = panel.buttons.filter((button) => base(button.custom_id) === PROVIDER_HUB_IDS.page);
    expect(pager.map((button) => button.custom_id)).toEqual([expect.stringContaining('~n=1'), expect.stringContaining('~n=3')]);
    const first = render(view({ providers: [provider({ catalog, models: 60 })], page: 1 }));
    expect(first.buttons.filter((button) => base(button.custom_id) === PROVIDER_HUB_IDS.page).map((button) => button.custom_id)).toEqual([expect.stringContaining('~n=2')]);
  });

  it('25 modèles au plus : ni pagination ni numéro de page', () => {
    const panel = render(view({ providers: [provider({ catalog: catalog.slice(0, 25), models: 25 })] }));
    expect(panel.buttons.some((button) => base(button.custom_id) === PROVIDER_HUB_IDS.page)).toBe(false);
    expect(menu(panel, PROVIDER_HUB_IDS.model).options).toHaveLength(25);
  });

  it('une page demandée au-delà de la fin ramène à la dernière page', () => {
    const select = menu(render(view({ providers: [provider({ catalog, models: 60 })], page: 99 })), PROVIDER_HUB_IDS.model);
    expect(select.options).toHaveLength(10);
    expect(select.placeholder).toBe('Page 3/3');
  });

  it('seuls les modèles de la famille de la capacité sont proposés, tous si aucun ne correspond', () => {
    const images = menu(render(view({ selectedCapability: 'image.generate' })), PROVIDER_HUB_IDS.model);
    expect(images.options?.map((option) => option.value)).toEqual(['gpt-image-1']);
    expect(images.options?.[0]?.description).toContain('image');
    const voices = menu(render(view({ selectedCapability: 'tts.speak' })), PROVIDER_HUB_IDS.model);
    expect(voices.options?.map((option) => option.value)).toEqual(['gpt-4o', 'gpt-image-1']);
  });

  it('le modèle de la route courante est présélectionné, avec sa famille et sa fenêtre de contexte', () => {
    const select = menu(render(view({ routes: [route()] })), PROVIDER_HUB_IDS.model);
    expect(select.options?.find((option) => option.value === 'gpt-4o')?.default).toBe(true);
    expect(select.options?.[0]?.description).toBe('chat · contexte 128k');
  });

  it('sans fournisseur sélectionné ou catalogue vide : une option sentinelle, sans valeur à lier', () => {
    const none = menu(render(view({ selectedProviderId: null })), PROVIDER_HUB_IDS.model);
    expect(none.options).toEqual([expect.objectContaining({ value: HUB_EMPTY })]);
    const empty = menu(render(view({ providers: [provider({ catalog: [], models: 0 })] })), PROVIDER_HUB_IDS.model);
    expect(empty.options).toEqual([expect.objectContaining({ value: HUB_EMPTY, label: 'Catalogue vide' })]);
  });

  it('les identifiants affichés sont tronqués à 80 caractères, ceux de plus de 100 caractères ne sont pas proposés', () => {
    // Un identifiant de plus de 100 caractères (limite Discord d'une valeur) n'est pas proposé plutôt que tronqué.
    const catalog: ProviderModel[] = [{ id: `m${'x'.repeat(119)}` }, { id: 'y'.repeat(90), kind: 'chat' }, { id: 'y'.repeat(90), kind: 'chat' }];
    const select = menu(render(view({ providers: [provider({ catalog, models: 3 })] })), PROVIDER_HUB_IDS.model);
    expect(select.options).toHaveLength(1);
    expect(select.options?.[0]?.label).toHaveLength(80);
    expect(select.options?.[0]?.value).toBe('y'.repeat(90));
  });
});

describe('ProviderHubPresenter · fournisseurs, capacités, boutons', () => {
  it('menu des fournisseurs : une option par fournisseur, le courant présélectionné, puis « Ajouter »', () => {
    const providers = Array.from({ length: 40 }, (_, index) => provider({ id: index === 0 ? CUID : `${CUID}${index}`, slug: `f${index}` }));
    const select = menu(render(view({ providers })), PROVIDER_HUB_IDS.select);
    expect(select.options).toHaveLength(PROVIDER_HUB_PAGE_SIZE);
    expect(select.options?.at(-1)).toMatchObject({ value: HUB_ADD, label: 'Ajouter un fournisseur' });
    expect(select.options?.filter((option) => option.default).map((option) => option.value)).toEqual([CUID]);
    expect(select.custom_id).toBe('provider:select~c=chat.default');
    const many = render(view({ providers }));
    expect(many.texts.join('\n')).toContain(`et ${providers.length - (PROVIDER_HUB_PAGE_SIZE - 1)} autre(s) non listé(s)`);
  });

  it('liste des fournisseurs : slug en gras, protocole, hôte, modèles, puis ses états', () => {
    const texts = render(view({ providers: [provider(), provider({ id: 'p2', slug: 'kie', protocol: 'kie-unified', baseUrl: 'https://api.kie.ai/api', hasKey: false, enabled: false, models: 0 })] })).texts.join('\n');
    expect(texts).toContain('- **openai** · openai-chat · api.openai.com · 2 modèle(s) · sélectionné');
    expect(texts).toContain('- **kie** · kie-unified · api.kie.ai · 0 modèle(s) · désactivé · sans clé');
    const empty = render(view({ providers: [], selectedProviderId: null })).texts.join('\n');
    expect(empty).toContain('Aucun fournisseur');
  });

  it('routes affichées : `slug / modèle` par capacité, `non routée` sinon, dans le texte et dans le menu', () => {
    const routes = [route(), route({ capability: 'video.generate', providerSlug: 'kie', modelId: 'veo-3', enabled: false })];
    const panel = render(view({ routes }));
    expect(panel.texts[1]).toContain('2 capacité(s) routée(s) sur 9');
    const text = panel.texts.join('\n');
    expect(text).toContain('- Conversation (défaut) : `openai / gpt-4o`');
    expect(text).toContain('- Vidéo : `kie / veo-3` (désactivée)');
    expect(text).toContain('- Musique : non routée');
    const select = menu(panel, PROVIDER_HUB_IDS.capability);
    expect(select.options).toHaveLength(NATIVE_CAPABILITIES.length);
    expect(select.options?.find((option) => option.value === 'video.generate')?.description).toBe('kie / veo-3 (désactivée)');
    expect(select.options?.find((option) => option.value === 'music.generate')?.description).toBe('non routée');
    expect(select.options?.find((option) => option.default)?.value).toBe('chat.default');
    expect(select.custom_id).toBe(`provider:capability~p=${CUID}`);
  });

  it('sans fournisseur sélectionné : seul « Ajouter », ni édition ni test ni suppression', () => {
    const buttons = render(view({ selectedProviderId: null })).buttons.map((button) => button.custom_id);
    expect(buttons).toEqual(['provider:add']);
  });

  it('avec un fournisseur sélectionné : les cinq boutons, l\u0027état porté par leurs customIds', () => {
    const buttons = render(view()).buttons.map((button) => button.custom_id);
    expect(buttons).toEqual([PROVIDER_HUB_IDS.add, `provider:edit~p=${CUID}`, `provider:test~p=${CUID}~c=chat.default~n=1`, `provider:refresh~p=${CUID}~c=chat.default~n=1`, `provider:delete~p=${CUID}~c=chat.default`]);
  });

  it('une liste de fournisseurs trop longue est coupée : les textes tiennent dans les 4 000 caractères d\u0027un message V2', () => {
    const providers = Array.from({ length: 30 }, (_, index) => provider({ id: `${CUID}${index}`, slug: `s${index}-${'x'.repeat(44)}`, baseUrl: `https://${'h'.repeat(55)}.example.com/v1` }));
    const texts = render(view({ providers, routes: [route({ modelId: 'm'.repeat(80) })] })).texts;
    const text = texts.join('\n');
    expect(text).toMatch(/^- et \d+ autre\(s\) non listé\(s\)$/mu);
    expect(texts.reduce((total, entry) => total + entry.length, 0)).toBeLessThan(4000);
  });
});

describe('ProviderHubPresenter · messages éphémères et customIds', () => {
  it('chaque message éphémère est éphémère ET Components V2', () => {
    const presenter = new ProviderHubPresenter();
    const messages = [
      presenter.denied(),
      presenter.providerSaved('openai'),
      presenter.providerSaved('openai', { ok: true, summary: 'Clé acceptée', modelsFound: 12 }),
      presenter.providerSaved('openai', { ok: false, summary: 'Clé refusée', modelsFound: 0 }),
      presenter.providerDeleted('openai'),
      presenter.testResult({ ok: false, summary: 'HTTP 401', modelsFound: 0 }),
      presenter.routeBound('video.generate', 'kie', 'veo-3'),
      presenter.failed('Slug invalide', 'interaction-9'),
      presenter.missingProvider(),
      presenter.emptyCatalog(),
      presenter.providerSelected('openai'),
      presenter.capabilitySelected('video.generate'),
      presenter.pageShown(2),
      presenter.catalogRefreshed(12),
      presenter.updated(),
    ];
    for (const message of messages) {
      expect(message.flags & MessageFlags.Ephemeral).toBeTruthy();
      expect(message.flags & MessageFlags.IsComponentsV2).toBeTruthy();
      expect(message.components.length).toBeGreaterThan(0);
      for (const component of message.components) expect(() => component.toJSON()).not.toThrow();
    }
  });

  it('un échec porte la référence de l\u0027interaction, une liaison nomme la capacité et le modèle', () => {
    const presenter = new ProviderHubPresenter();
    const text = (message: { components: Array<{ toJSON: () => { content?: string } }> }): string => message.components.map((component) => component.toJSON().content ?? '').join('\n');
    expect(text(presenter.failed('Protocole inconnu', 'interaction-9'))).toContain('[interaction-9]');
    expect(text(presenter.routeBound('video.generate', 'kie', 'veo-3'))).toContain('**Vidéo** routée vers `kie / veo-3`');
    expect(text(presenter.providerSaved('openai', { ok: true, summary: 'Clé acceptée', modelsFound: 12 }))).toContain('12 modèle(s) au catalogue');
    expect(text(presenter.testResult({ ok: false, summary: 'HTTP 401', modelsFound: 0 }))).toContain('Connexion échouée : HTTP 401');
  });

  it('hubId n\u0027écrit que les paramètres fournis et encode les séparateurs', () => {
    expect(hubId('provider:add')).toBe('provider:add');
    expect(hubId('provider:model', { p: 'abc', c: 'chat.default', n: 2 })).toBe('provider:model~p=abc~c=chat.default~n=2');
    expect(hubId('provider:model', { p: null, c: undefined, n: 1 })).toBe('provider:model~n=1');
    expect(hubId('provider:page', { p: 'a~b&c', c: 'custom.x~y' })).not.toMatch(/[~&](?![pc]=)/u);
    const longest = hubId(PROVIDER_HUB_IDS.refresh, { p: CUID, c: 'chat.ingestion', n: 99 });
    expect(longest.length).toBeLessThan(100);
  });
});
