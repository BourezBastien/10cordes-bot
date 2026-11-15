import { Ctx, SlashCommand, SlashCommandHandler, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { MODULE_CATALOG } from '../module-manager/module.catalog';
import { panel } from '../../shared/ui';

/** /help : vue d'ensemble des commandes et de l'agent IA (panneau V2). */
@SlashCommand({
  name: 'help',
  description: 'Aide : commandes, agent IA et capacités du bot.',
  dmPermission: false,
})
export class HelpCommand {}

@SlashCommandHandler(HelpCommand)
@UseGuards(withOptions(PermissionGuard, { permissions: ['ManageGuild'] }))
export class HelpHandler {
  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const moduleIds = MODULE_CATALOG.map((m) => `\`${m.id}\``).join(' · ');
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## 📖 Aide 10cordes',
          lines: [
            '### Commandes',
            '**`/setup`** — panneau de contrôle : modules, bienvenue, logs, tickets, rôles, levels, modération, config, agent IA.',
            '**`/lang`** — ta langue personnelle (fr/en, auto-détectée sinon).',
            '',
            '### Agent IA (langage naturel)',
            'Mentionne le bot, parle dans le salon dédié IA, ou réponds à ses messages : il agit avec ses tools (modules, config, salons, rôles, sanctions, purge, icônes PixelLab).',
            'Il vérifie tes permissions avant chaque action et propose une confirmation humaine pour le destructif.',
            '',
            '### Modules',
            moduleIds,
            '',
            '### Permissions',
            'Les tools sensibles exigent les permissions Discord correspondantes (ManageGuild, ManageChannels, ManageRoles, ModerateMembers, KickMembers, BanMembers, ManageGuildExpressions).',
          ],
          footer: 'Tout est configurable via /setup, en langage naturel, ou depuis le futur dashboard web.',
        }),
      ],
    });
  }
}
