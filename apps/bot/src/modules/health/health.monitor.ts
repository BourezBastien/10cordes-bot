import { Injectable, type SpraxiumOnBoot, type SpraxiumOnShutdown } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client } from 'discord.js';
import { AssistantQueue } from '../assistant/assistant.queue';
import { AuditService } from '../audit/audit.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { notice } from '../../shared/ui';
import { PrismaService } from '../database/prisma.service';

const CHECK_INTERVAL_MS = 60_000;

/**
 * Surveillance continue, alerte uniquement SUR CHANGEMENT d'état :
 * - ok -> incident : un message d'alerte part dans le salon dédié IA (+ audit).
 * - incident -> ok : un message de rétablissement (avec la durée).
 * Rien ne s'affiche tant que tout va bien : pas de spam de sonde.
 */
@Injectable()
export class HealthMonitor implements SpraxiumOnBoot, SpraxiumOnShutdown {
  private readonly log = new Logger('HealthMonitor');
  private timer?: NodeJS.Timeout;
  private healthy = true;
  private incidentSince: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: AssistantQueue,
    private readonly config: GuildConfigService,
    private readonly audit: AuditService,
    private readonly client: Client,
  ) {}

  onBoot(): void {
    // Laisse le boot se terminer (gateway, queue) avant la première passe.
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  onShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async check(): Promise<void> {
    const [db, queueReachable] = await Promise.all([
      this.prisma
        .$queryRaw`SELECT 1`
        .then(() => true)
        .catch(() => false),
      this.queue
        .counts()
        .then(() => true)
        .catch(() => false),
    ]);
    const gatewayReady = this.client.isReady();
    const ok = db && queueReachable && gatewayReady;

    if (ok === this.healthy) return;
    this.healthy = ok;

    const causes = [
      db ? null : 'base de données',
      queueReachable ? null : 'file de traitement (Redis)',
      gatewayReady ? null : 'connexion gateway Discord',
    ].filter(Boolean);
    const now = new Date();

    if (!ok) {
      this.incidentSince = now;
      this.log.warn(`Incident : ${causes.join(', ')}`);
      await this.audit.record({
        source: 'system',
        action: 'monitor.incident',
        metadata: { causes },
      });
      await this.broadcast(
        `**Incident détecté** : ${causes.join(', ')}. Je continue de surveiller et je te préviens dès que c'est rétabli.`,
      );
      return;
    }
    const durationSec = this.incidentSince ? Math.round((now.getTime() - this.incidentSince.getTime()) / 1000) : null;
    this.incidentSince = null;
    this.log.info('Rétabli.');
    await this.audit.record({ source: 'system', action: 'monitor.recovered', metadata: { durationSec } });
    await this.broadcast(
      durationSec ? `**Rétabli** : tous les systèmes sont de nouveau opérationnels (durée de l'incident : ${durationSec}s).` : '**Rétabli** : tous les systèmes sont opérationnels.',
    );
  }

  /** Alerte dans le salon dédié IA de chaque serveur (sinon le premier salon texte). */
  private async broadcast(message: string): Promise<void> {
    for (const guild of this.client.guilds.cache.values()) {
      const guildConfig = await this.config.get(guild.id).catch(() => null);
      const channelId = guildConfig?.assistant.channelId ?? guild.channels.cache.find((c) => c.type === 0)?.id;
      if (!channelId) continue;
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) continue;
      await channel.send(notice(message)).catch(() => {});
    }
  }
}
