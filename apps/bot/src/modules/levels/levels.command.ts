import { Ctx, SlashCommand, SlashCommandHandler, SlashOption, SlashUserOption, SlashSubcommand, UseGuards } from '@spraxium/common';
import { MessageFlags, type ChatInputCommandInteraction, type User } from 'discord.js';
import { xpForLevel } from './levels.service';
import { LevelsService } from './levels.service';
import { panel } from '../../shared/ui';

@SlashCommand({
  name: 'rank',
  description: "Show your level and XP (or another member's).",
  dmPermission: false,
})
export class RankCommand {
  @SlashOption.User('user', { description: 'Member to inspect', required: false })
  build() {}
}

@SlashCommand({ name: 'leaderboard', description: 'Top members by XP.', dmPermission: false })
export class LeaderboardCommand {
  build() {}
}

@SlashCommandHandler(RankCommand)
export class RankHandler {
  constructor(private readonly levels: LevelsService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashUserOption('user') user: User | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const target = user ?? interaction.user;

    const entry = await this.levels.get(guildId, target.id);
    const level = entry?.level ?? 0;
    const xp = entry?.xp ?? 0;
    const next = xpForLevel(level + 1);
    const remaining = Math.max(0, next - xp);

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: `## 📈 Niveau de ${target.username}`,
          lines: [
            `**Niveau** : ${level} · **XP** : ${xp}`,
            `Prochain niveau : **${remaining}** XP restants.`,
          ],
          footer: "Gagne de l'XP en discutant (si activé par le staff).",
        }),
      ],
    });
  }
}

@SlashCommandHandler(LeaderboardCommand)
export class LeaderboardHandler {
  constructor(private readonly levels: LevelsService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const top = await this.levels.leaderboard(guildId, 10);
    const lines =
      top.length > 0
        ? top.map((entry, index) => `**${index + 1}.** <@${entry.userId}> — niveau **${entry.level}** (${entry.xp} XP)`)
        : ['Aucun XP encore gagné sur ce serveur.'];

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## 🏆 Leaderboard', lines })],
    });
  }
}
