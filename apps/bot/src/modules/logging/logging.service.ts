import { Injectable } from '@spraxium/common';
import { MessageFlags } from 'discord.js';
import { Client } from 'discord.js';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { panel } from '../../shared/ui';
import type { LogCategory } from '@10cordes/shared';

export const LOG_CATEGORIES: LogCategory[] = ['messages', 'members', 'voice', 'moderation', 'server'];

/**
 * Envoi des logs vers les salons configurés par catégorie — fire-and-forget :
 * un log qui échoue n'interrompt jamais le flow qui l'a déclenché.
 */
@Injectable()
export class LoggingService {
  constructor(
    private readonly config: GuildConfigService,
    private readonly client: Client,
  ) {}

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
      await (channel as import('discord.js').TextChannel).send({
        flags: MessageFlags.IsComponentsV2,
        components: [panel({ ...payload, footer: `catégorie : ${category}` })],
      });
    } catch {
      // no-op : le logging ne casse jamais le flow principal
    }
  }
}
