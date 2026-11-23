import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Client } from 'discord.js';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { makeStatusTool } from '../../shared/tools/status-tool';
import type { LogCategory } from '@10cordes/shared';
import { LogEntryPresenter } from './presenters/log-entry.presenter';

export const LOG_CATEGORIES: LogCategory[] = ['messages', 'members', 'voice', 'moderation', 'server'];

/**
 * Envoi des logs vers les salons configurés par catégorie : fire-and-forget,
 * un log qui échoue n'interrompt jamais le flow qui l'a déclenché.
 */
@Injectable()
export class LoggingService implements SpraxiumOnBoot {
  // Presenter pur : champ de classe, jamais un paramètre de constructeur DI.
  private readonly presenter = new LogEntryPresenter();

  constructor(
    private readonly config: GuildConfigService,
    private readonly client: Client,
    private readonly registry: ToolRegistryService,
  ) {}

  async onBoot(): Promise<void> {
    this.registry.register(
      makeStatusTool({
        name: 'getLogSetup',
        category: 'logging',
        description: 'Log routing on this server: channel per category and excluded roles.',
        summary: async (guildId) => {
          const c = await this.config.get(guildId);
          const routes = LOG_CATEGORIES.map((category) => {
            const channelId = c.logs.channels[category];
            return `**${category}** : ${channelId ? `<#${channelId}>` : 'off'}`;
          });
          const ignored = c.logs.ignoredRoles.map((id) => `<@&${id}>`).join(' ') || 'aucun';
          return `${routes.join(' · ')} · **Rôles exclus** : ${ignored}`;
        },
      }),
    );
  }

  async log(
    guildId: string,
    category: LogCategory,
    payload: { title: string; lines: string[]; accentColor?: number },
  ): Promise<void> {
    try {
      const config = await this.config.get(guildId);
      const channelId = config.logs.channels[category];
      if (!channelId) return;

      const channel = await this.client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased() || channel.partial) return;
      await (channel as import('discord.js').TextChannel).send(this.presenter.render(payload, category));
    } catch {
      // no-op : le logging ne casse jamais le flow principal
    }
  }
}
