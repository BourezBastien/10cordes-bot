import { Listener, On } from '@spraxium/common';
import { Events, type GuildBan } from 'discord.js';
import { LoggingService } from '../logging.service';

/** Bans en direct — l'audit complet (acteur) passe par le module modération. */
@Listener(Events.GuildBanAdd)
export class BanAddListener {
  constructor(private readonly logging: LoggingService) {}

  @On()
  async onGuildBanAdd(ban: GuildBan): Promise<void> {
    const guildId = ban.guild.id;
    await this.logging.log(guildId, 'moderation', {
      title: '## ⛔ Membre banni',
      lines: [
        `**${ban.user.username}** (\`${ban.user.id}\`)`,
        ban.reason ? `Raison : ${ban.reason}` : 'Raison : (aucune)',
      ],
      accentColor: 0xe8_8b_94,
    });
  }
}
