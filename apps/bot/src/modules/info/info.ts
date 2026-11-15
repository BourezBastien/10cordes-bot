import { Ctx, SlashCommand, SlashCommandHandler } from '@spraxium/common';
import { I18nService } from '@spraxium/i18n';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { ModuleManagerService } from '../module-manager/module-manager.service';
import { panel } from '../../shared/ui';

@SlashCommand({ name: 'info', description: 'Bot status — uptime, latency, modules.' })
export class InfoCommand {
  build() {}
}

@SlashCommandHandler(InfoCommand)
export class InfoHandler {
  constructor(
    private readonly i18n: I18nService,
    private readonly modules: ModuleManagerService,
  ) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const guildId = interaction.guildId ?? undefined;
    const t = (key: string, vars?: Record<string, string | number>) =>
      this.i18n.tUser(userId, key, vars, guildId);

    const uptimeSeconds = Math.floor(process.uptime());
    const uptime = `${Math.floor(uptimeSeconds / 3_600)}h ${Math.floor((uptimeSeconds % 3_600) / 60)}m`;
    const modules = await this.modules.listModules(guildId ?? null);
    const active = modules.filter((module) => module.globalEnabled).length;

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: await t('info.title'),
          lines: [
            await t('info.uptime', { uptime }),
            await t('info.ping', { ping: interaction.client.ws.ping }),
            await t('info.guilds', { guilds: interaction.client.guilds.cache.size }),
            await t('info.modules', { active, total: modules.length }),
          ],
          footer: await t('info.footer'),
        }),
      ],
    });
  }
}
