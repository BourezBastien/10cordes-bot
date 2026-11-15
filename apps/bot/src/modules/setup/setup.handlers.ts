import { Ctx, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { ButtonHandler, ChannelSelectHandler, ModalHandler, ModalService, ModalTextField, RoleSelectHandler, StringSelectHandler } from '@spraxium/components';
import { MessageFlags } from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuInteraction,
  ContainerBuilder,
  RoleSelectMenuInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { CONFIG_KEYS, type GuildConfig } from '@10cordes/shared';
import { setPath } from '../../shared/utils/object';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { ImagelabService } from '../imagelab/imagelab.service';
import { LlmService } from '../assistant/llm.service';
import { ModuleManagerService } from '../module-manager/module-manager.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { buildCategorySelect, renderCategoryPanel, renderMainPanel, type CategoryId } from './setup.panel';
import { panel, text } from '../../shared/ui';
import { SetupPanelButton } from './setup.components';
import { RR_SELECT_ID } from '../roles/roles.command';
import {
  SetupAssistantClear,
  SetupBackButton,
  SetupCategorySelect,
  SetupConfigKeySelect,
  SetupConfigValueModal,
  SetupLanguageSelect,
  SetupLevelsChannelSelect,
  SetupLevelsToggle,
  SetupLogsCatSelect,
  SetupLogsChannelSelect,
  SetupModChannelSelect,
  SetupModDerank,
  SetupModulesDisable,
  SetupModulesEnable,
  SetupModulesPick,
  SetupRolesAddSelect,
  SetupRolesChannelSelect,
  SetupRolesPost,
  SetupRolesRefresh,
  SetupTicketsCategorySelect,
  SetupTicketsLogsSelect,
  SetupTicketsPanelSelect,
  SetupTicketsPost,
  SetupTicketsStaffSelect,
  SetupWelcomeAutoroleSelect,
  SetupWelcomeChannelSelect,
  SetupWelcomeDeleteLeave,
  SetupWelcomeToggle,
} from './setup.components';

const STAFF = withOptions(PermissionGuard, { permissions: ['ManageGuild'] });

/** État intermédiaire par utilisateur (catégorie courante, choix en 2 temps). */
const PENDING = new Map<string, string>();
const LAST_CATEGORY = new Map<string, string>();

type DashboardInteraction = StringSelectMenuInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction | ButtonInteraction;
type AnyDashboardInteraction = DashboardInteraction | ModalSubmitInteraction;

/**
 * Base des handlers du dashboard : re-rendu de la catégorie courante après
 * chaque mutation (les selects/boutons mettent la config puis redessinent).
 */
abstract class DashboardBase {
  constructor(
    protected readonly configService: GuildConfigService,
    protected readonly llm: LlmService,
    protected readonly imagelab: ImagelabService,
    protected readonly modules: ModuleManagerService,
  ) {}

  protected key(interaction: AnyDashboardInteraction): string {
    return `${interaction.guildId}:${interaction.user.id}`;
  }

  protected async renderCategory(interaction: AnyDashboardInteraction, category: CategoryId): Promise<void> {
    LAST_CATEGORY.set(this.key(interaction), category);
    const guildConfig = await this.configService.get(interaction.guildId!);
    const { container, rows } = renderCategoryPanel(
      category,
      guildConfig,
      this.llm.status(),
      this.imagelab.configured,
      PENDING.get(this.key(interaction)),
    );
    await (interaction as StringSelectMenuInteraction).update({
      components: [container, ...rows],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  protected async renderMain(interaction: AnyDashboardInteraction): Promise<void> {
    LAST_CATEGORY.delete(this.key(interaction));
    const guildConfig = await this.configService.get(interaction.guildId!);
    const container = renderMainPanel(guildConfig, this.llm.status(), this.imagelab.configured);
    await (interaction as StringSelectMenuInteraction).update({
      components: [container, buildCategorySelect()],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

function buildCategoryRow(): ActionRowBuilder<StringSelectMenuBuilder> {
  return buildCategorySelect();
}

/** Bouton du portail : ouvre le dashboard principal en ÉPHÉMÈRE (staff). */
@ButtonHandler(SetupPanelButton)
@UseGuards(STAFF)
export class SetupPanelButtonHandler {
  constructor(
    private readonly config: GuildConfigService,
    private readonly llm: LlmService,
    private readonly imagelab: ImagelabService,
  ) {}

  async handle(@Ctx() interaction: import('discord.js').ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const guildConfig = await this.config.get(guildId);
    const container = renderMainPanel(guildConfig, this.llm.status(), this.imagelab.configured);
    await interaction.reply({
      components: [container, buildCategorySelect()],
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
    });
  }
}

// ── Navigation ───────────────────────────────────────────────

@StringSelectHandler(SetupCategorySelect)
@UseGuards(STAFF)
export class SetupCategoryHandler extends DashboardBase {
  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    const category = interaction.values[0] as CategoryId;
    PENDING.delete(this.key(interaction));
    await this.renderCategory(interaction, category);
  }
}

@ButtonHandler(SetupBackButton)
@UseGuards(STAFF)
export class SetupBackHandler extends DashboardBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await this.renderMain(interaction);
  }
}

// ── Modules ──────────────────────────────────────────────────

@StringSelectHandler(SetupModulesPick)
@UseGuards(STAFF)
export class SetupModulesPickHandler extends DashboardBase {
  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    PENDING.set(this.key(interaction), interaction.values[0] ?? '');
    await this.renderCategory(interaction, 'modules');
  }
}

@ButtonHandler(SetupModulesEnable)
@UseGuards(STAFF)
export class SetupModulesEnableHandler extends DashboardBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const moduleId = PENDING.get(this.key(interaction));
    if (!moduleId) return;
    await this.modules.enableModule('guild', interaction.guildId!, moduleId);
    await this.renderCategory(interaction, 'modules');
  }
}

@ButtonHandler(SetupModulesDisable)
@UseGuards(STAFF)
export class SetupModulesDisableHandler extends DashboardBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const moduleId = PENDING.get(this.key(interaction));
    if (!moduleId) return;
    await this.modules.disableModule('guild', interaction.guildId!, moduleId, true);
    await this.renderCategory(interaction, 'modules');
  }
}

// ── Bienvenue ────────────────────────────────────────────────

@ChannelSelectHandler(SetupWelcomeChannelSelect)
@UseGuards(STAFF)
export class SetupWelcomeChannelHandler extends DashboardBase {
  async handle(@Ctx() interaction: ChannelSelectMenuInteraction): Promise<void> {
    const channelId = interaction.values[0];
    if (!channelId) return;
    await this.configService.patch(interaction.guildId!, { welcome: { channelId, enabled: true } });
    await this.renderCategory(interaction, 'welcome');
  }
}

@RoleSelectHandler(SetupWelcomeAutoroleSelect)
@UseGuards(STAFF)
export class SetupWelcomeAutoroleHandler extends DashboardBase {
  async handle(@Ctx() interaction: RoleSelectMenuInteraction): Promise<void> {
    const roleId = interaction.values[0];
    if (!roleId) return;
    await this.configService.patch(interaction.guildId!, { welcome: { autoRoleId: roleId } });
    await this.renderCategory(interaction, 'welcome');
  }
}

@ButtonHandler(SetupWelcomeToggle)
@UseGuards(STAFF)
export class SetupWelcomeToggleHandler extends DashboardBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const current = await this.configService.get(interaction.guildId!);
    await this.configService.patch(interaction.guildId!, { welcome: { enabled: !current.welcome.enabled } });
    await this.renderCategory(interaction, 'welcome');
  }
}

@ButtonHandler(SetupWelcomeDeleteLeave)
@UseGuards(STAFF)
export class SetupWelcomeDeleteLeaveHandler extends DashboardBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const current = await this.configService.get(interaction.guildId!);
    await this.configService.patch(interaction.guildId!, { welcome: { deleteOnLeave: !current.welcome.deleteOnLeave } });
    await this.renderCategory(interaction, 'welcome');
  }
}

// ── Logs (2 temps : catégorie puis salon) ────────────────────

@StringSelectHandler(SetupLogsCatSelect)
@UseGuards(STAFF)
export class SetupLogsCatHandler extends DashboardBase {
  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    PENDING.set(this.key(interaction), interaction.values[0] ?? '');
    await this.renderCategory(interaction, 'logs');
  }
}

@ChannelSelectHandler(SetupLogsChannelSelect)
@UseGuards(STAFF)
export class SetupLogsChannelHandler extends DashboardBase {
  async handle(@Ctx() interaction: ChannelSelectMenuInteraction): Promise<void> {
    const category = PENDING.get(this.key(interaction));
    const channelId = interaction.values[0];
    if (!category || !channelId) return;
    await this.configService.patch(interaction.guildId!, { logs: { channels: { [category]: channelId } } });
    PENDING.delete(this.key(interaction));
    await this.renderCategory(interaction, 'logs');
  }
}

// ── Tickets ──────────────────────────────────────────────────

@ChannelSelectHandler(SetupTicketsCategorySelect)
@UseGuards(STAFF)
export class SetupTicketsCategoryHandler extends DashboardBase {
  async handle(@Ctx() interaction: ChannelSelectMenuInteraction): Promise<void> {
    const categoryId = interaction.values[0];
    if (!categoryId) return;
    await this.configService.patch(interaction.guildId!, { tickets: { categoryId } });
    await this.renderCategory(interaction, 'tickets');
  }
}

@RoleSelectHandler(SetupTicketsStaffSelect)
@UseGuards(STAFF)
export class SetupTicketsStaffHandler extends DashboardBase {
  async handle(@Ctx() interaction: RoleSelectMenuInteraction): Promise<void> {
    const staffRoleId = interaction.values[0];
    if (!staffRoleId) return;
    await this.configService.patch(interaction.guildId!, { tickets: { staffRoleId } });
    await this.renderCategory(interaction, 'tickets');
  }
}

@ChannelSelectHandler(SetupTicketsPanelSelect)
@UseGuards(STAFF)
export class SetupTicketsPanelHandler extends DashboardBase {
  async handle(@Ctx() interaction: ChannelSelectMenuInteraction): Promise<void> {
    const panelChannelId = interaction.values[0];
    if (!panelChannelId) return;
    await this.configService.patch(interaction.guildId!, { tickets: { panelChannelId } });
    await this.renderCategory(interaction, 'tickets');
  }
}

@ChannelSelectHandler(SetupTicketsLogsSelect)
@UseGuards(STAFF)
export class SetupTicketsLogsHandler extends DashboardBase {
  async handle(@Ctx() interaction: ChannelSelectMenuInteraction): Promise<void> {
    const logChannelId = interaction.values[0];
    if (!logChannelId) return;
    await this.configService.patch(interaction.guildId!, { tickets: { logChannelId } });
    await this.renderCategory(interaction, 'tickets');
  }
}

@ButtonHandler(SetupTicketsPost)
@UseGuards(STAFF)
export class SetupTicketsPostHandler extends DashboardBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guildConfig = await this.configService.get(interaction.guildId!);
    const panelChannelId = guildConfig.tickets.panelChannelId;
    if (!panelChannelId || !interaction.guild) {
      await interaction.reply({ content: '❌ Configure le salon du panneau avant de poster.', flags: MessageFlags.Ephemeral });
      return;
    }
    const channel = await interaction.guild.channels.fetch(panelChannelId).catch(() => null);
    if (!channel?.isTextBased() || channel.partial) {
      await interaction.reply({ content: '❌ Salon du panneau inaccessible.', flags: MessageFlags.Ephemeral });
      return;
    }
    const container = panel({
      title: '## 📬 Support',
      lines: ['Un problème, une question ? Ouvre un ticket et le staff te répondra ici.'],
      footer: 'Un seul ticket ouvert à la fois par membre.',
    });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ticket:open').setLabel('📬 Ouvrir un ticket').setStyle(ButtonStyle.Primary),
    );
    await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container, row] });
    await interaction.reply({ content: `✅ Panneau posté dans <#${panelChannelId}>.`, flags: MessageFlags.Ephemeral });
  }
}

// ── Rôles-réactions ──────────────────────────────────────────

@RoleSelectHandler(SetupRolesAddSelect)
@UseGuards(STAFF)
export class SetupRolesAddHandler extends DashboardBase {
  async handle(@Ctx() interaction: RoleSelectMenuInteraction): Promise<void> {
    const guildConfig = await this.configService.get(interaction.guildId!);
    const merged = [...new Set([...guildConfig.roles.roleIds, ...interaction.values])].slice(0, 25);
    await this.configService.patch(interaction.guildId!, { roles: { roleIds: merged } });
    await this.renderCategory(interaction, 'roles');
  }
}

@ChannelSelectHandler(SetupRolesChannelSelect)
@UseGuards(STAFF)
export class SetupRolesChannelHandler extends DashboardBase {
  async handle(@Ctx() interaction: ChannelSelectMenuInteraction): Promise<void> {
    const panelChannelId = interaction.values[0];
    if (!panelChannelId) return;
    await this.configService.patch(interaction.guildId!, { roles: { panelChannelId } });
    await this.renderCategory(interaction, 'roles');
  }
}

async function buildRolesMenuRow(guildConfig: GuildConfig, roleNames: Map<string, string>): Promise<ActionRowBuilder<StringSelectMenuBuilder>> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(RR_SELECT_ID)
    .setPlaceholder(guildConfig.roles.panelTitle.replace(/^🎭 */u, 'Choisis tes rôles'))
    .setMinValues(0)
    .setMaxValues(Math.max(1, guildConfig.roles.roleIds.length));
  for (const roleId of guildConfig.roles.roleIds) {
    menu.addOptions({ label: (roleNames.get(roleId) ?? roleId).slice(0, 99), value: roleId });
  }
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

@ButtonHandler(SetupRolesPost)
@UseGuards(STAFF)
export class SetupRolesPostHandler extends DashboardBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild!;
    const guildConfig = await this.configService.get(interaction.guildId!);
    if (guildConfig.roles.roleIds.length === 0) {
      await interaction.reply({ content: '❌ Ajoute au moins un rôle dans la catégorie avant de poster.', flags: MessageFlags.Ephemeral });
      return;
    }
    const panelChannelId = guildConfig.roles.panelChannelId;
    if (!panelChannelId) {
      await interaction.reply({ content: '❌ Choisis le salon du menu avant de poster.', flags: MessageFlags.Ephemeral });
      return;
    }
    const channel = await guild.channels.fetch(panelChannelId).catch(() => null);
    if (!channel?.isTextBased() || channel.partial) {
      await interaction.reply({ content: '❌ Salon du menu inaccessible.', flags: MessageFlags.Ephemeral });
      return;
    }
    const roleNames = new Map(guild.roles.cache.map((role) => [role.id, role.name]));
    const container = panel({
      title: guildConfig.roles.panelTitle || '🎭 Choisis tes rôles',
      lines: ['Sélectionne tes rôles dans le menu ci-dessous.'],
    });
    const row = await buildRolesMenuRow(guildConfig, roleNames);
    const message = await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container, row] });
    await this.configService.patch(interaction.guildId!, { roles: { panelMessageId: message.id } });
    await interaction.reply({ content: `✅ Menu posté dans <#${panelChannelId}>.`, flags: MessageFlags.Ephemeral });
  }
}

@ButtonHandler(SetupRolesRefresh)
@UseGuards(STAFF)
export class SetupRolesRefreshHandler extends DashboardBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild!;
    const guildConfig = await this.configService.get(interaction.guildId!);
    if (!guildConfig.roles.panelChannelId || !guildConfig.roles.panelMessageId) {
      await interaction.reply({ content: '❌ Aucun menu posté : utilise « Poster ».', flags: MessageFlags.Ephemeral });
      return;
    }
    const channel = (await guild.channels.fetch(guildConfig.roles.panelChannelId).catch(() => null)) ?? null;
    const textChannel = channel && channel.isTextBased() && !channel.partial ? channel : null;
    const message = await textChannel?.messages.fetch(guildConfig.roles.panelMessageId).catch(() => null);
    if (!message) {
      await interaction.reply({ content: '❌ Message du menu introuvable : reposte-le.', flags: MessageFlags.Ephemeral });
      return;
    }
    const roleNames = new Map(guild.roles.cache.map((role) => [role.id, role.name]));
    const row = await buildRolesMenuRow(guildConfig, roleNames);
    await message.edit({ components: [row] });
    await interaction.reply({ content: '✅ Menu rafraîchi.', flags: MessageFlags.Ephemeral });
  }
}

// ── Levels ───────────────────────────────────────────────────

@ButtonHandler(SetupLevelsToggle)
@UseGuards(STAFF)
export class SetupLevelsToggleHandler extends DashboardBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const current = await this.configService.get(interaction.guildId!);
    await this.configService.patch(interaction.guildId!, { levels: { enabled: !current.levels.enabled } });
    await this.renderCategory(interaction, 'levels');
  }
}

@ChannelSelectHandler(SetupLevelsChannelSelect)
@UseGuards(STAFF)
export class SetupLevelsChannelHandler extends DashboardBase {
  async handle(@Ctx() interaction: ChannelSelectMenuInteraction): Promise<void> {
    const announceChannelId = interaction.values[0];
    if (!announceChannelId) return;
    await this.configService.patch(interaction.guildId!, { levels: { announceChannelId } });
    await this.renderCategory(interaction, 'levels');
  }
}

// ── Modération ───────────────────────────────────────────────

@ChannelSelectHandler(SetupModChannelSelect)
@UseGuards(STAFF)
export class SetupModChannelHandler extends DashboardBase {
  async handle(@Ctx() interaction: ChannelSelectMenuInteraction): Promise<void> {
    const sanctionChannelId = interaction.values[0];
    if (!sanctionChannelId) return;
    await this.configService.patch(interaction.guildId!, { moderation: { sanctionChannelId } });
    await this.renderCategory(interaction, 'moderation');
  }
}

@ButtonHandler(SetupModDerank)
@UseGuards(STAFF)
export class SetupModDerankHandler extends DashboardBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const current = await this.configService.get(interaction.guildId!);
    await this.configService.patch(interaction.guildId!, { moderation: { muteDerank: !current.moderation.muteDerank } });
    await this.renderCategory(interaction, 'moderation');
  }
}

// ── Config avancée (clé → modale valeur) ─────────────────────

@StringSelectHandler(SetupConfigKeySelect)
@UseGuards(STAFF)
export class SetupConfigKeyHandler {
  constructor(private readonly modals: ModalService) {}

  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    const key = interaction.values[0];
    if (!key) return;
    PENDING.set(`${interaction.guildId}:${interaction.user.id}`, key);
    const modal = this.modals.build(SetupConfigValueModal);
    await interaction.showModal(modal);
  }
}

@ModalHandler(SetupConfigValueModal)
@UseGuards(STAFF)
export class SetupConfigValueHandler extends DashboardBase {
  async handle(
    @Ctx() interaction: ModalSubmitInteraction,
    @ModalTextField('value') rawValue: string,
  ): Promise<void> {
    const key = PENDING.get(this.key(interaction));
    if (!key) return;
    const descriptor = CONFIG_KEYS.find((entry) => entry.path === key);
    if (!descriptor) return;
    const value = coerce(descriptor.type, rawValue);
    await this.configService.patch(interaction.guildId!, setPath(key, value));
    PENDING.delete(this.key(interaction));
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Configuration mise à jour',
          lines: [`**\`${key}\`** → \`${JSON.stringify(value)}\``],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}

// ── Langue du serveur ────────────────────────────────────────

@StringSelectHandler(SetupLanguageSelect)
@UseGuards(STAFF)
export class SetupLanguageHandler extends DashboardBase {
  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    const locale = interaction.values[0] ?? 'fr';
    await this.configService.patch(interaction.guildId!, setPath('defaultLocale', locale));
    await this.renderCategory(interaction, 'language');
  }
}

// ── Salon dédié IA (retire le salon configuré) ───────────────

@ButtonHandler(SetupAssistantClear)
@UseGuards(STAFF)
export class SetupAssistantClearHandler extends DashboardBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await this.configService.patch(interaction.guildId!, { assistant: { channelId: '' } });
    await this.renderCategory(interaction, 'agent');
  }
}

function coerce(descriptorType: 'string' | 'boolean' | 'number' | 'channel' | 'role' | 'locale', raw: string): unknown {
  if (descriptorType === 'boolean') return raw.trim().toLowerCase() === 'true';
  if (descriptorType === 'number') return Number(raw);
  if (descriptorType === 'channel') return raw.replace(/<#(\d+)>/, '$1').trim();
  if (descriptorType === 'role') return raw.replace(/<@&(\d+)>/, '$1').trim();
  return raw;
}
