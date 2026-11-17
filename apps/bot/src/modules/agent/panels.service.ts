import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  ContainerBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';

/**
 * Panels interactifs construits par l'agent : message V2 avec boutons et/ou
 * sélecteur dont les interactions exécutent des actions configurées. Cas
 * canon : panneau de tickets avec sélecteur de type, chaque type créant le
 * salon dans SA catégorie avec overwrites staff et message d'accueil.
 * Persisté en DB (AgentPanel) : survit aux restarts, résolu par messageId.
 */

const MAX_BUTTONS = 5;
const MAX_OPTIONS = 25;

const PanelButtonSchema = z.object({
  label: z.string().min(1).max(80),
  emoji: z.string().max(16).optional(),
  style: z.enum(['primary', 'secondary', 'success', 'danger']).default('primary'),
  categoryId: z.string().optional(),
  welcomeMessage: z.string().max(1000).optional(),
});

const PanelOptionSchema = z.object({
  label: z.string().min(1).max(100),
  description: z.string().max(100).optional(),
  categoryId: z.string().min(1),
  welcomeMessage: z.string().max(1000).optional(),
});

const PanelDefinitionSchema = z
  .object({
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(1800),
    buttons: z.array(PanelButtonSchema).max(MAX_BUTTONS).optional(),
    selectMenu: z
      .object({
        placeholder: z.string().max(100).default('Choisis une option'),
        options: z.array(PanelOptionSchema).min(1).max(MAX_OPTIONS),
      })
      .optional(),
  })
  .refine((value) => value.buttons?.length || value.selectMenu?.options.length, {
    message: 'Au moins un bouton ou une option de sélecteur est requise.',
  });

export type PanelDefinition = z.infer<typeof PanelDefinitionSchema>;

@Injectable()
export class PanelsService implements SpraxiumOnBoot {
  private readonly log = new Logger('Panels');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: GuildConfigService,
    private readonly client: Client,
  ) {}

  onBoot(): void {
    getToolRegistry().register(this.sendPanelTool());
  }

  private sendPanelTool(): BotTool {
    return {
      name: 'sendPanel',
      description:
        'Poste un panel interactif (message V2 + jusqu\u0027à 5 boutons OU un sélecteur de 25 options). Chaque option/bouton crée un salon de ticket dans SA catégorie avec overwrites staff et message d\u0027accueil. Persisté en DB : survit aux restarts.',
      category: 'agent',
      paramsSchema: z.object({
        channelId: z.string().min(1),
        kind: z.enum(['ticket', 'poll', 'custom']).default('custom'),
        title: z.string().min(1).max(120),
        description: z.string().min(1).max(1800),
        buttons: z.array(PanelButtonSchema).max(MAX_BUTTONS).optional(),
        selectMenu: z
          .object({
            placeholder: z.string().max(100).default('Choisis une option'),
            options: z.array(PanelOptionSchema).min(1).max(MAX_OPTIONS),
          })
          .optional(),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'WORKFLOW PANELS : après tes questions et la création des catégories nécessaires (createCategory), construis le panel ici. Pour des tickets à plusieurs types, préfère le SÉLECTEUR (chaque option porte sa categoryId et son welcomeMessage). Permissions du bot vérifiées à l\u0027interaction.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const guild = this.client.guilds.cache.get(ctx.guildId);
        if (!guild) return { ok: false, summary: 'Serveur introuvable.' };
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.SendMessages)) {
          return { ok: false, summary: "Le bot n'a pas la permission SendMessages sur ce serveur." };
        }
        try {
          const parsed = PanelDefinitionSchema.safeParse(input);
          if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return { ok: false, summary: `Panel invalide (${issue?.path.join('.') || 'definition'}) : ${issue?.message ?? ''}` };
          }
          const { channelId, kind } = input as { channelId: string; kind?: string };
          const channel = await this.client.channels.fetch(channelId).catch(() => null);
          if (!channel?.isTextBased() || !('send' in channel)) {
            return { ok: false, summary: 'Salon cible introuvable ou non textuel.' };
          }
          const definition = parsed.data as PanelDefinition;
          // Catégories validées SUR CE SERVEUR : un ID d'un autre serveur (ou
          // supprimé) ferait ouvrir les tickets à la racine sans erreur.
          const guild = this.client.guilds.cache.get(ctx.guildId);
          if (!guild) return { ok: false, summary: 'Serveur introuvable.' };
          const referencedCategories = [
            ...(definition.buttons ?? []).map((button) => button.categoryId).filter((id): id is string => Boolean(id)),
            ...(definition.selectMenu?.options ?? []).map((option) => option.categoryId).filter((id): id is string => Boolean(id)),
          ];
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
          const sent = await channel.send({ flags: 32768, components: [this.buildContainer(definition)] }).catch(() => null);
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
            metadata: { requestId: undefined, panelId: row.id, kind: row.kind, buttons: definition.buttons?.length ?? 0, options: definition.selectMenu?.options.length ?? 0 },
          });
          return {
            ok: true,
            summary: `Panel « ${definition.title} » posté dans <#${channelId}> et persisté (id ${row.id.slice(-6)}).`,
            data: { panelId: row.id, messageId: sent.id },
          };
        } catch (error) {
          return { ok: false, summary: `Panel échoué : ${error instanceof Error ? error.message.slice(0, 150) : 'erreur'}` };
        }
      },
    };
  }

  private buildContainer(definition: PanelDefinition): ContainerBuilder {
    const container = new ContainerBuilder().setAccentColor(0xd9_59_26);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${definition.title}`));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(definition.description));

    if (definition.selectMenu?.options.length) {
      const menu = new StringSelectMenuBuilder()
        .setCustomId('panel:select')
        .setPlaceholder(definition.selectMenu.placeholder.slice(0, 100));
      for (const [index, option] of definition.selectMenu.options.entries()) {
        menu.addOptions({
          label: option.label.slice(0, 100),
          value: `${index}`,
          description: option.description?.slice(0, 100),
        });
      }
      container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
      return container;
    }

    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const [index, button] of (definition.buttons ?? []).entries()) {
      const builder = new ButtonBuilder()
        .setCustomId(`panel:btn:${index}`)
        .setLabel(button.label.slice(0, 80))
        .setStyle(
          button.style === 'danger'
            ? ButtonStyle.Danger
            : button.style === 'success'
              ? ButtonStyle.Success
              : button.style === 'secondary'
                ? ButtonStyle.Secondary
                : ButtonStyle.Primary,
        );
      if (button.emoji) builder.setEmoji(button.emoji);
      row.addComponents(builder);
    }
    container.addActionRowComponents(row);
    return container;
  }

  /** Sélecteur : option index → salon de ticket dans la catégorie du type. */
  async handleSelect(messageId: string, optionIndex: number, member: import('discord.js').GuildMember): Promise<string> {
    const row = await this.prisma.agentPanel.findFirst({ where: { messageId } });
    if (!row) throw new Error('Panel introuvable (supprimé ?).');
    const definition = PanelDefinitionSchema.parse(JSON.parse(row.definition)) as PanelDefinition;
    const option = definition.selectMenu?.options[optionIndex];
    if (!option) throw new Error('Option introuvable dans ce panel.');
    return this.createTicketChannel(row.guildId, option.label, option.categoryId, option.welcomeMessage, member, row.id);
  }

  /** Bouton : index → salon de ticket dans la catégorie du bouton. */
  async handleButton(messageId: string, buttonIndex: number, member: import('discord.js').GuildMember): Promise<string> {
    const row = await this.prisma.agentPanel.findFirst({ where: { messageId } });
    if (!row) throw new Error('Panel introuvable (supprimé ?).');
    const definition = PanelDefinitionSchema.parse(JSON.parse(row.definition)) as PanelDefinition;
    const button = definition.buttons?.[buttonIndex];
    if (!button) throw new Error('Bouton introuvable dans ce panel.');
    return this.createTicketChannel(row.guildId, button.label, button.categoryId, button.welcomeMessage, member, row.id);
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
    // Ligne Ticket obligatoire : les boutons claim/close du module tickets
    // résolvent le ticket par (guildId, channelId) en DB — sans elle ils
    // seraient des no-op silencieux sur les tickets ouverts par le panel.
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
