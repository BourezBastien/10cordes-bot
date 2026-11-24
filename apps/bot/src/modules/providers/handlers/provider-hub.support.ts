import { Logger } from '@spraxium/logger';
import { ComponentType, type APIModalInteractionResponseCallbackData, type MessageCreateOptions, type ModalBuilder, type TextDisplayBuilder } from 'discord.js';
import { guildAdminPolicy, interactionAccessContext, type InteractionAccessSource } from '../../../core/security/access-policy';
import { fileLog } from '../../logging/file-log.service';
import { SurfaceNoticePresenter } from '../../surface/presenters/surface-notice.presenter';
import { InteractionReply } from '../../surface/surface-reply';
import type { AbstractProviderAdapter } from '../provider-adapter';
import type { ProviderAdapterRegistry } from '../provider-adapter.registry';
import type { GuildProviderService } from '../provider-store.service';
import type { ConnectionCheckResult, ProviderConfig, ProviderModel } from '../provider.types';
import { ProviderHubPresenter, type ProviderHubView } from '../presenters/provider-hub.presenter';
import { parseHubParams, type HubParams } from './provider-hub.params';
import { ProviderHubViewBuilder } from './provider-hub.view';

const log = new Logger('ProviderHub');
/** Presenters purs, sans état : jamais un paramètre de constructeur DI. */
const presenter = new ProviderHubPresenter();
const notices = new SurfaceNoticePresenter();

/** Corps d'un message : composants seuls, le drapeau V2 ne se pose qu'à la création. */
type PanelPayload = { components: MessageCreateOptions['components'] };

/** Canal texte capable d'éditer un message (structurel). */
interface PanelChannel {
  isTextBased(): boolean;
  messages: { edit(message: string, payload: PanelPayload): Promise<unknown> };
}

/**
 * Ce qu'un handler lit d'une interaction du panneau : structurel, une
 * interaction discord.js (menu, bouton, modale) le satisfait.
 */
export interface HubInteraction extends InteractionAccessSource {
  id: string;
  customId: string;
  guildId: string | null;
  message?: { edit(payload: PanelPayload): Promise<unknown> } | null;
  channel?: unknown;
  reply(options: { components: TextDisplayBuilder[]; flags: number }): Promise<unknown>;
  deferReply(options: { flags: number }): Promise<unknown>;
  editReply(options: { components: TextDisplayBuilder[] }): Promise<unknown>;
}

/** Les deux services du module, tels que les handlers les reçoivent par injection. */
export interface HubDeps {
  store: GuildProviderService;
  registry: ProviderAdapterRegistry;
}

/** Ce qu'un handler reçoit une fois la garde passée. */
export interface HubAccess {
  guildId: string;
  userId: string;
  presenter: ProviderHubPresenter;
  reply: InteractionReply;
  /** Réaffiche le panneau dans cet état, relu depuis le store, et rend la vue affichée. */
  repaint(state: Partial<HubParams>): Promise<ProviderHubView>;
}

/** Corps d'un handler : rend `'modal'` quand il a ouvert une modale (première réponse de l'interaction). */
export type HubBody = (access: HubAccess) => Promise<'modal' | void>;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Un échec de handler reste diagnostiquable (journal et JSONL) sans jamais remonter au dispatcher. */
function report(interaction: HubInteraction, step: string, error: unknown): void {
  const message = reason(error);
  log.warn(`fournisseurs : ${step} impossible (${message.slice(0, 140)})`);
  fileLog()?.event('warn', 'providers', 'interaction_failed', { step, interactionId: interaction.id, error: message.slice(0, 300) });
}

/**
 * Garde et cadence communes à tous les handlers du panneau.
 *
 * 1. Garde : owner ou Administrator, dans un serveur ; sinon refus éphémère et rien d'autre.
 * 2. Le corps traite ; il acquitte (`reply.defer()`) avant le moindre appel lent,
 *    sauf s'il ouvre une modale, qui doit être la PREMIÈRE réponse (règle des 3 s).
 * 3. Toute exception devient un message éphémère portant la référence de l'interaction.
 * 4. Aucun clic n'est silencieux : un corps sans message reçoit au moins un accusé.
 */
export async function runHub(deps: HubDeps, interaction: HubInteraction, step: string, body: HubBody): Promise<void> {
  const reply = new InteractionReply(interaction, notices);
  const ctx = interactionAccessContext(interaction);
  const guildId = interaction.guildId ?? '';
  if (!ctx || !guildId || !guildAdminPolicy.isAuthorized(ctx)) {
    await reply.show(presenter.denied());
    return;
  }
  const views = new ProviderHubViewBuilder(deps.store, deps.registry);
  const access: HubAccess = {
    guildId,
    userId: ctx.userId,
    presenter,
    reply,
    repaint: async (state) => {
      const view = await views.build(guildId, state);
      await repaintPanel(interaction, presenter.render(view));
      return view;
    },
  };
  try {
    const opened = await body(access);
    if (opened !== 'modal' && !reply.isAnswered) await reply.show(presenter.updated());
  } catch (error) {
    report(interaction, step, error);
    await reply.show(presenter.failed(reason(error), interaction.id));
  }
}

function isPanelChannel(value: unknown): value is PanelChannel {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PanelChannel>;
  return typeof candidate.isTextBased === 'function' && typeof candidate.messages?.edit === 'function' && candidate.isTextBased();
}

/**
 * Met à jour le message du panneau. Après une modale, l'interaction ne porte
 * pas le message : il est retrouvé par son identifiant (`m=`). Un message
 * disparu ou refusé est journalisé et ne fait jamais échouer l'action déjà faite.
 */
export async function repaintPanel(interaction: HubInteraction, payload: MessageCreateOptions): Promise<void> {
  const body: PanelPayload = { components: payload.components };
  try {
    if (interaction.message) {
      await interaction.message.edit(body);
    } else {
      const messageId = parseHubParams(interaction.customId).m;
      if (messageId && isPanelChannel(interaction.channel)) await interaction.channel.messages.edit(messageId, body);
    }
  } catch (error) {
    report(interaction, 'rafraîchissement du panneau', error);
  }
}

/** Fournisseur de ce serveur ; sinon un refus éphémère et `null`. */
export async function requireProvider(access: HubAccess, store: GuildProviderService, id: string | null): Promise<ProviderConfig | null> {
  const provider = id ? await store.get(access.guildId, id) : null;
  if (provider) return provider;
  await access.reply.show(access.presenter.missingProvider());
  return null;
}

/** Redécouvre le catalogue et le retient. Lève l'erreur de l'adaptateur, que le handler relève en éphémère. */
export async function refreshCatalog(deps: HubDeps, guildId: string, provider: ProviderConfig): Promise<number> {
  const models: ProviderModel[] = await deps.registry.resolve(provider.protocol).discoverModels(provider);
  await deps.store.saveModels(guildId, provider.id, models);
  return models.length;
}

/**
 * Contrôle la connexion, puis retient le catalogue découvert si elle passe.
 * Un échec est un résultat, jamais une exception : le fournisseur est déjà
 * enregistré quand ce contrôle suit une modale.
 */
export async function probeProvider(deps: HubDeps, guildId: string, provider: ProviderConfig): Promise<ConnectionCheckResult> {
  let adapter: AbstractProviderAdapter;
  let result: ConnectionCheckResult;
  try {
    adapter = deps.registry.resolve(provider.protocol);
    result = await adapter.testConnection(provider);
  } catch (error) {
    return { ok: false, summary: reason(error), modelsFound: 0 };
  }
  if (!result.ok) return result;
  try {
    return { ok: true, summary: result.summary, modelsFound: await refreshCatalog(deps, guildId, provider) };
  } catch (error) {
    return { ok: true, summary: `${result.summary} ; catalogue non récupéré : ${reason(error)}`, modelsFound: 0 };
  }
}

/** Préremplit une modale construite par ModalService et rend les données API à montrer. La clé n'y figure jamais. */
export function prefillModal(modal: ModalBuilder, values: Record<string, string>): APIModalInteractionResponseCallbackData {
  const data = modal.toJSON();
  return {
    ...data,
    components: data.components.map((component) => {
      if (component.type !== ComponentType.Label || component.component.type !== ComponentType.TextInput) return component;
      const value = values[component.component.custom_id];
      if (value === undefined) return component;
      return { ...component, component: { ...component.component, value: value.slice(0, component.component.max_length ?? 4000) } };
    }),
  };
}
