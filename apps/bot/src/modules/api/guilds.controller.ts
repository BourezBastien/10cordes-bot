import {
  HttpBody,
  HttpCtx,
  HttpController,
  HttpGet,
  HttpGuards,
  HttpParam,
  HttpPatch,
  ValidationError,
} from '@spraxium/http';
import { PermissionFlagsBits, Client } from 'discord.js';
import { ZodError } from 'zod';
import type { Context } from 'hono';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { GuildModuleStateService } from '../module-manager/guild-module-state.service';
import { ModuleManagerService } from '../module-manager/module-manager.service';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildAccessGuard } from '../../auth/guards/guild-access.guard';

interface ModuleToggleBody {
  enabled: boolean;
  confirm?: boolean;
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
      const enabled = await this.modules.enableModule('guild', guildId, moduleId);
      return { applied: true, enabled };
    }
    return this.modules.disableModule('guild', guildId, moduleId, body.confirm ?? false);
  }
}
