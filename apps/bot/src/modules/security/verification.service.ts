import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { randomInt } from 'node:crypto';
import { Client, PermissionFlagsBits, type GuildMember } from 'discord.js';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';

/**
 * État du gate de vérification : défi mathématique par membre (3 boutons
 * réponse, le bon index n'existe que côté serveur), timer de kick en mémoire
 * ET sanction kick planifiée en DB (TempSanction type='kick') pour survivre
 * aux redémarrages (sweep serverlife).
 */

interface PendingVerification {
  guildId: string;
  correctIndex: number;
  labels: [string, string, string];
  timer: NodeJS.Timeout;
  verified: boolean;
}

@Injectable()
export class VerificationService {
  private readonly log = new Logger('Security');
  private readonly pending = new Map<string, PendingVerification>();

  constructor(
    private readonly client: Client,
    private readonly prisma: PrismaService,
    private readonly config: GuildConfigService,
  ) {}

  isPending(userId: string): PendingVerification | undefined {
    const pending = this.pending.get(userId);
    return pending && !pending.verified ? pending : undefined;
  }

  /** Programmate le kick (DB + timer mémoire) d'un membre non vérifié. */
  async scheduleKick(member: GuildMember, minutes: number): Promise<void> {
    const revokeAt = new Date(Date.now() + minutes * 60_000);
    await this.prisma.tempSanction.create({
      data: { guildId: member.guild.id, userId: member.id, type: 'kick', revokeAt, createdBy: this.client.user?.id ?? 'security' },
    });
    const timer = setTimeout(() => {
      void this.kickIfPending(member.guild.id, member.id);
    }, minutes * 60_000);
    timer.unref?.();
  }

  /** Kick uniquement si toujours non vérifié (appelé par timer ou sweep). */
  async kickIfPending(guildId: string, userId: string): Promise<void> {
    const pending = this.pending.get(userId);
    if (pending?.verified) return;
    const undone = await this.prisma.tempSanction.findFirst({
      where: { guildId, userId, type: 'kick', done: false },
    });
    if (!undone) return;
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      await member.kick('non vérifié à temps (gate de vérification)').catch(() => {});
      this.log.warn(`Kick non vérifié : ${userId} sur ${guildId}`);
    }
    await this.prisma.tempSanction.update({ where: { id: undone.id }, data: { done: true } });
    this.pending.delete(userId);
  }

  /** Génère le défi (a + b, 3 choix mélangés) pour un membre. randomInt crypto. */
  createChallenge(userId: string, guildId: string, kickMinutes: number): { question: string; labels: [string, string, string] } {
    const a = randomInt(2, 15);
    const b = randomInt(2, 15);
    const correct = a + b;
    const labels = new Set<number>([correct]);
    while (labels.size < 3) {
      const offset = randomInt(1, 5) * (randomInt(0, 2) === 0 ? -1 : 1);
      labels.add(Math.max(1, correct + offset));
    }
    const shuffled = [...labels].sort(() => randomInt(0, 2) - 0.5);
    const correctIndex = shuffled.indexOf(correct);
    const timer = setTimeout(() => {
      void this.kickIfPending(guildId, userId);
    }, Math.max(60_000, kickMinutes * 60_000));
    timer.unref?.();
    this.pending.set(userId, { guildId, correctIndex, labels: shuffled.map(String) as [string, string, string], timer, verified: false });
    return { question: `${a} + ${b}`, labels: shuffled.map(String) as [string, string, string] };
  }

  /** Vérifie la réponse : rôle + annulation du kick. */
  async answer(userId: string, choiceIndex: number): Promise<boolean> {
    const pending = this.pending.get(userId);
    if (!pending || pending.verified) return false;
    if (choiceIndex !== pending.correctIndex) return false;
    pending.verified = true;
    clearTimeout(pending.timer);
    const guild = this.client.guilds.cache.get(pending.guildId);
    const config = guild ? await this.config.get(guild.id).catch(() => null) : null;
    const roleId = config?.security.verifiedRoleId ?? null;
    if (guild && roleId) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) {
        const role = guild.roles.cache.get(roleId);
        if (role && guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          await member.roles.add(role, 'vérifié (gate anti-raid)').catch(() => {});
        }
      }
    }
    await this.prisma.tempSanction.updateMany({
      where: { guildId: pending.guildId, userId, type: 'kick', done: false },
      data: { done: true },
    });
    this.pending.delete(userId);
    return true;
  }
}
