import {
  HttpBody,
  HttpController,
  HttpCtx,
  HttpGet,
  HttpGuards,
  HttpParam,
  HttpPatch,
  HttpPost,
  HttpQuery,
} from '@spraxium/http';
import { Client } from 'discord.js';
import type { Context } from 'hono';
import { discordIdOf } from '../../auth/discord-identity';
import { GuildAccessGuard, guildAccessOf } from '../../auth/guards/guild-access.guard';
import { SessionGuard, sessionOf } from '../../auth/guards/session.guard';
import { guildAccessContext, guildManagerPolicy } from '../../core/security/access-policy';
import { RequestProgressService } from '../assistant/request-progress.service';
import { WebAgentService } from '../assistant/web-agent.service';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { GuildModuleStateService } from '../module-manager/guild-module-state.service';
import { ModuleManagerService } from '../module-manager/module-manager.service';
import { domainToHttpError } from './domain-errors';
import { AgentChatSchema, ConfigPatchSchema, ModuleToggleSchema, auditKindOf, auditPageOf, auditWhere, webAgentRefusal } from './guilds.support';
import { notFoundHere, parseBody } from './http-errors';

const AUDIT_PAGE_SIZE = 25;

/**
 * Serveurs du dashboard : `/api/v1/guilds`. Chaque route d'un serveur passe par
 * `GuildAccessGuard`, qui relit à chaque requête l'appartenance et le droit de
 * gérer le serveur du membre Discord lié au compte connecté ; ce membre est
 * ensuite connu du handler par `guildAccessOf(ctx)`. Toute écriture venue du
 * dashboard est journalisée en son nom (`source: 'api'`).
 */
@HttpController('/api/v1/guilds')
export class GuildsController {
  constructor(
    private readonly modules: ModuleManagerService,
    private readonly config: GuildConfigService,
    private readonly states: GuildModuleStateService,
    private readonly prisma: PrismaService,
    private readonly webAgent: WebAgentService,
    private readonly client: Client,
    private readonly progress: RequestProgressService,
  ) {}

  /**
   * Serveurs où le bot est présent ET où l'utilisateur peut gérer la
   * configuration. Déclarée avec et sans barre finale : le routeur est strict,
   * et le dashboard demande `/api/v1/guilds`.
   */
  @HttpGet('')
  @HttpGet('/')
  @HttpGuards(SessionGuard)
  async list(@HttpCtx() ctx: Context): Promise<unknown> {
    // L'identifiant de la session est celui de better-auth, pas un snowflake
    // Discord : le snowflake est dans la table des comptes liés. Sans compte
    // lié, aucun serveur n'est listé.
    const session = await sessionOf(ctx);
    const discordUserId = session ? await discordIdOf(this.prisma, session.user.id) : null;
    if (!discordUserId) return { guilds: [] };

    const guilds: Array<Record<string, unknown>> = [];
    for (const guild of this.client.guilds.cache.values()) {
      const member = await guild.members.fetch(discordUserId).catch(() => null);
      if (!member) continue;
      if (!guildManagerPolicy.isAuthorized(guildAccessContext(guild, discordUserId, member))) continue;
      guilds.push({
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL(),
        memberCount: guild.memberCount,
        canManage: true,
      });
    }
    return { guilds };
  }

  @HttpGet('/:guildId')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async getGuild(@HttpParam('guildId') guildId: string): Promise<unknown> {
    const guild = this.client.guilds.cache.get(guildId) ?? (await this.client.guilds.fetch(guildId).catch(() => null));
    if (!guild) throw notFoundHere();
    return {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL(),
      memberCount: guild.memberCount,
    };
  }

  @HttpGet('/:guildId/config')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async getConfig(@HttpParam('guildId') guildId: string): Promise<unknown> {
    return this.config.get(guildId);
  }

  /** Patch partiel de la configuration : revalidation Zod intégrale à l'écriture, journalisée au nom de l'auteur. */
  @HttpPatch('/:guildId/config')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async patchConfig(@HttpParam('guildId') guildId: string, @HttpCtx() ctx: Context, @HttpBody() body: unknown): Promise<unknown> {
    const { discordUserId } = guildAccessOf(ctx);
    const patch = parseBody(ConfigPatchSchema, body);
    try {
      return await this.config.patch(guildId, patch, discordUserId, 'api');
    } catch (error) {
      throw domainToHttpError(error);
    }
  }

  /** Modules du serveur : état global/serveur + contraintes par module. */
  @HttpGet('/:guildId/modules')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async listModules(@HttpParam('guildId') guildId: string): Promise<unknown> {
    const modules = await Promise.all(
      (await this.modules.listModules(guildId)).map(async (module) => ({
        ...module,
        constraints: await this.states.getConstraints(guildId, module.id),
      })),
    );
    return { modules };
  }

  /** Bascule d'un module : même moteur de cascade que les outils de l'agent ; un module inconnu est un 404. */
  @HttpPatch('/:guildId/modules/:moduleId')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async toggleModule(
    @HttpParam('guildId') guildId: string,
    @HttpParam('moduleId') moduleId: string,
    @HttpCtx() ctx: Context,
    @HttpBody() body: unknown,
  ): Promise<unknown> {
    const { discordUserId } = guildAccessOf(ctx);
    const { enabled, confirm } = parseBody(ModuleToggleSchema, body);
    if (!this.modules.find(moduleId)) throw notFoundHere();
    try {
      if (enabled) return { applied: true, enabled: await this.modules.enableModule(guildId, moduleId, discordUserId, 'api') };
      return await this.modules.disableModule(guildId, moduleId, confirm ?? false, discordUserId, 'api');
    } catch (error) {
      throw domainToHttpError(error);
    }
  }

  /** Salons du serveur : inputs channel de l'éditeur de config. */
  @HttpGet('/:guildId/channels')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async listChannels(@HttpParam('guildId') guildId: string): Promise<unknown> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return { channels: [] };
    const channels = guild.channels.cache
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        category: channel.parentId ?? null,
        position: 'position' in channel ? channel.position : 0,
      }))
      .sort((a, b) => a.position - b.position)
      .map(({ position: _position, ...channel }) => channel);
    return { channels };
  }

  /** Rôles du serveur hors gérés (bot/intégrations), triés par position décroissante. */
  @HttpGet('/:guildId/roles')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async listRoles(@HttpParam('guildId') guildId: string): Promise<unknown> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return { roles: [] };
    const roles = guild.roles.cache
      .filter((role) => !role.managed)
      .sorted((a, b) => b.position - a.position)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
      }));
    return { roles };
  }

  /**
   * Journal d'audit paginé (du plus récent). `kind` le limite à une famille :
   * `actions` (tout, sauf les plans et les erreurs), `plans` ou `errors`.
   */
  @HttpGet('/:guildId/audit')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async listAudit(
    @HttpParam('guildId') guildId: string,
    @HttpQuery('page') pageRaw?: string,
    @HttpQuery('kind') kindRaw?: string,
  ): Promise<unknown> {
    const page = auditPageOf(pageRaw);
    const where = auditWhere(guildId, auditKindOf(kindRaw));
    const [entries, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * AUDIT_PAGE_SIZE,
        take: AUDIT_PAGE_SIZE,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { entries, page, pageSize: AUDIT_PAGE_SIZE, total, pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) };
  }

  /** Mémoires persistantes : serveur + membres, et les corrections (elles priment ; le journal garde ses entrées périmées, marquées). */
  @HttpGet('/:guildId/memories')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async listMemories(@HttpParam('guildId') guildId: string): Promise<unknown> {
    const [guild, members, corrections] = await Promise.all([
      this.prisma.guildMemory.findMany({ where: { guildId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.memberMemory.findMany({ where: { guildId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.memoryCorrection.findMany({ where: { guildId }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { guild, members, corrections };
  }

  /** Statistiques : audit par jour, top XP, cases modération par action. */
  @HttpGet('/:guildId/stats')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async stats(@HttpParam('guildId') guildId: string): Promise<unknown> {
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1_000);

    const auditRows = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: { guildId, createdAt: { gte: since } },
      _count: { action: true },
    });

    const [cases, casesByAction] = await Promise.all([
      this.prisma.modCase.count({ where: { guildId, createdAt: { gte: since } } }),
      this.prisma.modCase.groupBy({
        by: ['action'],
        where: { guildId, createdAt: { gte: since } },
        _count: { action: true },
      }),
    ]);
    // Levels purgés (moteur générique) : topXp gardé vide pour la compat dashboard.
    const topXp: Array<{ userId: string; level: number; xp: number }> = [];

    return {
      windowDays: 14,
      auditByAction: auditRows.map((row) => ({ action: row.action, count: row._count.action })),
      topXp,
      moderation: { cases14d: cases, byAction: casesByAction.map((row) => ({ action: row.action, count: row._count.action })) },
    };
  }

  /**
   * Chat avec l'agent depuis le dashboard : mêmes tools et gates que Discord,
   * permissions = celles du membre Discord lié au compte connecté (celui que la
   * garde vient de vérifier). Un refus du service répond 429 (cadence) ou 400.
   * Avec `requestId`, le panel suit les étapes de sa demande pendant qu'elle
   * tourne (`agent/requests/:requestId`).
   */
  @HttpPost('/:guildId/agent/chat')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async agentChat(@HttpParam('guildId') guildId: string, @HttpCtx() ctx: Context, @HttpBody() body: unknown): Promise<unknown> {
    const { discordUserId } = guildAccessOf(ctx);
    const { message, requestId } = parseBody(AgentChatSchema, body);
    try {
      return await this.webAgent.chat(guildId, discordUserId, message, requestId);
    } catch (error) {
      throw webAgentRefusal(error) ?? domainToHttpError(error);
    }
  }

  /**
   * Étapes d'une demande de l'agent lancée depuis le dashboard : les outils
   * appelés, réussis ou non, et l'état de la demande. Une demande d'un AUTRE
   * serveur répond 404, comme une demande inconnue.
   */
  @HttpGet('/:guildId/agent/requests/:requestId')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async requestProgress(@HttpParam('guildId') guildId: string, @HttpParam('requestId') requestId: string): Promise<unknown> {
    const progress = this.progress.read(guildId, requestId);
    if (!progress) throw notFoundHere();
    return progress;
  }
}
