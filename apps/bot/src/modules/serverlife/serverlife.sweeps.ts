import { Logger } from '@spraxium/logger';
import type { Client } from 'discord.js';
import type { PrismaService } from '../database/prisma.service';

/**
 * Tâches récurrentes de la vie de serveur : révocation des sanctions
 * temporaires échues et annonce des anniversaires du jour. Le service
 * décide QUAND les lancer (au boot, puis périodiquement), cette classe
 * exécute.
 */
export class ServerlifeSweeps {
  private readonly log = new Logger('Serverlife');
  private lastBirthdayDay = '';

  constructor(
    private readonly client: Client,
    private readonly prisma: PrismaService,
  ) {}

  /** Révoque les sanctions temporaires échues (timeout déjà géré par Discord). */
  async sweepTempSanctions(): Promise<void> {
    const due = await this.prisma.tempSanction.findMany({ where: { done: false, revokeAt: { lte: new Date() } } });
    for (const sanction of due) {
      try {
        const guild = this.client.guilds.cache.get(sanction.guildId);
        if (guild) {
          const member = await guild.members.fetch(sanction.userId).catch(() => null);
          if (sanction.type === 'ban') {
            await guild.members.unban(sanction.userId, 'sanction temporaire expirée').catch(() => {});
          } else if (sanction.type === 'kick') {
            // Gate de vérification : kick AT revokeAt (le timer a pu mourir avec un crash).
            const pendingMember = await guild.members.fetch(sanction.userId).catch(() => null);
            if (pendingMember) await pendingMember.kick('non vérifié à temps (gate de vérification)').catch(() => {});
          } else if (sanction.type === 'role' && member) {
            const payload = JSON.parse(sanction.payload || '{}') as { roleId?: string };
            if (payload.roleId) await member.roles.remove(payload.roleId, 'sanction temporaire expirée').catch(() => {});
          } else if (sanction.type === 'timeout' && member) {
            await member.timeout(null, 'sanction temporaire expirée').catch(() => {});
          }
        }
        await this.prisma.tempSanction.update({ where: { id: sanction.id }, data: { done: true } });
      } catch (error) {
        this.log.warn(`Révocation échouée (${sanction.type} ${sanction.userId}) : ${(error as Error).message.slice(0, 80)}`);
      }
    }
  }

  /** Annonce les anniversaires du jour dans le salon système (une fois par jour local). */
  async announceBirthdays(): Promise<void> {
    // Date LOCALE (fr-CA => YYYY-MM-DD) : toISOString découpait en UTC et
    // décalait les anniversaires selon le fuseau.
    const mmdd = new Date().toLocaleDateString('fr-CA').slice(5, 10);
    if (mmdd === this.lastBirthdayDay) return; // déjà annoncé aujourd'hui
    const today = await this.prisma.memberBirthday.findMany({ where: { date: mmdd } });
    this.lastBirthdayDay = mmdd;
    for (const birthday of today) {
      const guild = this.client.guilds.cache.get(birthday.guildId);
      const target = guild?.systemChannelId ?? null;
      if (!guild || !target) continue;
      const channel = guild.channels.cache.get(target);
      if (channel?.isTextBased()) {
        await channel
          .send({ content: `🎂 C'est l'anniversaire de <@${birthday.userId}> aujourd'hui ! Joyeux anniversaire.` })
          .catch(() => {});
      }
    }
  }
}
