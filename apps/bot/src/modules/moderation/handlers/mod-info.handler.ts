import { Ctx, SlashCommandHandler, SlashIntegerOption, UseGuards } from '@spraxium/common';
import { MessageFlags, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import { ModerationService } from '../moderation.service';
import { caseLine, casePanel, PERMS, targetMember } from './mod-shared';
import { panel } from '../../../shared/ui';
import { SetupCommand } from '../../setup/setup.schema';

@UseGuards(PERMS.view)
export class ModWarningsHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const target = targetMember(interaction);
    if (!guildId || !target) return;

    const warnings = await this.mod.userWarnings(guildId, target.id);
    const lines =
      warnings.length > 0
        ? warnings.map((entry) => caseLine(entry))
        : ["Aucun avertissement pour ce membre."];

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: `## ⚠️ Avertissements — ${target.user.username}`, lines })],
    });
  }
}

@UseGuards(PERMS.view)
export class ModCaseHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashIntegerOption('case') caseId: number | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId || caseId === null) return;

    const entry = await this.mod.caseById(guildId, caseId);
    if (!entry) {
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [panel({ title: '## ❌ Case introuvable', lines: [`Aucune case **#${caseId}** sur ce serveur.`], accentColor: 0xe8_8b_94 })],
      });
      return;
    }

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [casePanel(entry, `## 📁 Case #${entry.caseId}`)],
    });
  }
}

@UseGuards(PERMS.view)
export class ModCasesHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const filter = interaction.options.getUser('user', false)?.id;

    const entries = await this.mod.cases(guildId, filter);
    const lines =
      entries.length > 0
        ? entries.map((entry) => caseLine(entry))
        : ['Aucune case de modération.'];

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: filter ? `## 📁 Cases — <@${filter}>` : '## 📁 Cases récentes',
          lines,
          footer: "25 cases max — filtre par membre avec l'option user.",
        }),
      ],
    });
  }
}

@UseGuards(PERMS.view)
export class ModBanInfoHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const target = targetMember(interaction);
    if (!guildId || !target) return;

    const bans = await this.mod.cases(guildId, target.id);
    const banCases = bans.filter((entry) => entry.action === 'ban' || entry.action === 'unban');
    const lines =
      banCases.length > 0
        ? banCases.map((entry) => caseLine(entry))
        : ['Aucun ban/unban enregistré pour ce membre.'];

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## ⛔ Historique de bans', lines })],
    });
  }
}

@UseGuards(PERMS.view)
export class ModMuteInfoHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const target = targetMember(interaction);
    if (!target) return;

    const info = await this.mod.timeoutInfo(target);
    const lines = info
      ? [`**En timeout** jusqu'à <t:${Math.floor(info.until.getTime() / 1000)}:f> (<t:${Math.floor(info.until.getTime() / 1000)}:R>)`]
      : ["Ce membre n'est pas en timeout."];

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## 🔇 Statut timeout', lines })],
    });
  }
}
