import type { Client } from 'discord.js';
import type { AuditService } from '../audit/audit.service';

/**
 * Purge de messages : supprime en masse les messages récents d'un salon
 * (moins de 14 jours, limite Discord), éventuellement d'un seul auteur.
 * Écrit la piste d'audit `mod.purge`, sans créer de case.
 */
export class MessagePurge {
  constructor(
    private readonly client: Client,
    private readonly audit: AuditService,
  ) {}

  async purge(channelId: string, guildId: string, moderatorId: string, count: number, userId?: string): Promise<number> {
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || channel.partial) return 0;
    const textChannel = channel as import('discord.js').TextChannel;

    const fetched = await textChannel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!fetched) return 0;

    const now = Date.now();
    const deletable = fetched.filter(
      (message) =>
        now - message.createdTimestamp < 14 * 24 * 60 * 60 * 1_000 && (!userId || message.author.id === userId),
    );
    const targets = deletable.first(Math.min(count, 100)) ?? [];
    if (targets.length === 0) return 0;

    await textChannel.bulkDelete(targets, true).catch(() => 0);
    const deleted = targets.length;

    this.audit.record({
      guildId,
      source: 'discord',
      action: 'mod.purge',
      actorId: moderatorId,
      targetId: userId ?? null,
      metadata: { deleted, channelId },
    });
    return deleted;
  }
}
