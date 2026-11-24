import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { CAPABILITY_LABELS, NATIVE_CAPABILITIES, capabilityKind, type NativeCapability, type ProviderModel } from '../provider.types';
import type { ProviderView, RouteView } from '../provider-views';
import { HUB_ADD, HUB_EMPTY, PROVIDER_HUB_IDS, PROVIDER_HUB_LABELS, PROVIDER_HUB_PAGE_SIZE, hubId } from './provider-hub.contracts';
import type { ProviderHubView } from './provider-hub.presenter';

/**
 * Éléments du panneau « Fournisseurs et modèles » : fonctions pures qui
 * produisent textes, menus et boutons. Le presenter les assemble. Aucune clé
 * n'entre ici : les vues (`ProviderView`, `RouteView`) n'en portent pas, et
 * l'URL de base n'apparaît que par son hôte.
 */

/** Identifiant affiché (slug, modèle, capacité) : tronqué. */
export const HUB_ID_MAX = 80;
/** Limite Discord d'un label, d'une valeur ou d'une description d'option. */
export const HUB_FIELD_MAX = 100;
const HOST_MAX = 60;
/** Les 25 options d'un menu, moins « Ajouter un fournisseur ». */
const LISTED_PROVIDERS_MAX = PROVIDER_HUB_PAGE_SIZE - 1;
/** Les 4 000 caractères d'un message V2 se partagent entre ses textes. */
const PROVIDER_BLOCK_MAX = 1600;

/** Texte affichable : sans backtick ni saut de ligne (le markdown reste lisible), tronqué. */
export function clip(value: string, max: number): string {
  return value.replace(/[`\r\n]/gu, ' ').trim().slice(0, max);
}

/** Hôte de l'URL de base : jamais le chemin ni la requête, qui peuvent porter un secret. */
export function hostOf(baseUrl: string): string {
  try {
    return clip(new URL(baseUrl).host, HOST_MAX) || 'hôte inconnu';
  } catch {
    return 'hôte inconnu';
  }
}

/** Capacité native affichée : celle demandée, sinon la première. */
export function nativeCapability(capability: string | null | undefined): NativeCapability {
  return (NATIVE_CAPABILITIES as readonly string[]).includes(capability ?? '') ? (capability as NativeCapability) : NATIVE_CAPABILITIES[0];
}

/** Fournisseur sélectionné, s'il existe encore. */
export function selectedProvider(view: ProviderHubView): ProviderView | null {
  return view.providers.find((entry) => entry.id === view.selectedProviderId) ?? null;
}

/** Route d'une capacité : `fournisseur / modèle`, ou `non routée` sans route. */
export function routeTarget(routes: readonly RouteView[], capability: string): { route: RouteView | null; text: string } {
  const route = routes.find((candidate) => candidate.capability === capability) ?? null;
  if (!route) return { route: null, text: 'non routée' };
  return { route, text: `${clip(route.providerSlug, HUB_ID_MAX)} / ${clip(route.modelId, HUB_ID_MAX)}` };
}

/** Mention d'une route désactivée (rien pour une route active ou absente). */
function disabledNote(route: RouteView | null): string {
  return route && !route.enabled ? ' (désactivée)' : '';
}

export interface ModelPage {
  models: ProviderModel[];
  page: number;
  pages: number;
}

/** Fenêtre de contexte lisible : 128000 devient 128k. */
function windowLabel(size: number): string {
  return size >= 1000 ? `${Math.round(size / 1000)}k` : String(size);
}

/**
 * Modèles proposés pour une capacité : ceux du fournisseur dont la famille
 * correspond (tous si aucun ne correspond), sans doublon ni identifiant que
 * Discord refuserait (plus de 100 caractères), par pages de 25. La page
 * demandée est ramenée dans les pages existantes.
 */
export function modelPage(provider: ProviderView | null, capability: string, requested: number): ModelPage {
  const kind = capabilityKind(capability);
  const seen = new Set<string>();
  const listable: ProviderModel[] = [];
  for (const model of provider?.catalog ?? []) {
    if (!model.id || model.id.length > HUB_FIELD_MAX || seen.has(model.id)) continue;
    seen.add(model.id);
    listable.push(model);
  }
  const matching = listable.filter((model) => model.kind === kind);
  const models = matching.length > 0 ? matching : listable;
  const pages = Math.max(1, Math.ceil(models.length / PROVIDER_HUB_PAGE_SIZE));
  const page = Math.min(Math.max(Math.trunc(requested) || 1, 1), pages);
  return { models: models.slice((page - 1) * PROVIDER_HUB_PAGE_SIZE, page * PROVIDER_HUB_PAGE_SIZE), page, pages };
}

/** Option de menu : label et description bornés aux 100 caractères de Discord. */
function option(label: string, value: string, description = '', isDefault = false): StringSelectMenuOptionBuilder {
  const builder = new StringSelectMenuOptionBuilder().setLabel(clip(label, HUB_FIELD_MAX) || '?').setValue(value.slice(0, HUB_FIELD_MAX));
  const text = clip(description, HUB_FIELD_MAX);
  if (text) builder.setDescription(text);
  if (isDefault) builder.setDefault(true);
  return builder;
}

function selectRow(menu: StringSelectMenuBuilder): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/** Menu des fournisseurs (24 au plus, puis « Ajouter un fournisseur ») ; il porte la capacité pour ne pas la perdre. */
export function providerMenu(view: ProviderHubView): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder().setCustomId(hubId(PROVIDER_HUB_IDS.select, { c: view.selectedCapability })).setPlaceholder('Fournisseur');
  for (const provider of view.providers.slice(0, LISTED_PROVIDERS_MAX)) {
    const description = `${provider.protocol} · ${hostOf(provider.baseUrl)}`;
    menu.addOptions(option(clip(provider.slug, HUB_ID_MAX), provider.id, description, provider.id === view.selectedProviderId));
  }
  menu.addOptions(option('Ajouter un fournisseur', HUB_ADD, 'Ouvre le formulaire de connexion'));
  return selectRow(menu);
}

/** Menu des capacités natives ; il porte le fournisseur pour ne pas le perdre. */
export function capabilityMenu(view: ProviderHubView): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder().setCustomId(hubId(PROVIDER_HUB_IDS.capability, { p: view.selectedProviderId })).setPlaceholder('Capacité');
  for (const capability of NATIVE_CAPABILITIES) {
    const { route, text } = routeTarget(view.routes, capability);
    menu.addOptions(option(CAPABILITY_LABELS[capability], capability, text + disabledNote(route), capability === view.selectedCapability));
  }
  return selectRow(menu);
}

/** Menu des modèles de la page courante ; le modèle de la route courante est présélectionné. */
export function modelMenu(view: ProviderHubView, page: ModelPage): ActionRowBuilder<StringSelectMenuBuilder> {
  const provider = selectedProvider(view);
  const menu = new StringSelectMenuBuilder().setCustomId(hubId(PROVIDER_HUB_IDS.model, { p: provider?.id, c: view.selectedCapability, n: page.page }));
  if (!provider) {
    menu.setPlaceholder('Modèle').addOptions(option('Choisis d\u0027abord un fournisseur', HUB_EMPTY));
  } else if (page.models.length === 0) {
    menu.setPlaceholder('Catalogue vide').addOptions(option('Catalogue vide', HUB_EMPTY, 'Actualise le catalogue ou vérifie la clé'));
  } else {
    const bound = routeTarget(view.routes, view.selectedCapability).route;
    menu.setPlaceholder(page.pages > 1 ? `Page ${page.page}/${page.pages}` : 'Modèle');
    for (const model of page.models) {
      const description = model.contextWindow ? `${model.kind ?? 'autre'} · contexte ${windowLabel(model.contextWindow)}` : model.kind ?? 'autre';
      const current = bound?.providerId === provider.id && bound.modelId === model.id;
      menu.addOptions(option(clip(model.id, HUB_ID_MAX), model.id, description, current));
    }
  }
  return selectRow(menu);
}

/** Ligne de synthèse : fournisseurs déclarés, capacités natives routées. */
export function summaryLine(view: ProviderHubView): string {
  const routed = NATIVE_CAPABILITIES.filter((capability) => view.routes.some((route) => route.capability === capability)).length;
  return `${view.providers.length} fournisseur(s) connecté(s), ${routed} capacité(s) routée(s) sur ${NATIVE_CAPABILITIES.length}`;
}

/** Fournisseurs : slug en gras, protocole, hôte, modèles, puis ses états. */
export function providersBlock(view: ProviderHubView): string {
  if (view.providers.length === 0) return `**Fournisseurs**\nAucun fournisseur. Le bouton **${PROVIDER_HUB_LABELS.add}** en connecte un.`;
  const lines = ['**Fournisseurs**'];
  let budget = PROVIDER_BLOCK_MAX;
  for (const [index, provider] of view.providers.entries()) {
    const hidden = view.providers.length - index;
    const tags = [`${provider.models} modèle(s)`];
    if (!provider.enabled) tags.push('désactivé');
    if (!provider.hasKey) tags.push('sans clé');
    if (provider.id === view.selectedProviderId) tags.push('sélectionné');
    const line = `- **${clip(provider.slug, HUB_ID_MAX)}** · ${clip(provider.protocol, 40)} · ${hostOf(provider.baseUrl)} · ${tags.join(' · ')}`;
    if (index >= LISTED_PROVIDERS_MAX || line.length > budget) {
      lines.push(`- et ${hidden} autre(s) non listé(s)`);
      break;
    }
    lines.push(line);
    budget -= line.length;
  }
  return lines.join('\n');
}

/** Tableau des capacités natives : `slug / modèle` pour chacune, ou `non routée`. */
export function capabilitiesBlock(view: ProviderHubView): string {
  const lines = NATIVE_CAPABILITIES.map((capability) => {
    const { route, text } = routeTarget(view.routes, capability);
    return `- ${CAPABILITY_LABELS[capability]} : ${route ? `\`${text}\`${disabledNote(route)}` : text}`;
  });
  return ['**Capacités**', ...lines].join('\n');
}

function hubButton(customId: string, label: keyof typeof PROVIDER_HUB_LABELS, style: ButtonStyle): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId).setLabel(PROVIDER_HUB_LABELS[label]).setStyle(style);
}

/**
 * Rangées de boutons : « Ajouter » toujours ; modification, test, actualisation
 * et suppression quand un fournisseur est sélectionné ; pagination quand le
 * catalogue dépasse une page.
 */
export function buttonRows(view: ProviderHubView, page: ModelPage): ActionRowBuilder<ButtonBuilder>[] {
  const rows = [new ActionRowBuilder<ButtonBuilder>().addComponents(hubButton(PROVIDER_HUB_IDS.add, 'add', ButtonStyle.Primary))];
  const provider = selectedProvider(view);
  if (!provider) return rows;
  const state = { p: provider.id, c: view.selectedCapability };
  rows[0].addComponents(
    hubButton(hubId(PROVIDER_HUB_IDS.edit, { p: provider.id }), 'edit', ButtonStyle.Secondary),
    hubButton(hubId(PROVIDER_HUB_IDS.test, { ...state, n: page.page }), 'test', ButtonStyle.Secondary),
    hubButton(hubId(PROVIDER_HUB_IDS.refresh, { ...state, n: page.page }), 'refresh', ButtonStyle.Secondary),
    hubButton(hubId(PROVIDER_HUB_IDS.delete, state), 'delete', ButtonStyle.Danger),
  );
  if (page.pages < 2) return rows;
  const pager = new ActionRowBuilder<ButtonBuilder>();
  if (page.page > 1) pager.addComponents(hubButton(hubId(PROVIDER_HUB_IDS.page, { ...state, n: page.page - 1 }), 'previous', ButtonStyle.Secondary));
  if (page.page < page.pages) pager.addComponents(hubButton(hubId(PROVIDER_HUB_IDS.page, { ...state, n: page.page + 1 }), 'next', ButtonStyle.Secondary));
  if (pager.components.length > 0) rows.push(pager);
  return rows;
}
