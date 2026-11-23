import type { Guild, GuildMember, User } from 'discord.js';
import { PermissionDeniedException, ValidationException } from '@spraxium/core';
import { guildAdminPolicy, guildAccessContext } from '../../core/security/access-policy';
import { memberPermissionPolicy } from '../../core/security/member-permission.policy';
import { MAX_TIMEOUT_MS, type CaseEntry } from './moderation.types';
import type { ModCaseStore } from './mod-case.store';

/**
 * Échelle des sanctions d'un membre : avertissement, timeout et sa levée,
 * kick, ban et unban. Chaque sanction trace une case dans le dossier.
 */
export class MemberSanctions {
  constructor(private readonly caseStore: ModCaseStore) {}

  /** Hiérarchie : cible non-owner, modo au-dessus de la cible (sauf admin/owner), bot au-dessus de la cible. */
  assertHierarchy(moderator: GuildMember, target: GuildMember, me: GuildMember): void {
    if (guildAdminPolicy.isOwner(guildAccessContext(target.guild, target.id, target))) {
      throw new PermissionDeniedException({ permission: 'server owner' });
    }
    const isModeratorOwner = guildAdminPolicy.isOwner(guildAccessContext(moderator.guild, moderator.id, moderator));
    const isModeratorAdmin = memberPermissionPolicy.isAdmin(moderator);
    if (!isModeratorOwner && !isModeratorAdmin && moderator.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
      throw new PermissionDeniedException({ permission: 'higher role than the target' });
    }
    if (me.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
      throw new PermissionDeniedException({ permission: 'bot role above the target' });
    }
  }

  async warn(guild: Guild, target: GuildMember, moderatorId: string, reason: string): Promise<CaseEntry> {
    const entry = await this.caseStore.createCase(guild.id, {
      userId: target.id,
      moderatorId,
      action: 'warn',
      reason,
    });
    await target.send(`⚠️ You were warned in **${guild.name}** (case #${entry.caseId}) : ${reason}`).catch(() => {});
    return entry;
  }

  async timeout(
    guild: Guild,
    target: GuildMember,
    moderatorId: string,
    durationMs: number,
    reason: string | null,
  ): Promise<CaseEntry> {
    if (durationMs < 1_000 || durationMs > MAX_TIMEOUT_MS) {
      throw new ValidationException({
        field: 'duration',
        reason: `Duration must be between 1s and 28 days (got ${durationMs}ms).`,
      });
    }
    const entry = await this.caseStore.createCase(guild.id, {
      userId: target.id,
      moderatorId,
      action: 'timeout',
      reason,
      durationMs,
    });
    await target.timeout(durationMs, reason ?? undefined);
    return entry;
  }

  async untimeout(guild: Guild, target: GuildMember, moderatorId: string, reason: string | null): Promise<CaseEntry> {
    const entry = await this.caseStore.createCase(guild.id, {
      userId: target.id,
      moderatorId,
      action: 'untimeout',
      reason,
    });
    await target.timeout(null, reason ?? undefined);
    return entry;
  }

  async kick(guild: Guild, target: GuildMember, moderatorId: string, reason: string | null): Promise<CaseEntry> {
    if (!target.kickable) {
      throw new PermissionDeniedException({ permission: 'kick this member (bot hierarchy)' });
    }
    const entry = await this.caseStore.createCase(guild.id, {
      userId: target.id,
      moderatorId,
      action: 'kick',
      reason,
    });
    await target
      .send(`👢 You were kicked from **${guild.name}** (case #${entry.caseId})${reason ? ` : ${reason}` : ''}`)
      .catch(() => {});
    await target.kick(reason ?? undefined);
    return entry;
  }

  async ban(
    guild: Guild,
    targetUser: User,
    moderatorId: string,
    reason: string | null,
    purgeMessages: boolean,
  ): Promise<CaseEntry> {
    const entry = await this.caseStore.createCase(guild.id, {
      userId: targetUser.id,
      moderatorId,
      action: 'ban',
      reason,
    });
    await targetUser
      .send(`⛔ You were banned from **${guild.name}** (case #${entry.caseId})${reason ? ` : ${reason}` : ''}`)
      .catch(() => {});
    await guild.members.ban(targetUser.id, {
      reason: `case #${entry.caseId}${reason ? ` : ${reason}` : ''}`,
      deleteMessageSeconds: purgeMessages ? 24 * 60 * 60 : 0,
    });
    return entry;
  }

  async unban(guild: Guild, targetUserId: string, moderatorId: string, reason: string | null): Promise<void> {
    await this.caseStore.createCase(guild.id, {
      userId: targetUserId,
      moderatorId,
      action: 'unban',
      reason,
    });
    await guild.members.unban(targetUserId, reason ?? undefined);
  }

  /** Timeout en cours du membre (null si aucun ou expiré). */
  async timeoutInfo(target: GuildMember): Promise<{ until: Date } | null> {
    const communication = target.communicationDisabledUntilTimestamp;
    if (!communication || communication <= Date.now()) return null;
    return { until: new Date(communication) };
  }
}
