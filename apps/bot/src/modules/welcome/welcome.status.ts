import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { makeStatusTool } from '../../shared/tools/status-tool';

/** Enregistre `welcome.status` : l'agent peut rapporter l'état welcome/farewell. */
@Injectable()
export class WelcomeStatusService implements SpraxiumOnBoot {
  constructor(
    private readonly config: GuildConfigService,
    private readonly registry: ToolRegistryService,
  ) {}

  async onBoot(): Promise<void> {
    this.registry.register(
      makeStatusTool({
        name: 'getWelcomeSetup',
        category: 'welcome',
        description: 'Welcome and farewell setup on this server: channels, autorole, templates.',
        summary: async (guildId) => {
          const c = await this.config.get(guildId);
          return [
            `**Welcome** : ${c.welcome.enabled ? 'activé' : 'désactivé'} → ${c.welcome.channelId ? `<#${c.welcome.channelId}>` : 'aucun salon'}`,
            `**Auto-rôle** : ${c.welcome.autoRoleId ? `<@&${c.welcome.autoRoleId}>` : 'aucun'}`,
            `**Farewell** : ${c.farewell.enabled ? 'activé' : 'désactivé'} → ${c.farewell.channelId ? `<#${c.farewell.channelId}>` : 'aucun salon'}`,
            `**Langue par défaut** : ${c.defaultLocale}`,
          ].join(' · ');
        },
      }),
    );
  }
}
