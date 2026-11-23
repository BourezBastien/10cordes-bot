import {
  HttpBody,
  HttpCtx,
  HttpController,
  HttpGet,
  HttpGuards,
  HttpParam,
  HttpPatch,
  HttpPost,
  HttpQuery,
  ValidationError,
} from '@spraxium/http';
import { PermissionFlagsBits, Client } from 'discord.js';
import { ZodError } from 'zod';
import type { Context } from 'hono';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { GuildModuleStateService } from '../module-manager/guild-module-state.service';
import { ModuleManagerService } from '../module-manager/module-manager.service';
import { WebAgentService } from '../assistant/web-agent.service';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildAccessGuard } from '../../auth/guards/guild-access.guard';

interface ModuleToggleBody {
  enabled: boolean;
  confirm?: boolean;
}

interface AgentChatBody {
  message: string;
}

function toValidationDetails(error: ZodError): Array<{ property: string; constraints: Record<string, string> }> {
  return error.issues.map((issue) => ({
    property: issue.path.join('.'),
    constraints: { message: issue.message },
  }));
}

@HttpController('/api/v1/guilds')
export class GuildsController {
  constructor(
    private readonly modules: ModuleManagerService,
    private readonly config: GuildConfigService,
    private readonly states: GuildModuleStateService,
    private readonly prisma: PrismaService,
    private readonly webAgent: WebAgentService,
    private readonly client: Client,
  ) {}

  /** Serveurs où le bot est présent ET où l'utilisateur peut gérer la configuration. */
  @HttpGet('/')
  @HttpGuards(SessionGuard)
  async list(@HttpCtx() ctx: Context): Promise<unknown> {
    const session = ctx.get('session');
    const userId = session.user.id;

    const guilds: Array<Record<string, unknown>> = [];
    for (const guild of this.client.guilds.cache.values()) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue;
      const canManage =
        member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        member.permissions.has(PermissionFlagsBits.Administrator);
      if (!canManage) continue;
      guilds.push({
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL(),
        memberCount: guild.memberCount,
        canManage,
      });
    }
    return { guilds };
  }

  @HttpGet('/:guildId')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async getGuild(@HttpParam('guildId') guildId: string): Promise<unknown> {
    const guild = this.client.guilds.cache.get(guildId);
    return {
      id: guildId,
      name: guild?.name ?? null,
      icon: guild?.iconURL() ?? null,
      memberCount: guild?.memberCount ?? null,
    };
  }

  @HttpGet('/:guildId/config')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async getConfig(@HttpParam('guildId') guildId: string): Promise<unknown> {
    return this.config.get(guildId);
  }

  /** Patch partiel de la configuration — revalidation Zod intégrale à l'écriture. */
  @HttpPatch('/:guildId/config')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async patchConfig(
    @HttpParam('guildId') guildId: string,
    @HttpBody() body: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.config.patch(guildId, body);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError(toValidationDetails(error));
      }
      throw error;
    }
  }

  /** Modules du serveur : état global/serveur + contraintes par module. */
  @HttpGet('/:guildId/modules')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async listModules(@HttpParam('guildId') guildId: string): Promise<unknown> {
    const modules = await this.modules.listModules(guildId);
    return Promise.all(
      modules.map(async (module) => ({
        ...module,
        constraints: await this.states.getConstraints(guildId, module.id),
      })),
    );
  }

  /** Toggle d'un module — même moteur de cascade que la commande /modules. */
  @HttpPatch('/:guildId/modules/:moduleId')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async toggleModule(
    @HttpParam('guildId') guildId: string,
    @HttpParam('moduleId') moduleId: string,
    @HttpBody() body: ModuleToggleBody,
  ): Promise<unknown> {
    if (body.enabled) {
      const enabled = await this.modules.enableModule(guildId, moduleId);
      return { applied: true, enabled };
    }
    return this.modules.disableModule(guildId, moduleId, body.confirm ?? false);
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

  /** Journal d'audit paginé (du plus récent). */
  @HttpGet('/:guildId/audit')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async listAudit(
    @HttpParam('guildId') guildId: string,
    @HttpQuery('page') pageRaw?: string,
  ): Promise<unknown> {
    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const pageSize = 25;
    const [entries, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { guildId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where: { guildId } }),
    ]);
    return { entries, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /** Mémoires persistantes : serveur + membres. */
  @HttpGet('/:guildId/memories')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async listMemories(@HttpParam('guildId') guildId: string): Promise<unknown> {
    const [guild, members] = await Promise.all([
      this.prisma.guildMemory.findMany({ where: { guildId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.memberMemory.findMany({ where: { guildId }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { guild, members };
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
   * permissions = celles du membre Discord lié au compte connecté.
   */
  @HttpPost('/:guildId/agent/chat')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async agentChat(
    @HttpParam('guildId') guildId: string,
    @HttpCtx() ctx: Context,
    @HttpBody() body: AgentChatBody,
  ): Promise<unknown> {
    const session = ctx.get('session');
    const account = await this.prisma.account.findFirst({
      where: { userId: session.user.id, providerId: 'discord' },
      select: { accountId: true },
    });
    const discordUserId = account?.accountId;
    if (!discordUserId) {
      throw new ValidationError([{ property: 'message', constraints: { message: "Compte Discord lié introuvable pour cette session." } }]);
    }
    try {
      return await this.webAgent.chat(guildId, discordUserId, String(body?.message ?? ''));
    } catch (error) {
      if (error instanceof Error && error.message.length < 200) {
        throw new ValidationError([{ property: 'message', constraints: { message: error.message } }]);
      }
      throw error;
    }
  }
}
