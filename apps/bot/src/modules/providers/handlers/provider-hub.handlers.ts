import { Ctx } from '@spraxium/common';
import { ModalComponent, ModalHandler, ModalInput, ModalService, StringSelect, StringSelectHandler } from '@spraxium/components';
import type { APIModalInteractionResponseCallbackData, ModalSubmitInteraction, StringSelectMenuInteraction } from 'discord.js';
import { ProviderAdapterRegistry } from '../provider-adapter.registry';
import { GuildProviderService } from '../provider-store.service';
import { visibleOptions } from '../provider-store.json';
import { PROVIDER_PROTOCOLS, ProviderError, type ProviderConfig, type ProviderProtocol } from '../provider.types';
import { HUB_ADD, HUB_EMPTY, PROVIDER_HUB_IDS } from '../presenters/provider-hub.presenter';
import { nativeCapability } from '../presenters/provider-hub.parts';
import { parseHubParams } from './provider-hub.params';
import { prefillModal, probeProvider, requireProvider, runHub } from './provider-hub.support';

/**
 * Handlers du panneau « Fournisseurs et modèles » : les trois menus et la
 * modale « Fournisseur IA » (les boutons vivent dans provider-hub.buttons.handlers).
 *
 * Les décorateurs de @spraxium/components sont OBLIGATOIRES : sans eux, le
 * dispatcher ne route rien et le composant reste muet. Le customId décoré est
 * la BASE ; l'état du panneau voyage dans le suffixe `~c=`, `~p=`, `~n=`.
 */

@StringSelect({ customId: PROVIDER_HUB_IDS.select })
export class ProviderSelectComponent {}

@StringSelect({ customId: PROVIDER_HUB_IDS.capability })
export class ProviderCapabilityComponent {}

@StringSelect({ customId: PROVIDER_HUB_IDS.model })
export class ProviderModelComponent {}

/** Modale d'ajout et de modification ; les identifiants de champs sont lus par le handler. */
@ModalComponent({ id: PROVIDER_HUB_IDS.modal, title: 'Fournisseur IA' })
export class ProviderEditModal {
  @ModalInput({ id: 'slug', label: 'Slug (identifiant, minuscules et tirets)', style: 'short', required: true, minLength: 2, maxLength: 48, placeholder: 'openai, deepseek, kie...' })
  slug!: string;

  @ModalInput({ id: 'displayName', label: 'Nom affiché (facultatif)', style: 'short', required: false, maxLength: 80, placeholder: 'OpenAI, DeepSeek...' })
  displayName!: string;

  @ModalInput({ id: 'protocol', label: 'Protocole', style: 'short', required: true, maxLength: 24, placeholder: 'openai-chat, anthropic-messages, kie-unified, generic-http' })
  protocol!: string;

  @ModalInput({ id: 'baseUrl', label: 'URL de base (https)', style: 'short', required: true, maxLength: 500, placeholder: 'https://api.openai.com/v1' })
  baseUrl!: string;

  @ModalInput({ id: 'apiKey', label: 'Clé API (facultatif)', style: 'paragraph', required: false, maxLength: 400, placeholder: 'Laisser vide conserve la clé actuelle' })
  apiKey!: string;

  @ModalInput({ id: 'extraConfig', label: 'Options JSON (facultatif)', style: 'paragraph', required: false, maxLength: 1000, placeholder: '{"temperature": 0.7}' })
  extraConfig!: string;
}

/**
 * Modale à montrer. `p=` désigne le fournisseur modifié (absent à la création),
 * `m=` le panneau à rafraîchir au retour : une soumission de modale ne porte
 * pas le message d'origine. `values` préremplit les champs, jamais la clé.
 */
export function providerModal(
  modals: ModalService,
  ref: { p?: string; m?: string },
  values: Record<string, string> = {},
): APIModalInteractionResponseCallbackData {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(ref)) {
    if (value) params[key] = value;
  }
  return prefillModal(modals.buildWithParams(ProviderEditModal, params), values);
}

/** Champs d'une modification, préremplis depuis le fournisseur ; la clé n'en fait jamais partie, ni les options réservées. */
export function providerFormValues(config: ProviderConfig): Record<string, string> {
  const options = visibleOptions(config.extraConfig);
  return {
    slug: config.slug,
    displayName: config.displayName,
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    extraConfig: Object.keys(options).length > 0 ? JSON.stringify(options) : '',
  };
}

/** Choisit un fournisseur (ou ouvre la modale pour en ajouter un). */
@StringSelectHandler(ProviderSelectComponent)
export class ProviderSelectHandler {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
    private readonly modals: ModalService,
  ) {}

  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    await runHub({ store: this.store, registry: this.registry }, interaction, 'sélection du fournisseur', async (access) => {
      const state = parseHubParams(interaction.customId);
      const value = interaction.values?.[0] ?? '';
      if (value === HUB_ADD) {
        // showModal doit être la PREMIÈRE réponse de l'interaction (règle des 3 s) : rien avant.
        await interaction.showModal(providerModal(this.modals, { m: interaction.message?.id }));
        return 'modal';
      }
      await access.reply.defer();
      const provider = await requireProvider(access, this.store, value);
      if (!provider) return;
      // Le catalogue change avec le fournisseur : retour à la première page.
      await access.repaint({ p: provider.id, c: state.c, n: 1 });
      await access.reply.show(access.presenter.providerSelected(provider.slug));
    });
  }
}

/** Choisit la capacité ; le modèle se choisit ensuite dans le menu des modèles. */
@StringSelectHandler(ProviderCapabilityComponent)
export class ProviderCapabilityHandler {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
  ) {}

  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    await runHub({ store: this.store, registry: this.registry }, interaction, 'sélection de la capacité', async (access) => {
      await access.reply.defer();
      const { p } = parseHubParams(interaction.customId);
      const capability = nativeCapability(interaction.values?.[0]);
      await access.repaint({ p, c: capability, n: 1 });
      await access.reply.show(access.presenter.capabilitySelected(capability));
    });
  }
}

/** Lie le modèle choisi à la capacité sélectionnée. */
@StringSelectHandler(ProviderModelComponent)
export class ProviderModelHandler {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
  ) {}

  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    await runHub({ store: this.store, registry: this.registry }, interaction, 'liaison du modèle', async (access) => {
      await access.reply.defer();
      const { p, c, n } = parseHubParams(interaction.customId);
      const modelId = interaction.values?.[0] ?? '';
      if (!p || !c || !modelId || modelId === HUB_EMPTY) {
        await access.reply.show(access.presenter.emptyCatalog());
        return;
      }
      const { followedBy } = await this.store.bindRoute(access.guildId, c, { providerId: p, modelId }, access.userId);
      const view = await access.repaint({ p, c, n });
      const slug = view.providers.find((provider) => provider.id === p)?.slug ?? p;
      await access.reply.show(access.presenter.routeBound(c, slug, modelId, followedBy));
    });
  }
}

function protocolOf(raw: string): ProviderProtocol {
  if (!(PROVIDER_PROTOCOLS as readonly string[]).includes(raw)) {
    throw new ProviderError(`Protocole inconnu : ${raw.slice(0, 40) || '(vide)'}. Protocoles acceptés : ${PROVIDER_PROTOCOLS.join(', ')}.`, 'invalid');
  }
  return raw as ProviderProtocol;
}

/** Options JSON libres ; vides, elles sont absentes de l'entrée (le store conserve alors les actuelles). */
function extraConfigOf(raw: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Message unique ci-dessous.
  }
  throw new ProviderError('Les options JSON doivent être un objet JSON valide (par exemple {"temperature": 0.7}).', 'invalid');
}

/** Le slug est l'identifiant du fournisseur : le changer crée un autre fournisseur, qu'il faut signaler. */
const RENAMED_NOTE = 'Le slug a changé : c\u0027est un nouveau fournisseur, l\u0027ancien est conservé avec ses routes.';

/** Enregistre le fournisseur (création ou modification), puis contrôle la connexion quand il y a une clé. */
@ModalHandler(ProviderEditModal)
export class ProviderEditModalHandler {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
  ) {}

  async handle(@Ctx() interaction: ModalSubmitInteraction): Promise<void> {
    await runHub({ store: this.store, registry: this.registry }, interaction, 'enregistrement', async (access) => {
      await access.reply.defer();
      const { p } = parseHubParams(interaction.customId);
      const field = (id: string): string => interaction.fields.getTextInputValue(id).trim();
      const previous = p ? await this.store.get(access.guildId, p) : null;
      const slug = field('slug').toLowerCase();
      const key = field('apiKey');
      const renamed = previous !== null && previous.slug !== slug;
      const saved = await this.store.upsert(
        access.guildId,
        {
          slug,
          displayName: field('displayName') || undefined,
          protocol: protocolOf(field('protocol')),
          baseUrl: field('baseUrl'),
          // Champ vide : la clé actuelle est conservée. Sur un changement de slug, le nouveau fournisseur
          // l'emporte : c'est la promesse du formulaire.
          apiKey: key || (renamed ? previous.apiKey : null) || undefined,
          extraConfig: extraConfigOf(field('extraConfig')),
        },
        access.userId,
      );
      const tested = saved.apiKey ? await probeProvider({ store: this.store, registry: this.registry }, access.guildId, saved) : null;
      await access.repaint({ p: saved.id });
      await access.reply.show(access.presenter.providerSaved(saved.slug, tested, renamed ? RENAMED_NOTE : null));
    });
  }
}
