import { withOptions } from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { MessageFlags, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import { SanctionChannelException, type CaseEntry, type ModerationService } from '../moderation.service';
import { panel } from '../../../shared/ui';

export const PERMS = {
  warn: withOptions(PermissionGuard, { permissions: ['ModerateMembers'] }),
  timeout: withOptions(PermissionGuard, { permissions: ['ModerateMembers'] }),
  kick: withOptions(PermissionGuard, { permissions: ['KickMembers'] }),
  ban: withOptions(PermissionGuard, { permissions: ['BanMembers'] }),
  purge: withOptions(PermissionGuard, { permissions: ['ManageMessages'] }),
  roles: withOptions(PermissionGuard, { permissions: ['ManageRoles'] }),
  view: withOptions(PermissionGuard, { permissions: ['ModerateMembers'] }),
};

/** Refuse (réponse éphémère) puis throw si la commande sort du salon de sanctions dédié. */
export async function ensureSanctionChannel(
  mod: ModerationService,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;
  try {
    await mod.assertSanctionChannel(guildId, interaction.channelId);
  } catch (error) {
    if (error instanceof SanctionChannelException) {
      await interaction
        .reply({
          flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
          components: [
            panel({ title: '## 🚫 Salon de sanctions obligatoire', lines: [error.message], accentColor: 0xe8_8b_94 }),
          ],
        })
        .catch(() => {});
    }
    throw error;
  }
}

export function targetMember(interaction: ChatInputCommandInteraction): GuildMember | null {
  return (interaction.options.getMember('user') as GuildMember | null) ?? null;
}

export function caseLine(entry: CaseEntry): string {
  const when = entry.createdAt.toISOString().slice(0, 16).replace('T', ' ');
  const duration = entry.durationMs ? ` · ${Math.round(entry.durationMs / 60_000)}min` : '';
  return `**#${entry.caseId}** \`${entry.action}\`${duration} : <@${entry.userId}> par <@${entry.moderatorId}> : ${entry.reason ?? 'sans raison'} (\`${when}\`)`;
}

export function casePanel(entry: CaseEntry, title: string) {
  return panel({
    title,
    lines: [
      `**Case #${entry.caseId}** : \`${entry.action}\``,
      `**Membre** : <@${entry.userId}> · **Modérateur** : <@${entry.moderatorId}>`,
      entry.durationMs ? `**Durée** : ${Math.round(entry.durationMs / 60_000)} min` : '',
      `**Raison** : ${entry.reason ?? '(aucune)'}`,
      `**Date** : <t:${Math.floor(entry.createdAt.getTime() / 1000)}:f>`,
    ].filter(Boolean),
  });
}
