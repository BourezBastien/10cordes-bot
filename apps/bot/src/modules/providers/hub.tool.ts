import { z } from 'zod';
import { defineTool, type BotTool, type ToolResult } from '@10cordes/shared';
import type { Client } from 'discord.js';
import type { ConfigThreadService } from '../guild-config/config-thread.service';
import type { ProviderAdapterRegistry } from './provider-adapter.registry';
import type { GuildProviderService } from './provider-store.service';
import { ProviderHubViewBuilder } from './handlers/provider-hub.view';
import { ProviderHubPresenter } from './presenters/provider-hub.presenter';

export interface HubToolDeps {
  readonly store: GuildProviderService;
  readonly registry: ProviderAdapterRegistry;
  readonly client: Client;
  /** Fil privé de configuration du serveur : là où le panneau est posté. */
  readonly configThread: Pick<ConfigThreadService, 'postToThread'>;
}

/**
 * Tool `providers.panel` : poste le panneau « Fournisseurs et modèles » dans
 * le fil privé de configuration. C'est le point d'entrée cliquable du moteur
 * multi-fournisseurs : la clé se saisit dans la modale du panneau, jamais
 * dans le salon.
 */
export function buildHubTool(deps: HubToolDeps): BotTool {
  const presenter = new ProviderHubPresenter();
  const views = new ProviderHubViewBuilder(deps.store, deps.registry);
  return defineTool({
    name: 'providers.panel',
    description:
      'Ouvre le panneau « Fournisseurs et modèles » dans le fil privé ⚙️┃config-bot : ajouter ou modifier un fournisseur IA (la clé se saisit dans une modale, jamais dans le salon), tester une connexion, choisir par menus le modèle de chaque capacité (conversation, raisonnement, image, musique, voix...).',
    category: 'providers',
    paramsSchema: z.object({}),
    requiredModules: [],
    permissions: ['Administrator'],
    destructive: false,
    systemPrompt:
      'Pour « change de modèle », « ajoute OpenRouter », « utilise Claude pour raisonner » : ouvre ce panneau. Une clé API ne se tape JAMAIS dans le salon : c\u0027est la modale du panneau qui la reçoit. Après une connexion faite par provider.upsert, lie les capacités avec capability.bind.',
    handler: async (_input, ctx): Promise<ToolResult> => {
      const guild = deps.client.guilds.cache.get(ctx.guildId ?? '');
      if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
      try {
        const view = await views.build(guild.id, {});
        const link = await deps.configThread.postToThread(guild, presenter.render(view));
        const summary = `Panneau « Fournisseurs et modèles » posté dans ${link} (fil privé staff) : ${view.providers.length} fournisseur(s), ${view.routes.length} capacité(s) routée(s).`;
        return { ok: true, summary, data: { providers: view.providers.length, routes: view.routes.length } };
      } catch (error) {
        return { ok: false, summary: `Impossible de poster le panneau : ${error instanceof Error ? error.message.slice(0, 160) : 'erreur inconnue'}` };
      }
    },
  });
}
