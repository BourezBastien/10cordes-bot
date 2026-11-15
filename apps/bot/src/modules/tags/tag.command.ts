import {
  Ctx,
  SlashCommand,
  SlashCommandHandler,
  SlashOption,
  SlashStringOption,
  SlashSubcommand,
  UseGuards,
  withOptions,
} from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { TagsService } from './tags.service';
import { panel, text } from '../../shared/ui';

const MANAGE = withOptions(PermissionGuard, { permissions: ['ManageGuild'] });

@SlashCommand({
  name: 'tag',
  description: 'Custom tag commands stored per server.',
  dmPermission: false,
})
export class TagCommand {
  @SlashOption.String('name', { description: 'Tag name', required: true })
  @SlashOption.String('content', { description: 'Tag content (markdown)', required: true })
  @SlashSubcommand({ name: 'add', description: 'Create a tag.' })
  add() {}

  @SlashOption.String('name', { description: 'Tag name', required: true })
  @SlashOption.String('content', { description: 'New content (markdown)', required: true })
  @SlashSubcommand({ name: 'edit', description: 'Edit a tag.' })
  edit() {}

  @SlashOption.String('name', { description: 'Tag name', required: true })
  @SlashSubcommand({ name: 'delete', description: 'Delete a tag.' })
  delete() {}

  @SlashOption.String('name', { description: 'Tag name', required: true })
  @SlashSubcommand({ name: 'show', description: 'Show a tag content.' })
  show() {}

  @SlashSubcommand({ name: 'list', description: 'List the tags of this server.' })
  list() {}
}

@SlashCommandHandler(TagCommand, { sub: 'add' })
@UseGuards(MANAGE)
export class TagAddHandler {
  constructor(private readonly tags: TagsService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('name') name: string,
    @SlashStringOption('content') content: string,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    await this.tags.add(guildId, name, content, interaction.user.id);
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## ✅ Tag créé', lines: [`\`${name}\``], accentColor: 0x57_f2_87 })],
    });
  }
}

@SlashCommandHandler(TagCommand, { sub: 'edit' })
@UseGuards(MANAGE)
export class TagEditHandler {
  constructor(private readonly tags: TagsService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('name') name: string,
    @SlashStringOption('content') content: string,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    try {
      await this.tags.edit(guildId, name, content);
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [panel({ title: '## ✅ Tag modifié', lines: [`\`${name}\``], accentColor: 0x57_f2_87 })],
      });
    } catch (error) {
      if (error instanceof Error) throw new Error(error.message);
      throw error;
    }
  }
}

@SlashCommandHandler(TagCommand, { sub: 'delete' })
@UseGuards(MANAGE)
export class TagDeleteHandler {
  constructor(private readonly tags: TagsService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('name') name: string,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    try {
      await this.tags.remove(guildId, name);
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [panel({ title: '## ✅ Tag supprimé', lines: [`\`${name}\``], accentColor: 0x57_f2_87 })],
      });
    } catch (error) {
      if (error instanceof Error) throw new Error(error.message);
      throw error;
    }
  }
}

@SlashCommandHandler(TagCommand, { sub: 'show' })
export class TagShowHandler {
  constructor(private readonly tags: TagsService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('name') name: string,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const tag = await this.tags.show(guildId, name);
    if (!tag) {
      throw new Error(`Tag \`${name}\` introuvable.`);
    }
    // Contenu défini par les utilisateurs — envoyé tel quel dans un TextDisplay.
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2],
      components: [text(tag.content)],
    });
  }
}

@SlashCommandHandler(TagCommand, { sub: 'list' })
export class TagListHandler {
  constructor(private readonly tags: TagsService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const tags = await this.tags.list(guildId);
    const lines =
      tags.length > 0
        ? tags.map((tag) => `\`${tag.name}\` — ${tag.uses} utilisation(s)`)
        : ['Aucun tag. Crée le premier avec `/tag add`.'];

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## 🏷️ Tags', lines })],
    });
  }
}
