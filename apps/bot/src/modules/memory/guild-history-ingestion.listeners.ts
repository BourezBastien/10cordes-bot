import { Listener, On } from '@spraxium/common';
import { Events, type Guild } from 'discord.js';
import { fileLog } from '../logging/file-log.service';
import { FRESH_JOIN_WINDOW_MS, GuildHistoryIngestionService } from './guild-history-ingestion.service';

/**
 * Premier join du bot sur un serveur → ingestion de l'historique en tâche de
 * fond (10s de délai pour laisser le cache des salons se peupler).
 *
 * Au LOGIN, discord.js rejoue GuildCreate pour chaque serveur connu :
 * joinedTimestamp ancien → ignoré (ces serveurs s'ingèrent via le tool
 * admin guild.ingestHistory s'ils ont raté le premier passage).
 */
@Listener(Events.GuildCreate)
export class GuildHistoryIngestionListener {
  constructor(private readonly ingestion: GuildHistoryIngestionService) {}

  @On()
  async onGuildCreate(guild: Guild): Promise<void> {
    const isFreshJoin = Date.now() - guild.joinedTimestamp < FRESH_JOIN_WINDOW_MS;
    if (!isFreshJoin) return;

    fileLog()?.event('info', 'ingestion', 'guild_joined', { guildId: guild.id, name: guild.name });
    const timer = setTimeout(() => {
      void this.ingestion
        .trigger(guild.id, { actorId: guild.ownerId })
        .then((result) => {
          if (result.status === 'started') {
            fileLog()?.event('info', 'ingestion', 'auto_started', { guildId: guild.id });
          }
        })
        .catch(() => {});
    }, 10_000);
    timer.unref?.();
  }
}
