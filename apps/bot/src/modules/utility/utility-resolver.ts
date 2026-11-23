import type { Client } from 'discord.js';

/**
 * Résolveurs Discord des tools utility, lus dans le cache du client (aucun
 * appel réseau) : le serveur de la demande et un salon textuel de ce serveur.
 */
export class UtilityResolver {
  constructor(private readonly client: Client) {}

  guildOf(ctx: { guildId: string | null }) {
    return ctx.guildId ? (this.client.guilds.cache.get(ctx.guildId) ?? null) : null;
  }

  textChannel(guildId: string, channelId: string) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return null;
    const channel = guild.channels.cache.get(channelId);
    return channel && channel.isTextBased() && !channel.isDMBased() ? channel : null;
  }
}

/** Ce dont les tools utility ont besoin : le client (cache Discord) et ses résolveurs de serveur et de salon. */
export interface UtilityToolsDeps {
  readonly client: Client;
  readonly resolver: UtilityResolver;
}
