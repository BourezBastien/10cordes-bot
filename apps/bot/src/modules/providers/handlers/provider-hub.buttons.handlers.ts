import { Ctx } from '@spraxium/common';
import { Button, ButtonHandler, ModalService } from '@spraxium/components';
import type { ButtonInteraction } from 'discord.js';
import { ProviderAdapterRegistry } from '../provider-adapter.registry';
import { GuildProviderService } from '../provider-store.service';
import { PROVIDER_HUB_IDS, PROVIDER_HUB_LABELS } from '../presenters/provider-hub.presenter';
import { modelPage, selectedProvider } from '../presenters/provider-hub.parts';
import { providerFormValues } from './provider-hub.form';
import { providerModal } from './provider-hub.handlers';
import { parseHubParams } from './provider-hub.params';
import { probeProvider, refreshCatalog, requireProvider, runHub } from './provider-hub.support';

/**
 * Boutons du panneau « Fournisseurs et modèles ». Chacun porte l'état du
 * panneau dans son customId et a sa classe décorée : sans `@ButtonHandler`,
 * le dispatcher ne route rien et le clic reste muet.
 */

@Button({ customId: PROVIDER_HUB_IDS.add, label: PROVIDER_HUB_LABELS.add, style: 'primary' })
export class ProviderAddButton {}

@Button({ customId: PROVIDER_HUB_IDS.edit, label: PROVIDER_HUB_LABELS.edit, style: 'secondary' })
export class ProviderEditButton {}

@Button({ customId: PROVIDER_HUB_IDS.test, label: PROVIDER_HUB_LABELS.test, style: 'secondary' })
export class ProviderTestButton {}

@Button({ customId: PROVIDER_HUB_IDS.refresh, label: PROVIDER_HUB_LABELS.refresh, style: 'secondary' })
export class ProviderRefreshButton {}

@Button({ customId: PROVIDER_HUB_IDS.delete, label: PROVIDER_HUB_LABELS.delete, style: 'danger' })
export class ProviderDeleteButton {}

/** Précédent et Suivant partagent la base `provider:page` : la page cible est dans `~n=`. */
@Button({ customId: PROVIDER_HUB_IDS.page, label: PROVIDER_HUB_LABELS.next, style: 'secondary' })
export class ProviderPageButton {}

/** Ouvre la modale de création. */
@ButtonHandler(ProviderAddButton)
export class ProviderAddButtonHandler {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
    private readonly modals: ModalService,
  ) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await runHub({ store: this.store, registry: this.registry }, interaction, 'ajout', async () => {
      // showModal doit être la PREMIÈRE réponse de l'interaction (règle des 3 s) : rien avant.
      await interaction.showModal(providerModal(this.modals, { m: interaction.message?.id }));
      return 'modal';
    });
  }
}

/** Ouvre la modale de modification, préremplie. */
@ButtonHandler(ProviderEditButton)
export class ProviderEditButtonHandler {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
    private readonly modals: ModalService,
  ) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await runHub({ store: this.store, registry: this.registry }, interaction, 'modification', async (access) => {
      const provider = await requireProvider(access, this.store, parseHubParams(interaction.customId).p);
      if (!provider) return;
      // showModal doit être la PREMIÈRE réponse de l'interaction (règle des 3 s) : aucune réponse avant.
      await interaction.showModal(providerModal(this.modals, { p: provider.id, m: interaction.message?.id }, providerFormValues(provider)));
      return 'modal';
    });
  }
}

/** Contrôle la connexion et retient le catalogue découvert quand elle passe. */
@ButtonHandler(ProviderTestButton)
export class ProviderTestButtonHandler {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
  ) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await runHub({ store: this.store, registry: this.registry }, interaction, 'test', async (access) => {
      await access.reply.defer();
      const provider = await requireProvider(access, this.store, parseHubParams(interaction.customId).p);
      if (!provider) return;
      const result = await probeProvider({ store: this.store, registry: this.registry }, access.guildId, provider);
      await access.repaint(parseHubParams(interaction.customId));
      await access.reply.show(access.presenter.testResult(result));
    });
  }
}

/** Redécouvre le catalogue du fournisseur (nouveau modèle côté fournisseur, clé corrigée...). */
@ButtonHandler(ProviderRefreshButton)
export class ProviderRefreshButtonHandler {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
  ) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await runHub({ store: this.store, registry: this.registry }, interaction, 'actualisation', async (access) => {
      await access.reply.defer();
      const provider = await requireProvider(access, this.store, parseHubParams(interaction.customId).p);
      if (!provider) return;
      const count = await refreshCatalog({ store: this.store, registry: this.registry }, access.guildId, provider);
      await access.repaint(parseHubParams(interaction.customId));
      await access.reply.show(access.presenter.catalogRefreshed(count));
    });
  }
}

/** Supprime le fournisseur ; ses routes partent avec lui (cascade de la base). */
@ButtonHandler(ProviderDeleteButton)
export class ProviderDeleteButtonHandler {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
  ) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await runHub({ store: this.store, registry: this.registry }, interaction, 'suppression', async (access) => {
      await access.reply.defer();
      const { p, c } = parseHubParams(interaction.customId);
      const provider = await requireProvider(access, this.store, p);
      if (!provider) return;
      await this.store.remove(access.guildId, provider.id, access.userId);
      await access.repaint({ p: null, c });
      await access.reply.show(access.presenter.providerDeleted(provider.slug));
    });
  }
}

/** Change de page dans le menu des modèles ; la confirmation nomme la page affichée, pas celle demandée. */
@ButtonHandler(ProviderPageButton)
export class ProviderPageButtonHandler {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
  ) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await runHub({ store: this.store, registry: this.registry }, interaction, 'pagination', async (access) => {
      await access.reply.defer();
      const { p, c, n } = parseHubParams(interaction.customId);
      const view = await access.repaint({ p, c, n });
      const shown = modelPage(selectedProvider(view), view.selectedCapability, view.page).page;
      await access.reply.show(access.presenter.pageShown(shown));
    });
  }
}
