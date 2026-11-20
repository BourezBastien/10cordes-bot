import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  PermissionFlagsBits,
  SectionBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';
import { DynamicButton } from '@spraxium/components';
import { z } from 'zod';
import { ComponentButtonActionSchema, ComponentRowDefSchema, type ComponentButtonAction } from '@10cordes/shared';
import { ButtonService } from '@spraxium/components';
import type { BotTool } from '@10cordes/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { registerComponentAction, executeComponentAction } from '../../shared/actions/registry';
import { registerDefaultComponentExecutors } from '../../shared/actions/default-executors';

/** Bouton dynamique des rangées arbitraires : params inline r/b (index rangée/bouton). */
@DynamicButton({ baseId: 'panel:action', encoding: 'inline' })
export class PanelActionButton {
  static render(item: { r: number; b: number; label: string; style: string; emoji?: string }) {
    return {
      label: item.label.slice(0, 80),
      style: (item.style as 'primary' | 'secondary' | 'success' | 'danger') ?? 'primary',
      emoji: item.emoji ? { name: item.emoji } : undefined,
      params: { r: item.r, b: item.b },
    };
  }
}

/**
 * Service embed + composants UNIVERSEL : l'agent construit des messages V2
 * arbitraires (titre, description, couleur, footer, thumbnail, image, N
 * rangées de boutons à action typée, menus déroulants) persistés en DB
 * (AgentPanel) — les interactions sont résolues par messageId et survivent
 * aux redémarrages. Les actions sont dispatchées par le registre partagé
 * (shared/actions) : ticket, reply, link, giveRole, removeRole, reveal,
 * counter... Ce service enregistre lui-même l'executor 'ticket' (sa logique
 * de création de salon). Forme héritée (buttons/selectMenu à plat) acceptée
 * pour compatibilité avec les définitions déjà stockées.
 */

const MAX_BUTTONS = 5;

const PanelButtonSchema = z.object({
  label: z.string().min(1).max(80),
  emoji: z.string().max(16).optional(),
  style: z.enum(['primary', 'secondary', 'success', 'danger']).default('primary'),
  categoryId: z.string().optional(),
  welcomeMessage: z.string().max(1000).optional(),
  action: ComponentButtonActionSchema.optional(),
});

const PanelOptionSchema = z.object({
  label: z.string().min(1).max(100),
  description: z.string().max(100).optional(),
  categoryId: z.string().min(1),
  welcomeMessage: z.string().max(1000).optional(),
});

const PanelDefinitionSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().min(1).max(3500).optional(),
    accentColor: z.number().int().min(0).max(0xffffff).optional(),
    footer: z.string().max(200).optional(),
    thumbnailUrl: z.string().url().max(500).optional(),
    imageUrl: z.string().url().max(500).optional(),
    rows: z.array(ComponentRowDefSchema).max(10).optional(),
    // Forme héritée (compat définitions stockées avant le layout générique).
    buttons: z.array(PanelButtonSchema).max(MAX_BUTTONS).optional(),
    selectMenu: z
      .object({
        placeholder: z.string().max(100).default('Choisis une option'),
        options: z.array(PanelOptionSchema).min(1).max(25),
      })
      .optional(),
  })
  .refine(
    (value) => value.title || value.description || value.rows?.length || value.buttons?.length || value.selectMenu,
    { message: 'Un titre, une description, des boutons ou un sélecteur est requis.' },
  );

export type PanelDefinition = z.infer<typeof PanelDefinitionSchema>;

@Injectable()
export class PanelsService implements SpraxiumOnBoot {
  private readonly log = new Logger('Panels');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: GuildConfigService,
    private readonly client: Client,
    private readonly buttons: ButtonService,
  ) {}

  onBoot(): void {
    registerDefaultComponentExecutors();
    getToolRegistry().register(this.sendPanelTool());
    getToolRegistry().register(this.editPanelTool());
    getToolRegistry().register(this.deletePanelTool());
    // Executor 'ticket' : la création de salon appartient à ce service.
    registerComponentAction('ticket', async (action, ctx) => {
      if (!ctx.member) return 'Membre introuvable pour ouvrir le ticket.';
      if (action.type !== 'ticket') return 'Action inattendue.';
      return this.createTicketChannel(ctx.guildId, ctx.label ?? 'ticket', action.categoryId, action.welcomeMessage, ctx.member, ctx.messageId);
    });
  }

  private sendPanelTool(): BotTool {
    return {
      name: 'sendPanel',
      description:
        'Le service embed+composants universel : poste un embed V2 arbitraire (titre, description, couleur, footer, thumbnail, image) avec jusqu\u0027à 10 rangées de boutons (5 par rangée) à action typée ou des menus déroulants. Actions : ticket (ouvre un salon dans une catégorie), reply (message pré-écrit), link (URL), giveRole/removeRole (sur le membre qui clique), reveal (contenu caché éphémère), counter (compteur de clics). Persisté : interactions survivent aux redémarrages.',
      category: 'agent',
      paramsSchema: z.object({
        channelId: z.string().min(1),
        kind: z.enum(['ticket', 'poll', 'custom']).default('custom'),
        title: z.string().min(1).max(120),
        description: z.string().min(1).max(3500),
        accentColor: z.number().int().min(0).max(0xffffff).optional(),
        footer: z.string().max(200).optional(),
        thumbnailUrl: z.string().url().max(500).optional(),
        imageUrl: z.string().url().max(500).optional(),
        rows: z
          .array(
            z.union([
              z.object({ kind: z.literal('buttons'), buttons: z.array(PanelButtonSchema).min(1).max(5) }),
              z.object({
                kind: z.literal('select'),
                select: z.object({
                  placeholder: z.string().max(100).default('Choisis une option'),
                  options: z.array(PanelOptionSchema).min(1).max(25),
                }),
              }),
            ]),
          )
          .max(10)
          .optional(),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'USE UNIVERSEL pour tout message à composants construit à la volée : boutons intégrés DANS l\u0029embed (jamais en dessous). Actions de bouton : ticket / reply / link / giveRole / removeRole / reveal / counter. IDs de catégories : UNIQUEMENT ceux renvoyés par tes tools sur CE serveur. Les interactions fonctionnent après redémarrage (définition persistée en DB). Une fois posté, réponds en UNE phrase, ne répète pas le contenu.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const guild = this.client.guilds.cache.get(ctx.guildId);
        if (!guild) return { ok: false, summary: 'Serveur introuvable.' };
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.SendMessages)) {
          return { ok: false, summary: "Le bot n'a pas la permission SendMessages sur ce serveur." };
        }
        try {
          const { channelId, kind } = input as { channelId: string; kind?: string };
          const channel = await this.client.channels.fetch(channelId).catch(() => null);
          if (!channel?.isTextBased() || !('send' in channel)) {
            return { ok: false, summary: 'Salon cible introuvable ou non textuel.' };
          }
          // Normalisation : forme héritée à plat → rangées génériques.
          const definition = this.normalizeDefinition(input as Record<string, unknown>);
          if (!definition) {
            return { ok: false, summary: 'Définition du panel invalide (titre, boutons ou sélecteur requis).' };
          }
          // Catégories validées SUR CE SERVEUR : un ID d'un autre serveur (ou
          // supprimé) ferait ouvrir les tickets à la racine sans erreur.
          const referencedCategories = this.referencedCategories(definition);
          const invalid: string[] = [];
          for (const id of [...new Set(referencedCategories)]) {
            const fetched = await guild.channels.fetch(id).catch(() => null);
            if (!fetched || fetched.type !== ChannelType.GuildCategory) {
              invalid.push(id);
            }
          }
          if (invalid.length > 0) {
            return {
              ok: false,
              summary:
                `Catégories introuvables sur CE serveur : ${invalid.join(', ')}. ` +
                'Crée-les d\u0029abord (createCategory) et utilise les IDs RENVOYÉS par le tool — jamais des IDs d\u0029une autre conversation ou d\u0029un autre serveur.',
            };
          }
          const sent = await channel
            .send({ flags: 32768, components: [await this.buildContainer(definition)] })
            .catch(() => null);
          if (!sent) return { ok: false, summary: 'Impossible de poster le panel (permissions du salon ?).' };

          const row = await this.prisma.agentPanel.create({
            data: {
              guildId: ctx.guildId,
              channelId,
              messageId: sent.id,
              kind: kind ?? 'custom',
              definition: JSON.stringify(definition),
              createdByUserId: ctx.userId,
            },
          });
          this.audit.record({
            guildId: ctx.guildId,
            source: 'agent',
            action: 'panel.created',
            actorId: ctx.userId,
            metadata: { requestId: undefined, panelId: row.id, kind: row.kind, rows: definition.rows?.length ?? 0 },
          });
          return {
            ok: true,
            summary: `Panel « ${definition.title ?? 'sans titre'} » posté dans <#${channelId}> et persisté (id ${row.id.slice(-6)}).`,
            data: { panelId: row.id, messageId: sent.id },
          };
        } catch (error) {
          return { ok: false, summary: `Panel échoué : ${error instanceof Error ? error.message.slice(0, 150) : 'erreur'}` };
        }
      },
    };
  }

  private editPanelTool(): BotTool {
    return {
      name: 'components.edit',
      description: 'Réédite un panel/composant déjà posté : remplace son layout (titre, description, rangées de boutons...) et la définition persistée.',
      category: 'agent',
      paramsSchema: z.object({
        messageId: z.string().min(1),
        title: z.string().min(1).max(120).optional(),
        description: z.string().min(1).max(3500).optional(),
        accentColor: z.number().int().min(0).max(0xffffff).optional(),
        footer: z.string().max(200).optional(),
        thumbnailUrl: z.string().url().max(500).optional(),
        imageUrl: z.string().url().max(500).optional(),
        rows: z
          .array(
            z.union([
              z.object({ kind: z.literal('buttons'), buttons: z.array(PanelButtonSchema).min(1).max(5) }),
              z.object({
                kind: z.literal('select'),
                select: z.object({
                  placeholder: z.string().max(100).default('Choisis une option'),
                  options: z.array(PanelOptionSchema).min(1).max(25),
                }),
              }),
            ]),
          )
          .max(10)
          .optional(),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Pour corriger/améliorer un panel existant. Les champs omis conservent leur valeur actuelle.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { messageId } = input as { messageId: string };
        const row = await this.prisma.agentPanel.findFirst({ where: { messageId, guildId: ctx.guildId } });
        if (!row) return { ok: false, summary: 'Panel introuvable pour ce message.' };
        const current = this.normalizeDefinition(JSON.parse(row.definition));
        const patch = input as Record<string, unknown>;
        const merged = this.normalizeDefinition({ ...current, ...patch });
        if (!merged) return { ok: false, summary: 'Layout résultant invalide.' };
        await this.prisma.agentPanel.update({ where: { id: row.id }, data: { definition: JSON.stringify(merged) } });
        const guild = this.client.guilds.cache.get(ctx.guildId);
        if (guild) {
          const channel = await guild.channels.fetch(row.channelId).catch(() => null);
          if (channel?.isTextBased() && !channel.partial) {
            await channel.messages
              .edit(messageId, { flags: 32768, components: [await this.buildContainer(merged)] })
              .catch(() => {});
          }
        }
        return { ok: true, summary: `Panel « ${merged.title ?? row.id.slice(-6)} » édité et re-rendu.` };
      },
    };
  }

  private deletePanelTool(): BotTool {
    return {
      name: 'components.delete',
      description: 'Supprime un panel/composant posté par le bot (message + définition persistée).',
      category: 'agent',
      paramsSchema: z.object({ messageId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: true,
      systemPrompt: 'Suppression définitive du message et de sa définition d\u0029interactions.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { messageId } = input as { messageId: string };
        const row = await this.prisma.agentPanel.findFirst({ where: { messageId, guildId: ctx.guildId } });
        if (!row) return { ok: false, summary: 'Panel introuvable pour ce message.' };
        const guild = this.client.guilds.cache.get(ctx.guildId);
        if (guild) {
          const channel = await guild.channels.fetch(row.channelId).catch(() => null);
          if (channel?.isTextBased() && !channel.partial) {
            await channel.messages.delete(messageId).catch(() => {});
          }
        }
        await this.prisma.agentPanel.delete({ where: { id: row.id } });
        return { ok: true, summary: 'Panel supprimé (message + définition).' };
      },
    };
  }

  /**
   * Normalise une définition (forme héritée à plat ou rangées génériques)
   * en layout à rangées uniquement : les boutons plats deviennent une rangée,
   * le selectMenu devient une rangée select.
   */
  private normalizeDefinition(raw: Record<string, unknown>): PanelDefinition | null {
    const parsed = PanelDefinitionSchema.safeParse(raw);
    if (!parsed.success) return null;
    const value = parsed.data;
    const rows: NonNullable<PanelDefinition['rows']> = [...(value.rows ?? [])];
    // Forme héritée : les boutons à plat portent categoryId/welcomeMessage
    // convertis en action 'ticket' (le layout normalisé ne connaît que les
    // actions typées).
    if (value.buttons?.length) {
      rows.unshift({
        kind: 'buttons',
        buttons: value.buttons.map((button) => ({
          label: button.label,
          emoji: button.emoji,
          style: button.style,
          action:
            button.action ??
            (button.categoryId
              ? { type: 'ticket' as const, categoryId: button.categoryId, welcomeMessage: button.welcomeMessage }
              : { type: 'ticket' as const }),
        })),
      });
    }
    if (value.selectMenu?.options.length) {
      rows.unshift({
        kind: 'select',
        select: {
          placeholder: value.selectMenu.placeholder ?? 'Choisis une option',
          options: value.selectMenu.options.map((option) => ({
            label: option.label,
            description: option.description,
            action: { type: 'ticket' as const, categoryId: option.categoryId, welcomeMessage: option.welcomeMessage },
          })),
        },
      });
    }
    const normalized: PanelDefinition = {
      title: value.title,
      description: value.description,
      accentColor: value.accentColor,
      footer: value.footer,
      thumbnailUrl: value.thumbnailUrl,
      imageUrl: value.imageUrl,
      rows,
    };
    if (!normalized.title && !normalized.description && (normalized.rows?.length ?? 0) === 0) return null;
    return normalized;
  }

  /** Tous les categoryId référencés par les actions du layout (validation serveur). */
  private referencedCategories(definition: PanelDefinition): string[] {
    const ids: string[] = [];
    for (const row of definition.rows ?? []) {
      if (row.kind === 'buttons') {
        for (const button of row.buttons) {
          if (button.action?.type === 'ticket' && button.action.categoryId) ids.push(button.action.categoryId);
        }
      } else {
        for (const option of row.select.options) {
          if (option.action?.type === 'ticket' && option.action.categoryId) ids.push(option.action.categoryId);
        }
      }
    }
    return ids;
  }

  /** Rendu déterministe du layout en container V2 (rangées via boutons dynamiques inline). */
  private async buildContainer(definition: PanelDefinition): Promise<ContainerBuilder> {
    const container = new ContainerBuilder().setAccentColor(definition.accentColor ?? 0xd9_59_26);
    if (definition.thumbnailUrl) {
      const section = new SectionBuilder().setThumbnailAccessory(
        new ThumbnailBuilder().setURL(definition.thumbnailUrl),
      );
      section.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${definition.title ?? ''}`));
      if (definition.description) {
        section.addTextDisplayComponents(new TextDisplayBuilder().setContent(definition.description));
      }
      container.addSectionComponents(section);
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${definition.title ?? ''}`));
      if (definition.description) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(definition.description));
      }
    }
    if (definition.imageUrl) {
      const gallery = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setDescription('Image du panel').setURL(definition.imageUrl),
      );
      container.addMediaGalleryComponents(gallery);
    }
    if (definition.footer) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${definition.footer}`));
    }
    await this.addRows(container, definition);
    return container;
  }

  private async addRows(container: ContainerBuilder, definition: PanelDefinition): Promise<void> {
    for (const [rowIndex, row] of (definition.rows ?? []).entries()) {
      if (row.kind === 'select') {
        // Un seul menu déroulant possible par panel : customId hérité
        // 'panel:select', résolu par le handler historique.
        const menu = new StringSelectMenuBuilder()
          .setCustomId('panel:select')
          .setPlaceholder((row.select.placeholder ?? 'Choisis une option').slice(0, 100));
        for (const [optionIndex, option] of row.select.options.entries()) {
          menu.addOptions({
            label: option.label.slice(0, 100),
            value: `${optionIndex}`,
            description: option.description?.slice(0, 100),
          });
        }
        container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
        continue;
      }
      // Rangée de boutons : les liens restent statiques (URL directe), les
      // actions passent par des boutons dynamiques inline (params r/b dans
      // le customId, résolus par PanelActionButtonHandler).
      const builders: ButtonBuilder[] = [];
      const dynamicItems: Array<{ r: number; b: number; label: string; style: string; emoji?: string }> = [];
      const linkPositions: Map<number, ButtonBuilder> = new Map();
      for (const [buttonIndex, button] of row.buttons.entries()) {
        const action = button.action?.type ?? 'ticket';
        if (action === 'link' && button.action?.type === 'link') {
          linkPositions.set(
            buttonIndex,
            new ButtonBuilder().setLabel(button.label.slice(0, 80)).setURL(button.action.url).setStyle(ButtonStyle.Link),
          );
        } else {
          dynamicItems.push({
            r: rowIndex,
            b: buttonIndex,
            label: button.label,
            style: button.style,
            emoji: button.emoji,
          });
        }
      }
      const dynamicBuilders = await this.buttons.buildDynamicButtons(PanelActionButton, dynamicItems);
      let dynamicCursor = 0;
      for (const [buttonIndex] of row.buttons.entries()) {
        const staticLink = linkPositions.get(buttonIndex);
        if (staticLink) {
          builders.push(staticLink);
        } else {
          const built = dynamicBuilders[dynamicCursor];
          dynamicCursor += 1;
          if (built) builders.push(built);
        }
      }
      container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(builders));
    }
  }

  /** Résout l'action d'un bouton de rangée générique et l'exécute. */
  async handleLayoutButton(
    messageId: string,
    rowIndex: number,
    buttonIndex: number,
    member: import('discord.js').GuildMember,
    interaction: import('discord.js').ButtonInteraction,
  ): Promise<string> {
    const row = await this.prisma.agentPanel.findFirst({ where: { messageId } });
    if (!row) throw new Error('Panel introuvable (supprimé ?).');
    const definition = this.normalizeDefinition(JSON.parse(row.definition));
    if (!definition) throw new Error('Définition du panel illisible.');
    const layoutRow = definition.rows?.[rowIndex];
    if (!layoutRow || layoutRow.kind !== 'buttons') throw new Error('Rangée introuvable dans ce panel.');
    const button = layoutRow.buttons[buttonIndex];
    if (!button) throw new Error('Bouton introuvable dans ce panel.');
    const action: ComponentButtonAction = button.action ?? { type: 'reply', message: '👍' };
    const { executeComponentAction } = await import('../../shared/actions/registry');
    return executeComponentAction(action, {
      interaction,
      guildId: row.guildId,
      channelId: row.channelId,
      member,
      messageId: row.id,
      label: button.label,
    });
  }

  /** Résout l'action d'une option de menu déroulant générique. */
  async handleLayoutSelect(
    messageId: string,
    rowIndex: number,
    optionIndex: number,
    member: import('discord.js').GuildMember,
    interaction: import('discord.js').StringSelectMenuInteraction,
  ): Promise<string> {
    const row = await this.prisma.agentPanel.findFirst({ where: { messageId } });
    if (!row) throw new Error('Panel introuvable (supprimé ?).');
    const definition = this.normalizeDefinition(JSON.parse(row.definition));
    if (!definition) throw new Error('Définition du panel illisible.');
    const layoutRow = definition.rows?.[rowIndex];
    if (!layoutRow || layoutRow.kind !== 'select') throw new Error('Menu introuvable dans ce panel.');
    const option = layoutRow.select.options[optionIndex];
    if (!option) throw new Error('Option introuvable dans ce menu.');
    const action: ComponentButtonAction = option.action ?? { type: 'reply', message: '👍' };
    const { executeComponentAction } = await import('../../shared/actions/registry');
    return executeComponentAction(action, {
      interaction,
      guildId: row.guildId,
      channelId: row.channelId,
      member,
      messageId: row.id,
      label: option.label,
    });
  }

  /** Sélecteur historique (customId panel:select) : option index → ticket. */
  async handleSelect(messageId: string, optionIndex: number, member: import('discord.js').GuildMember): Promise<string> {
    const row = await this.prisma.agentPanel.findFirst({ where: { messageId } });
    if (!row) throw new Error('Panel introuvable (supprimé ?).');
    const definition = this.normalizeDefinition(JSON.parse(row.definition));
    if (!definition) throw new Error('Définition du panel illisible.');
    const legacyRow = definition.rows?.find((r) => r.kind === 'select');
    if (!legacyRow || legacyRow.kind !== 'select') throw new Error('Menu introuvable dans ce panel.');
    const option = legacyRow.select.options[optionIndex];
    if (!option) throw new Error('Option introuvable dans ce menu.');
    return this.runAction(option.action ?? { type: 'ticket' }, {
      interaction: null as unknown as import('discord.js').ButtonInteraction,
      guildId: row.guildId,
      channelId: row.channelId,
      member,
      messageId: row.id,
      label: option.label,
    });
  }

  /** Bouton historique (customId panel:btn:N) : index → ticket dans la catégorie. */
  async handleButton(messageId: string, buttonIndex: number, member: import('discord.js').GuildMember): Promise<string> {
    const row = await this.prisma.agentPanel.findFirst({ where: { messageId } });
    if (!row) throw new Error('Panel introuvable (supprimé ?).');
    const definition = this.normalizeDefinition(JSON.parse(row.definition));
    if (!definition) throw new Error('Définition du panel illisible.');
    const buttonsRow = definition.rows?.find((r) => r.kind === 'buttons');
    if (!buttonsRow || buttonsRow.kind !== 'buttons') throw new Error('Bouton introuvable dans ce panel.');
    const button = buttonsRow.buttons[buttonIndex];
    if (!button) throw new Error('Bouton introuvable dans ce panel.');
    return this.runAction(button.action ?? { type: 'ticket' }, {
      interaction: null as unknown as import('discord.js').ButtonInteraction,
      guildId: row.guildId,
      channelId: row.channelId,
      member,
      messageId: row.id,
      label: button.label,
    });
  }

  /** Dispatch d'une action via le registre (interaction nulle pour les paths hérités sans UI). */
  private runAction(
    action: ComponentButtonAction,
    ctx: Parameters<typeof executeComponentAction>[1],
  ): Promise<string> {
    return executeComponentAction(action, ctx);
  }

  /** Salon de ticket : catégorie du type, overwrites (membre + staff), accueil. */
  private async createTicketChannel(
    guildId: string,
    label: string,
    categoryId: string | undefined,
    welcomeMessage: string | undefined,
    member: import('discord.js').GuildMember,
    panelId: string,
  ): Promise<string> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Serveur introuvable.');
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      throw new Error("Le bot n'a pas la permission ManageChannels.");
    }
    const guildConfig = await this.config.get(guildId).catch(() => null);
    const staffRoleId = guildConfig?.tickets.staffRoleId;
    const counter = await this.prisma.ticketCounter.upsert({
      where: { guildId },
      create: { guildId, value: 1 },
      update: { value: { increment: 1 } },
    });
    // Ligne Ticket obligatoire : les boutons claim/close du module tickets
    // résolvent le ticket par (guildId, channelId) en DB — sans elle ils
    // seraient des no-op silencieux sur les tickets ouverts par le panel.
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ticket';
    const created = await guild.channels.create({
      name: `${slug}-${String(counter.value).padStart(4, '0')}`,
      type: ChannelType.GuildText,
      parent: categoryId,
      reason: `ticket de <@${member.id}> (panel)`,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ...(staffRoleId
          ? [{ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }]
          : []),
      ],
    });
    await this.prisma.ticket
      .create({ data: { guildId, number: counter.value, channelId: created.id, userId: member.id } })
      .catch(() => {});
    // Accueil en V2 (embed moderne) + rangée standard claim / fermer / aide.
    const welcome = new ContainerBuilder().setAccentColor(0xd9_59_26);
    welcome.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 📬 Ticket — ${label}`));
    welcome.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${welcomeMessage ? `${welcomeMessage}\n\n` : ''}<@${member.id}> décris ta demande ici : le staff arrive.\n\n` +
          '🙋 **Claim** (staff) : prise en charge · 🔒 **Fermer** (staff) : clôture + transcript · 🆘 **Aide** : appelle le staff.',
      ),
    );
    await created
      .send({ flags: 32768, components: [welcome, ticketActionRow()] })
      .catch(() => {});
    this.audit.record({
      guildId,
      source: 'agent',
      action: 'panel.ticket.created',
      actorId: member.id,
      targetId: created.id,
      metadata: { panelId, label },
    });
    return `Salon <#${created.id}> créé dans la catégorie ${categoryId ? `<#${categoryId}>` : 'racine'}.`;
  }
}

/** Ligne d'action standard d'un ticket ouvert : claim / fermer / demander de l'aide. */
function ticketActionRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('🙋 Claim').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket:help').setLabel('🆘 Demander de l\u0027aide').setStyle(ButtonStyle.Primary),
  );
}
