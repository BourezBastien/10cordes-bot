import {
  Ctx,
  SlashCommand,
  SlashCommandHandler,
  SlashIntegerOption,
  SlashOption,
  SlashStringOption,
  SlashSubcommand,
  UseGuards,
  withOptions,
} from '@spraxium/common';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { PermissionGuard } from '@spraxium/core';
import { AuditService } from './audit.service';
import { SetupCommand } from '../setup/setup.schema';
import { panel } from '../../shared/ui';
import type { ChatInputCommandInteraction } from 'discord.js';

const SOURCE_CHOICES = [
  { name: 'discord', value: 'discord' },
  { name: 'api', value: 'api' },
  { name: 'agent', value: 'agent' },
  { name: 'system', value: 'system' },
];

@SlashCommandHandler(SetupCommand, { group: 'audit', sub: 'recent' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class AuditRecentHandler {
  constructor(private readonly audit: AuditService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('source') source: string | null,
    @SlashIntegerOption('limit') limit: number | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const entries = await this.audit.recent(guildId, {
      source: source ?? undefined,
      limit: limit ?? 10,
    });
    const lines =
      entries.length > 0
        ? entries.map((entry) => {
            const when = entry.createdAt.toISOString().slice(0, 16).replace('T', ' ');
            const actor = entry.actorId ? ` · <@${entry.actorId}>` : '';
            const target = entry.targetId ? ` → \`${entry.targetId}\`` : '';
            return `\`${when}\` **${entry.action}** · ${entry.source}${actor}${target}`;
          })
        : ["Aucune entrée d'audit."];

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## 📜 Audit récent',
          lines,
          footer: `Source : ${source ?? 'toutes'} — /audit stats pour les compteurs`,
        }),
      ],
    });
  }
}

@SlashCommandHandler(SetupCommand, { group: 'audit', sub: 'stats' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class AuditStatsHandler {
  constructor(private readonly audit: AuditService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('source') source: string | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;

    void source;
    const stats = await this.audit.stats(guildId);
    const lines =
      stats.length > 0
        ? stats.map((row) => `**${row.action}** — ${row.count}`)
        : ["Aucune entrée d'audit."];

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## 📊 Audit par action', lines })],
    });
  }
}
