import type { Message } from 'discord.js';
import type { PrismaService } from '../database/prisma.service';

/** Un message supprimé ou édité, tel que retenu pour le tool snipe. */
export interface SnipeEntry {
  author: string;
  content: string;
  action: 'deleted' | 'edited';
  at: number;
}

/**
 * État volatile de la vie de serveur (mémoire du processus, perdu au
 * redémarrage) : messages retenus pour le snipe, salons ouverts avant un
 * lockdown, compteur de messages en attente de flush.
 */
export class ServerlifeStore {
  private readonly snipes = new Map<string, SnipeEntry[]>();
  private readonly lockedChannels = new Map<string, Set<string>>();
  private readonly activityBuffer = new Map<string, number>(); // clé guildId:userId -> delta messages

  constructor(private readonly prisma: PrismaService) {}

  /** Capture un message supprimé/édité pour le tool snipe (ring buffer 25/salon). */
  captureSnipe(message: Message, action: 'deleted' | 'edited', newContent?: string): void {
    // Les messages partiels (hors cache après restart) n'ont pas d'author :
    // ignorer plutôt que crasher (fix du crash « Cannot read null.bot »).
    if (!message.guildId || !message.author || message.author.bot) return;
    if (action === 'edited' && !message.content) return;
    const buffer = this.snipes.get(message.channelId) ?? [];
    buffer.push({
      author: message.author.username,
      content: (action === 'edited' ? `avant : ${message.content} → après : ${newContent ?? ''}` : message.content) || '(sans texte)',
      action,
      at: Date.now(),
    });
    if (buffer.length > 25) buffer.shift();
    this.snipes.set(message.channelId, buffer);
  }

  /** Messages retenus pour le snipe d'un salon (vide si aucun). */
  recentSnipes(channelId: string): SnipeEntry[] {
    return this.snipes.get(channelId) ?? [];
  }

  /** Retient les salons qui étaient ouverts avant le lockdown d'un serveur. */
  rememberOpenChannels(guildId: string, channelIds: Set<string>): void {
    this.lockedChannels.set(guildId, channelIds);
  }

  /** Salons ouverts avant le lockdown d'un serveur (undefined : aucun lockdown mémorisé). */
  openChannelsBeforeLock(guildId: string): ReadonlySet<string> | undefined {
    return this.lockedChannels.get(guildId);
  }

  /** Oublie l'état pré-lockdown d'un serveur (après un unlock). */
  forgetLock(guildId: string): void {
    this.lockedChannels.delete(guildId);
  }

  /** Incrémente le compteur de messages (buffer mémoire, flush 60s). */
  countMessage(guildId: string, userId: string): void {
    const key = `${guildId}:${userId}`;
    this.activityBuffer.set(key, (this.activityBuffer.get(key) ?? 0) + 1);
  }

  /** Écrit en base le compteur de messages accumulé, puis vide le buffer. */
  async flushActivity(): Promise<void> {
    if (this.activityBuffer.size === 0) return;
    const entries = [...this.activityBuffer.entries()];
    this.activityBuffer.clear();
    for (const [key, delta] of entries) {
      const parts = key.split(':');
      const guildId = parts[0];
      const userId = parts[1];
      await this.prisma.memberActivity
        .upsert({
          where: { guildId_userId: { guildId, userId } },
          create: { guildId, userId, messages: delta },
          update: { messages: { increment: delta } },
        })
        .catch(() => {});
    }
  }
}
