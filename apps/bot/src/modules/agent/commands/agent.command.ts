import {
  Ctx,
  SlashCommand,
  SlashCommandHandler,
  SlashOption,
  SlashStringOption,
  SlashSubcommand,
  SlashUserOption,
  UseGuards,
  withOptions,
} from '@spraxium/common';import { PermissionDeniedException, PermissionGuard, ValidationException } from '@spraxium/core';
import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type GuildMember, type User } from 'discord.js';
import { AgentPlanSchema, DESTRUCTIVE_OP_TYPES, opLabel, type AdminOp } from '@10cordes/shared';
import { AdminWhitelistService } from '../whitelist.service';
import { AgentService } from '../agent.service';
import { buildPlanReply } from '../agent.panel';
import { SetupCommand } from '../../setup/setup.schema';
import { panel } from '../../../shared/ui';

const ADMIN = withOptions(PermissionGuard, { permissions: ['Administrator'] });

@SlashCommandHandler(SetupCommand, { group: 'agent', sub: 'whitelist-add' })
export class AgentWhitelistAddHandler {
  constructor(private readonly whitelist: AdminWhitelistService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashUserOption('user') user: User | null,
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild || !user) return;
    if (guild.ownerId !== interaction.user.id) {
      throw new PermissionDeniedException({ permission: 'server owner' });
    }
    await this.whitelist.add(guild.id, user.id, interaction.user.id);
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Whitelist agent',
          lines: [`<@${user.id}> peut désormais valider les plans destructifs.`],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}

@SlashCommandHandler(SetupCommand, { group: 'agent', sub: 'whitelist-remove' })
export class AgentWhitelistRemoveHandler {
  constructor(private readonly whitelist: AdminWhitelistService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashUserOption('user') user: User | null,
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild || !user) return;
    if (guild.ownerId !== interaction.user.id) {
      throw new PermissionDeniedException({ permission: 'server owner' });
    }
    const removed = await this.whitelist.remove(guild.id, user.id);
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Whitelist agent',
          lines: [removed ? `<@${user.id}> retiré de la whitelist.` : `<@${user.id}> n'était pas sur la whitelist.`],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}

@SlashCommandHandler(SetupCommand, { group: 'agent', sub: 'whitelist' })
export class AgentWhitelistHandler {
  constructor(private readonly whitelist: AdminWhitelistService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;
    const users = await this.whitelist.list(guild.id);
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## 🔐 Whitelist des plans destructifs',
          lines: [
            `**Owner** (implicite) : <@${guild.ownerId}>`,
            `**Whitelist** : ${users.map((id) => `<@${id}>`).join(' ') || 'vide'}`,
          ],
        }),
      ],
    });
  }
}

@SlashCommandHandler(SetupCommand, { group: 'agent', sub: 'propose' })
@UseGuards(ADMIN)
export class AgentProposeHandler {
  constructor(private readonly agent: AgentService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('ops') raw: string,
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild || !interaction.channelId) return;

    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new ValidationException({ field: 'ops', reason: 'JSON invalide.' });
    }
    const parsed = AgentPlanSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationException({
        field: 'ops',
        reason: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Plan invalide.',
      });
    }

    // Le DEMANDEUR doit avoir les permissions Discord requises pour chaque op
    // proposée — un plan destructif exige Administrator côté demandeur.
    const member = interaction.member as GuildMember;
    const hasDestructive = parsed.data.ops.some((op: AdminOp) => DESTRUCTIVE_OP_TYPES.has(op.type));
    if (hasDestructive && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      throw new PermissionDeniedException({ permission: 'Administrator (plan destructif)' });
    }

    const plan = await this.agent.createPlan(guild.id, interaction.channelId, interaction.user.id, parsed.data);

    await interaction.reply({
      ...(await buildPlanReply({
        title: parsed.data.title,
        ops: parsed.data.ops,
        requesterId: interaction.user.id,
        expiresAt: plan.expiresAt,
        destructive: plan.destructiveOps.length > 0,
      })),
    });
  }
}

@SlashCommandHandler(SetupCommand, { group: 'agent', sub: 'plans' })
export class AgentPlansHandler {
  constructor(private readonly agent: AgentService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild || !interaction.channelId) return;
    const pending = await this.agent.latestPending(guild.id, interaction.channelId);
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## 🗂️ Plans en attente',
          lines: [
            pending
              ? 'Un plan est en attente dans ce salon — valide via les boutons du panneau.'
              : 'Aucun plan en attente ici.',
          ],
        }),
      ],
    });
  }
}
