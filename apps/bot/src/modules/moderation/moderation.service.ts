import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Client, type Guild, type GuildMember, type User } from 'discord.js';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { MemberSanctions } from './member-sanctions';
import { MessagePurge } from './message-purge';
import { ModCaseStore } from './mod-case.store';
import { buildModerationTools } from './moderation.tools';
import { RoleBackupStore } from './role-backup.store';
import type { CaseEntry } from './moderation.types';

export type { CaseEntry, ModAction } from './moderation.types';
export { MAX_TIMEOUT_MS } from './moderation.types';

/** Levée quand la commande est utilisée hors du salon de sanctions dédié (12✅). */
export class SanctionChannelException extends Error {
  readonly channelId: string;
  constructor(channelId: string) {
    super(`Sanctions are restricted to <#${channelId}>.`);
    this.channelId = channelId;
  }
}

/**
 * Modération d'un serveur. Orchestrateur : il enregistre le tool getCases,
 * garde le garde-fou du salon de sanctions et délègue le reste.
 *
 * Répartition : ModCaseStore (dossier des cases), MemberSanctions (échelle
 * des sanctions et hiérarchie), RoleBackupStore (sauvegarde et restauration
 * des rôles), MessagePurge (purge de messages), moderation.tools.ts (tool).
 * Les méthodes publiques gardent leur nom : l'agent et les autres modules
 * passent par ici.
 */
@Injectable()
export class ModerationService implements SpraxiumOnBoot {
  // Collaborateurs non injectables : champs de classe, jamais des paramètres de constructeur DI.
  private readonly caseStore: ModCaseStore;
  private readonly sanctions: MemberSanctions;
  private readonly roles: RoleBackupStore;
  private readonly purger: MessagePurge;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: GuildConfigService,
    private readonly client: Client,
  ) {
    this.caseStore = new ModCaseStore(this.prisma, this.audit);
    this.sanctions = new MemberSanctions(this.caseStore);
    this.roles = new RoleBackupStore(this.prisma, this.audit);
    this.purger = new MessagePurge(this.client, this.audit);
  }

  /** Enregistre getCases : l'agent répond à « qui a été ban ce mois-ci, par qui, pourquoi ». */
  onBoot(): void {
    const registry = getToolRegistry();
    for (const tool of buildModerationTools({ prisma: this.prisma })) registry.register(tool);
  }

  /** Les sanctions sont restreintes au salon dédié si configuré. */
  async assertSanctionChannel(guildId: string, channelId: string): Promise<void> {
    const config = await this.config.get(guildId);
    const restricted = config.moderation.sanctionChannelId;
    if (restricted && channelId !== restricted) throw new SanctionChannelException(restricted);
  }

  /** Hiérarchie : cible non-owner, modo au-dessus de la cible (sauf admin/owner), bot au-dessus de la cible. */
  assertHierarchy(moderator: GuildMember, target: GuildMember, me: GuildMember): void {
    this.sanctions.assertHierarchy(moderator, target, me);
  }

  async warn(guild: Guild, target: GuildMember, moderatorId: string, reason: string): Promise<CaseEntry> {
    return this.sanctions.warn(guild, target, moderatorId, reason);
  }

  async userWarnings(guildId: string, userId: string): Promise<CaseEntry[]> {
    return this.caseStore.userWarnings(guildId, userId);
  }

  async timeout(
    guild: Guild,
    target: GuildMember,
    moderatorId: string,
    durationMs: number,
    reason: string | null,
  ): Promise<CaseEntry> {
    return this.sanctions.timeout(guild, target, moderatorId, durationMs, reason);
  }

  async untimeout(guild: Guild, target: GuildMember, moderatorId: string, reason: string | null): Promise<CaseEntry> {
    return this.sanctions.untimeout(guild, target, moderatorId, reason);
  }

  async kick(guild: Guild, target: GuildMember, moderatorId: string, reason: string | null): Promise<CaseEntry> {
    return this.sanctions.kick(guild, target, moderatorId, reason);
  }

  async ban(
    guild: Guild,
    targetUser: User,
    moderatorId: string,
    reason: string | null,
    purgeMessages: boolean,
  ): Promise<CaseEntry> {
    return this.sanctions.ban(guild, targetUser, moderatorId, reason, purgeMessages);
  }

  async unban(guild: Guild, targetUserId: string, moderatorId: string, reason: string | null): Promise<void> {
    await this.sanctions.unban(guild, targetUserId, moderatorId, reason);
  }

  async caseById(guildId: string, caseId: number): Promise<CaseEntry | null> {
    return this.caseStore.caseById(guildId, caseId);
  }

  async cases(guildId: string, userId?: string): Promise<CaseEntry[]> {
    return this.caseStore.cases(guildId, userId);
  }

  async timeoutInfo(target: GuildMember): Promise<{ until: Date } | null> {
    return this.sanctions.timeoutInfo(target);
  }

  /** Purge jusqu'à `count` messages récents (≤ 14 jours — limite Discord), filtrés par user si fourni. */
  async purge(channelId: string, guildId: string, moderatorId: string, count: number, userId?: string): Promise<number> {
    return this.purger.purge(channelId, guildId, moderatorId, count, userId);
  }

  /** Dérank : snapshot des rôles en backup, puis retrait de tous les rôles attribuables. */
  async derank(member: GuildMember, moderatorId: string, reason: string | null): Promise<number> {
    return this.roles.derank(member, moderatorId, reason);
  }

  /** Restaure les rôles du dernier backup du membre. */
  async restoreRoles(member: GuildMember, moderatorId: string): Promise<number> {
    return this.roles.restoreRoles(member, moderatorId);
  }
}
