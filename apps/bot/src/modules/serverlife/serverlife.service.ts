import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client, type Guild, type Message } from 'discord.js';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { ServerlifeStore } from './serverlife.store';
import { ServerlifeSweeps } from './serverlife.sweeps';
import { buildServerlifeTools } from './serverlife.tools';

/**
 * Vie de serveur : petits tools à haute valeur, tous permission-gated.
 * - snipe : derniers messages supprimés/édités (cache mémoire, staff-only)
 * - AFK : statut par membre, réponse auto à la mention
 * - anniversaires : table + annonce quotidienne au sweep du boot
 * - sticky roles : rôles ré-attribués au retour d'un membre
 * - lockdown/dehoist : outils anti-raid d'urgence
 * - voice.activity : lance les activités Discord officielles (chess, poker...)
 * - sanctions temporaires : tempmute/tempban/temprole auto-révoqués (sweep boot)
 * - trust score : dérivé des cases de modération avec décroissance (jamais stocké :
 *   calculé depuis les cases = idempotent par construction)
 * - activité membre : comptage messages/minutes vocal → rank/top
 *
 * Répartition : ServerlifeStore (état volatile : snipe, lockdown, compteur
 * d'activité), ServerlifeSweeps (tâches récurrentes), serverlife*.tools.ts
 * (tools de l'agent), activity-stats.ts (statistiques d'activité en SQL agrégé).
 */
@Injectable()
export class ServerlifeService implements SpraxiumOnBoot {
  private readonly log = new Logger('Serverlife');
  private flushTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  // Collaborateurs non injectables : champs de classe, jamais des paramètres de constructeur DI.
  private readonly store: ServerlifeStore;
  private readonly sweeps: ServerlifeSweeps;

  constructor(
    private readonly client: Client,
    private readonly prisma: PrismaService,
    private readonly config: GuildConfigService,
  ) {
    this.store = new ServerlifeStore(prisma);
    this.sweeps = new ServerlifeSweeps(client, prisma);
  }

  onBoot(): void {
    const tools = buildServerlifeTools({
      client: this.client,
      prisma: this.prisma,
      store: this.store,
      guildOf: (ctx) => this.guildOf(ctx),
    });
    for (const tool of tools) getToolRegistry().register(tool);
    this.log.info(`${tools.length} tools vie de serveur enregistrés.`);
    void this.sweeps.sweepTempSanctions();
    void this.sweeps.announceBirthdays();
    // Flush périodique du buffer d'activité (60s).
    this.flushTimer = setInterval(() => void this.store.flushActivity(), 60_000);
    this.flushTimer.unref?.();
    // Sweeps périodiques (bug fix : ils ne tournaient qu'au BOOT — une
    // sanction expirée pendant l'uptime n'était révoquée qu'au restart, et
    // les anniversaires n'étaient annoncés que si le bot redémarrant le
    // jour J).
    this.sweepTimer = setInterval(() => {
      void this.sweeps.sweepTempSanctions();
      void this.sweeps.announceBirthdays();
    }, 5 * 60_000);
    this.sweepTimer.unref?.();
  }

  // ── Entrées des listeners ──────────────────────────────────

  /** Capture un message supprimé/édité pour le tool snipe (ring buffer 25/salon). */
  captureSnipe(message: Message, action: 'deleted' | 'edited', newContent?: string): void {
    this.store.captureSnipe(message, action, newContent);
  }

  /** Incrémente le compteur de messages (buffer mémoire, flush 60s). */
  countMessage(guildId: string, userId: string): void {
    this.store.countMessage(guildId, userId);
  }

  // ── Helpers ─────────────────────────────────────────────────

  /** Serveur de la demande, depuis le cache du client (null hors serveur). */
  private guildOf(ctx: { guildId: string | null }): Guild | null {
    return ctx.guildId ? (this.client.guilds.cache.get(ctx.guildId) ?? null) : null;
  }
}
