import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client, Events } from 'discord.js';
import { PrismaService } from '../database/prisma.service';
import { AssistantService } from './assistant.service';

const MAX_BACKFILL = 20;
const MAX_AGE_MS = 30 * 60_000;

/**
 * Récupération au boot : pendant un redémarrage, les events gateway sont
 * perdus (Discord ne queue rien pour un bot hors ligne). Au reconnexion,
 * on RELIT chaque salon IA dédié et on ré-enqueue tout message humain postérieur
 * au watermark (dernier message vu/traité) : crash ou kill pendant une demande
 * => la demande repart dès le retour. BullMQ reprend de son côté les jobs
 * déjà en file.
 */
@Injectable()
export class BootRecoveryService implements SpraxiumOnBoot {
  private readonly log = new Logger('BootRecovery');

  constructor(
    private readonly client: Client,
    private readonly prisma: PrismaService,
    private readonly assistant: AssistantService,
  ) {}

  onBoot(): void {
    // La gateway n'est pas prête au onBoot : on attend ClientReady.
    this.client.once(Events.ClientReady, () => {
      void this.recover().catch((error) => {
        this.log.warn(`Récupération ignorée : ${error instanceof Error ? error.message : String(error)}`);
      });
    });
  }

  private async recover(): Promise<void> {
    const guilds = [...this.client.guilds.cache.values()];
    let recovered = 0;
    for (const guild of guilds) {
      const channelId = await this.assistant.dedicatedChannelId(guild.id).catch(() => null);
      if (!channelId) continue;
      const channel = await this.client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased() || !('messages' in channel)) continue;

      const watermark = await this.prisma.channelWatermark.findUnique({
        where: { channelId },
      });

      const messages = await channel.messages.fetch({ limit: MAX_BACKFILL }).catch(() => null);
      if (!messages) continue;
      // Du plus ancien au plus récent, filtrés après le watermark.
      const candidates = [...messages.values()]
        .reverse()
        .filter((message) => !watermark || BigInt(message.id) > BigInt(watermark.lastMessageId))
        .filter((message) => {
          if (message.author.bot && !message.webhookId) return false;
          if (message.content.trim().length === 0) return false;
          const age = Date.now() - message.createdTimestamp;
          return age > 0 && age <= MAX_AGE_MS;
        });

      for (const message of candidates) {
        await this.assistant.enqueueMessage(message, false).catch(() => {});
        recovered++;
      }

      const newest = messages.first();
      if (newest) {
        await this.prisma.channelWatermark.upsert({
          where: { channelId },
          create: { channelId, lastMessageId: newest.id },
          update: { lastMessageId: newest.id },
        });
      }
      if (candidates.length > 0) {
        this.log.info(`${candidates.length} demande(s) manquante(s) ré-enqueue(ées) (salon ${channelId}).`);
      }
    }
    if (recovered === 0) this.log.info('Récupération boot : aucune demande manquée.');
  }
}
