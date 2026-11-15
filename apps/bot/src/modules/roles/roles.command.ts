import {
  Ctx,
  SlashCommand,
  SlashCommandHandler,
  SlashOption,
  SlashRoleOption,
  SlashSubcommand,
  UseGuards,
  withOptions,
} from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { StringSelect, StringSelectHandler } from '@spraxium/components';
import {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { panel } from '../../shared/ui';

const ADMIN = withOptions(PermissionGuard, { permissions: ['ManageGuild'] });
export const RR_SELECT_ID = 'rr:select';
const MAX_ROLES = 25;

@StringSelect({ customId: RR_SELECT_ID, placeholder: 'Choisis tes rôles' })
export class RRSelect {}

@SlashCommand({
  name: 'roles',
  description: 'Self-serve role menu — editable live.',
  defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  dmPermission: false,
})
export class RolesCommand {
  @SlashOption.Role('role', { description: 'Role offered in the menu', required: true })
  @SlashSubcommand({ name: 'add', description: 'Add a role to the menu options.' })
  add() {}

  @SlashOption.Role('role', { description: 'Role to remove', required: true })
  @SlashSubcommand({ name: 'remove', description: 'Remove a role from the menu options.' })
  remove() {}

  @SlashOption.Channel('channel', { description: 'Channel to post the role menu', required: true })
  @SlashSubcommand({ name: 'post', description: 'Post (or move) the role menu in a channel.' })
  post() {}

  @SlashSubcommand({ name: 'refresh', description: 'Edit the posted menu with the current options.' })
  refresh() {}

  @SlashSubcommand({ name: 'view', description: 'View the current role menu options.' })
  view() {}
}

interface MenuPayload {
  components: [ContainerBuilder, ActionRowBuilder<StringSelectMenuBuilder>];
}

async function buildMenu(config: GuildConfigService, guild: Guild): Promise<MenuPayload | null> {
  const guildConfig = await config.get(guild.id);
  if (guildConfig.roles.roleIds.length === 0) return null;

  const options = guildConfig.roles.roleIds
    .map((roleId) => {
      const role = guild.roles.cache.get(roleId);
      return role ? { label: role.name, value: roleId } : null;
    })
    .filter((option): option is { label: string; value: string } => option !== null)
    .slice(0, MAX_ROLES);
  if (options.length === 0) return null;

  const container = panel({
    title: `## ${guildConfig.roles.panelTitle}`,
    lines: ['Sélectionne tes rôles dans le menu — re-sélectionner retire le rôle.'],
    footer: "Menu éditable en live : /roles add|remove puis /roles refresh.",
  });
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(RR_SELECT_ID)
      .setPlaceholder('Choisis tes rôles')
      .addOptions(options),
  );
  return { components: [container, row] };
}

function panelTitleOnly(title: string): ContainerBuilder {
  return panel({ title: `## ${title}`, lines: ['Sélectionne tes rôles dans le menu.'] });
}

@SlashCommandHandler(RolesCommand, { sub: 'add' })
@UseGuards(ADMIN)
export class RolesAddHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashRoleOption('role') role: import('discord.js').Role | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId || !role) return;
    const guildConfig = await this.config.get(guildId);
    if (guildConfig.roles.roleIds.length >= MAX_ROLES) {
      throw new Error(`Maximum ${MAX_ROLES} rôles dans le menu.`);
    }
    if (!guildConfig.roles.roleIds.includes(role.id)) {
      await this.config.patch(guildId, { roles: { roleIds: [...guildConfig.roles.roleIds, role.id] } });
    }
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Rôle ajouté au menu',
          lines: [`<@&${role.id}> ajouté — ${guildConfig.roles.roleIds.length + 1} option(s).`, 'Utilise `/roles post` ou `/roles refresh`.'],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}

@SlashCommandHandler(RolesCommand, { sub: 'remove' })
@UseGuards(ADMIN)
export class RolesRemoveHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashRoleOption('role') role: import('discord.js').Role | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId || !role) return;
    const guildConfig = await this.config.get(guildId);
    const roleIds = guildConfig.roles.roleIds.filter((id) => id !== role.id);
    await this.config.patch(guildId, { roles: { roleIds } });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Rôle retiré du menu',
          lines: [`**${roleIds.length}** option(s) restante(s).`, 'Utilise `/roles refresh` pour mettre à jour le panneau posté.'],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}

@SlashCommandHandler(RolesCommand, { sub: 'post' })
@UseGuards(ADMIN)
export class RolesPostHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    const guildId = interaction.guildId;
    const channelId = interaction.options.getChannel('channel', false)?.id;
    if (!guild || !guildId || !channelId) return;

    const menu = await buildMenu(this.config, guild);
    if (!menu) {
      throw new Error('Ajoute au moins un rôle avec `/roles add` avant de poster le menu.');
    }

    const guildConfig = await this.config.get(guildId);
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || channel.partial) {
      throw new Error('Salon inaccessible.');
    }
    const message = await channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [...menu.components],
    });

    await this.config.patch(guildId, {
      roles: { panelChannelId: channel.id, panelMessageId: message.id },
    });

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Menu posté',
          lines: [`Voir <#${channel.id}> — édite les options puis \`/roles refresh\`.`],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}

@SlashCommandHandler(RolesCommand, { sub: 'refresh' })
@UseGuards(ADMIN)
export class RolesRefreshHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    const guildId = interaction.guildId;
    if (!guild || !guildId) return;
    const guildConfig = await this.config.get(guildId);
    if (!guildConfig.roles.panelChannelId || !guildConfig.roles.panelMessageId) {
      throw new Error("Aucun menu posté — utilise `/roles post` d'abord.");
    }

    const menu = await buildMenu(this.config, guild);
    const channel = await guild.channels.fetch(guildConfig.roles.panelChannelId).catch(() => null);
    if (!channel?.isTextBased() || channel.partial) {
      throw new Error('Salon du panneau inaccessible.');
    }

    await channel.messages.edit(guildConfig.roles.panelMessageId, {
      components: menu ? [...menu.components] : [panelTitleOnly(guildConfig.roles.panelTitle)],
    });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Menu actualisé',
          lines: [`${guildConfig.roles.roleIds.length} option(s) affichée(s).`],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}

@SlashCommandHandler(RolesCommand, { sub: 'view' })
@UseGuards(ADMIN)
export class RolesViewHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const guildConfig = await this.config.get(guildId);
    const lines = [
      `**Options** : ${guildConfig.roles.roleIds.map((id) => `<@&${id}>`).join(' ') || 'aucune'}`,
      `**Panneau** : ${guildConfig.roles.panelChannelId ? `<#${guildConfig.roles.panelChannelId}>` : 'non posté'}`,
    ];
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## 🎭 Reaction roles', lines })],
    });
  }
}

/** Toggle des rôles pour le membre qui utilise le menu (add si absent, remove si présent). */
@StringSelectHandler(RRSelect)
export class RRSelectHandler {
  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    const guild = interaction.guild;
    const member = interaction.member as GuildMember | null;
    if (!guild || !member) return;

    const toggled: string[] = [];
    const failed: string[] = [];
    for (const roleId of interaction.values) {
      const role = guild.roles.cache.get(roleId);
      if (!role || !role.editable) {
        failed.push(roleId);
        continue;
      }
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId).catch(() => failed.push(roleId));
        if (!failed.includes(roleId)) toggled.push(`➖ **${role.name}** retiré`);
      } else {
        await member.roles.add(roleId).catch(() => failed.push(roleId));
        if (!failed.includes(roleId)) toggled.push(`➕ **${role.name}** ajouté`);
      }
    }

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## 🎭 Rôles mis à jour',
          lines: [...toggled, ...(failed.length > 0 ? [`❌ Échec sur : ${failed.map((id) => `<@&${id}>`).join(' ')}`] : [])],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}
