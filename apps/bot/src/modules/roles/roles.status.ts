import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { makeStatusTool } from '../../shared/tools/status-tool';

/** Enregistre `roles.status` : l'agent peut rapporter l'état du menu de rôles. */
@Injectable()
export class RolesStatusService implements SpraxiumOnBoot {
  constructor(
    private readonly config: GuildConfigService,
    private readonly registry: ToolRegistryService,
  ) {}

  async onBoot(): Promise<void> {
    this.registry.register(
      makeStatusTool({
        name: 'roles.status',
        category: 'roles',
        description: 'Reaction roles menu setup on this server: offered roles and panel location.',
        summary: async (guildId) => {
          const c = await this.config.get(guildId);
          return [
            `**Titre** : ${c.roles.panelTitle}`,
            `**Rôles proposés** : ${c.roles.roleIds.map((id) => `<@&${id}>`).join(' ') || 'aucun'}`,
            `**Panneau** : ${c.roles.panelChannelId ? `<#${c.roles.panelChannelId}>` : 'non posté'}`,
            `**Message** : ${c.roles.panelMessageId ? 'posté' : 'absent'}`,
          ].join(' · ');
        },
      }),
    );
  }
}
