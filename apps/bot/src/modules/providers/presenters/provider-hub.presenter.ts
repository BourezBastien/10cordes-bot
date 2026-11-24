import { MessageFlags, type MessageCreateOptions, type TextDisplayBuilder } from 'discord.js';
import { capabilityLabel, type ConnectionCheckResult } from '../provider.types';
import type { ProviderView, RouteView } from '../provider-views';
import { notice, panel } from '../../../shared/ui';
import {
  HUB_ADD,
  HUB_EMPTY,
  PROVIDER_HUB_IDS,
  PROVIDER_HUB_LABELS,
  PROVIDER_HUB_PAGE_SIZE,
  hubId,
  type HubRef,
} from './provider-hub.contracts';
import {
  HUB_ID_MAX,
  buttonRows,
  capabilitiesBlock,
  capabilityMenu,
  clip,
  modelMenu,
  modelPage,
  nativeCapability,
  providerMenu,
  providersBlock,
  selectedProvider,
  summaryLine,
} from './provider-hub.parts';

/** Le contrat des customIds et des boutons, publié par le presenter pour les handlers. */
export { HUB_ADD, HUB_EMPTY, HUB_ID_MAX, PROVIDER_HUB_IDS, PROVIDER_HUB_LABELS, PROVIDER_HUB_PAGE_SIZE, hubId, type HubRef };

/** Données du panneau : vues publiques seulement, jamais une clé. */
export interface ProviderHubView {
  providers: ProviderView[];
  routes: RouteView[];
  selectedProviderId: string | null;
  /** Une capacité native. */
  selectedCapability: string;
  /** Page du menu des modèles (à partir de 1). */
  page: number;
}

/** Message éphémère en Components V2. */
export type EphemeralPayload = { flags: number; components: TextDisplayBuilder[] };

/** Longueur gardée pour la raison d'un échec dans un message éphémère. */
const REASON_MAX = 300;

/**
 * Panneau « Fournisseurs et modèles ». POO pure : données en, payload Discord
 * complet en (drapeau IsComponentsV2 compris), zéro appel, zéro effet de
 * bord. L'état (fournisseur, capacité, page) voyage dans les customIds.
 */
export class ProviderHubPresenter {
  /** Un seul conteneur V2 : synthèse, fournisseurs, capacités, trois menus, boutons. */
  render(view: ProviderHubView): MessageCreateOptions {
    const scope: ProviderHubView = { ...view, selectedCapability: nativeCapability(view.selectedCapability) };
    const page = modelPage(selectedProvider(scope), scope.selectedCapability, scope.page);
    const container = panel({
      title: '## Fournisseurs et modèles',
      lines: [summaryLine(scope), providersBlock(scope), capabilitiesBlock(scope)],
      footer: 'Les clés sont chiffrées et ne s\u0027affichent jamais.',
    });
    container.addActionRowComponents(providerMenu(scope));
    container.addActionRowComponents(capabilityMenu(scope));
    container.addActionRowComponents(modelMenu(scope, page));
    for (const row of buttonRows(scope, page)) container.addActionRowComponents(row);
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  /** Refus de la Policy (propriétaire ou Administrator) : éphémère, sans détail utile. */
  denied(): EphemeralPayload {
    return notice('🚫 Seul un administrateur du serveur peut gérer les fournisseurs et les modèles.', true);
  }

  /** Fournisseur enregistré ; le contrôle de connexion s'il a eu lieu, et une note s'il y en a une. La clé n'apparaît jamais. */
  providerSaved(slug: string, tested: ConnectionCheckResult | null = null, note: string | null = null): EphemeralPayload {
    const lines = [`✅ Fournisseur **${clip(slug, HUB_ID_MAX)}** enregistré.`];
    if (note) lines.push(note);
    if (!tested) lines.push('Aucune clé enregistrée : la connexion n\u0027a pas été contrôlée.');
    else if (!tested.ok) lines.push(`La connexion échoue : ${clip(tested.summary, REASON_MAX)}`);
    else lines.push(`Connexion réussie : ${clip(tested.summary, REASON_MAX)} · ${tested.modelsFound} modèle(s) au catalogue.`);
    return notice(lines.join('\n'), true);
  }

  /** Fournisseur supprimé : ses routes partent avec lui (cascade de la base). */
  providerDeleted(slug: string): EphemeralPayload {
    return notice(`🗑️ Fournisseur **${clip(slug, HUB_ID_MAX)}** supprimé. Les capacités qu\u0027il servait ne sont plus routées.`, true);
  }

  /** Résultat d'un test de connexion : la raison d'un échec reste utile. */
  testResult(result: ConnectionCheckResult): EphemeralPayload {
    const verdict = result.ok ? `Connexion réussie : ${result.modelsFound} modèle(s) découvert(s).` : `Connexion échouée : ${clip(result.summary, REASON_MAX)}`;
    return notice(`${result.ok ? '✅' : '❌'} ${verdict}`, true);
  }

  /** Capacité liée à un modèle. */
  /** Capacité liée à un modèle. Les routes de conversation qui partageaient son modèle l'ont suivie. */
  routeBound(capability: string, slug: string, model: string, followedBy: readonly string[] = []): EphemeralPayload {
    const target = `${clip(slug, HUB_ID_MAX)} / ${clip(model, HUB_ID_MAX)}`;
    const followers =
      followedBy.length > 0 ? `\n${followedBy.map(capabilityLabel).join(' et ')} partageaient ce modèle : elles suivent.` : '';
    return notice(`✅ **${capabilityLabel(capability)}** routée vers \`${target}\`.${followers}`, true);
  }

  /** Action refusée ou échouée, avec la référence de l'interaction. */
  failed(message: string, reference: string): EphemeralPayload {
    return notice(`❌ Action impossible : ${clip(message, REASON_MAX)} [${reference}]`, true);
  }

  /** Fournisseur disparu entre l'affichage du panneau et le clic. */
  missingProvider(): EphemeralPayload {
    return notice('❌ Fournisseur introuvable sur ce serveur (supprimé entre-temps ?).', true);
  }

  /** Le menu des modèles n'a rien à lier. */
  emptyCatalog(): EphemeralPayload {
    return notice('❌ Aucun modèle à lier : choisis un fournisseur, puis actualise son catalogue.', true);
  }

  providerSelected(slug: string): EphemeralPayload {
    return notice(`✅ Fournisseur **${clip(slug, HUB_ID_MAX)}** sélectionné.`, true);
  }

  capabilitySelected(capability: string): EphemeralPayload {
    return notice(`✅ Capacité **${capabilityLabel(capability)}** sélectionnée.`, true);
  }

  pageShown(page: number): EphemeralPayload {
    return notice(`✅ Page ${page} du catalogue.`, true);
  }

  catalogRefreshed(count: number): EphemeralPayload {
    return notice(`✅ Catalogue actualisé : ${count} modèle(s) retenus.`, true);
  }

  /** Accusé générique : un clic n'est jamais silencieux. */
  updated(): EphemeralPayload {
    return notice('✅ Panneau actualisé.', true);
  }
}
