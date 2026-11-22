import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { PermissionFlagsBits, Client, type GuildMember, type Message, type PartialGuildMember } from 'discord.js';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { renderTemplate } from '@10cordes/shared';

/**
 * Automatisations créées par l'agent (décision produit skills-first) :
 * event Discord → filtres → actions. Le bot les construit à la demande
 * (« quand un ticket s'ouvre, mentionne le staff »), les listeners exécutent.
 *
 * Gates en code : création/liste/suppression ManageGuild ; à l'exécution,
 * chaque action re-vérifie les permissions du BOT (SendMessages/ManageRoles).
 * Variables de template : {{user}}, {{user.name}}, {{server}}, {{count}}.
 */

const TRIGGER_TYPES = ['message.created', 'member.joined', 'member.left', 'channel.created'] as const;
const ACTION_TYPES = ['sendMessage', 'sendDm', 'addRole', 'removeRole'] as const;

const TriggerFilterSchema = z
  .object({
    channelId: z.string().optional(),
    contains: z.string().max(200).optional(),
  })
  .strict();

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sendMessage'),
    channelId: z.string(),
    content: z.string().min(1).max(1500),
  }),
  z.object({
    type: z.literal('sendDm'),
    content: z.string().min(1).max(1500),
  }),
  z.object({
    type: z.literal('addRole'),
    roleId: z.string(),
  }),
  z.object({
    type: z.literal('removeRole'),
    roleId: z.string(),
  }),
]);

const CreateSchema = z.object({
  name: z.string().min(3).max(100),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerFilter: TriggerFilterSchema.default({}),
  actions: z.array(ActionSchema).min(1).max(5),
});

export interface AgentAutomationRow {
  id: string;
  name: string;
  triggerType: string;
  triggerFilter: string;
  actions: string;
  enabled: boolean;
  createdByUserId: string;
}

/** Contexte d'exécution passé par les listeners. */
export interface AutomationEventContext {
  guildId: string;
  channelId: string;
  userId?: string;
  member?: GuildMember | PartialGuildMember;
}

@Injectable()
export class AutomationsService implements SpraxiumOnBoot {
  private readonly log = new Logger('Automations');
  /** Cache des automatisations actives par serveur (TTL 30s). */
  private readonly cache = new Map<string, { rows: AgentAutomationRow[]; fetchedAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly client: Client,
  ) {}

  onBoot(): void {
    // Le ToolRegistryModule est déjà chargé au premier boot transitif : le
    // registry s'obtient via l'accesseur runtime (pas d'injection DI).
    const registry = getToolRegistry();
    for (const tool of this.buildTools()) registry.register(tool);
  }

  private async invalidate(guildId: string): Promise<void> {
    this.cache.delete(guildId);
  }

  private async activeFor(guildId: string, triggerType: string): Promise<AgentAutomationRow[]> {
    const cached = this.cache.get(guildId);
    if (!cached || Date.now() - cached.fetchedAt > 30_000) {
      // Fetch NON filtré par triggerType : le cache est partagé par TOUS les
      // triggers du serveur. (Bug fix : filtrer à l'écriture rendait les
      // autres triggers invisibles pendant tout le TTL — une automatisation
      // member.joined ne se déclenchait jamais après un message.created.)
      const rows = (await this.prisma.agentAutomation.findMany({
        where: { guildId, enabled: true },
        orderBy: { createdAt: 'asc' },
      })) as AgentAutomationRow[];
      this.cache.set(guildId, { rows, fetchedAt: Date.now() });
      return rows.filter((row) => row.triggerType === triggerType);
    }
    return cached.rows.filter((row) => row.triggerType === triggerType);
  }

  /** Filtres : channelId (salon concerné) et contains (sous-chaîne du contenu). */
  private matchesFilter(row: AgentAutomationRow, ctx: AutomationEventContext, content?: string): boolean {
    let filter: { channelId?: string; contains?: string } = {};
    try {
      filter = JSON.parse(row.triggerFilter ?? '{}');
    } catch {
      /* filtre vide */
    }
    if (filter.channelId && filter.channelId !== ctx.channelId) return false;
    if (filter.contains && (!content || !content.toLowerCase().includes(filter.contains.toLowerCase()))) return false;
    return true;
  }

  /** Point d'entrée des listeners : exécute toutes les automatisations qui matchent. */
  async handleEvent(triggerType: (typeof TRIGGER_TYPES)[number], ctx: AutomationEventContext, content?: string): Promise<void> {
    const rows = await this.activeFor(ctx.guildId, triggerType);
    for (const row of rows) {
      if (!this.matchesFilter(row, ctx, content)) continue;
      await this.executeActions(row, ctx);
    }
  }

  private async executeActions(row: AgentAutomationRow, ctx: AutomationEventContext): Promise<void> {
    const guild = this.client.guilds.cache.get(ctx.guildId);
    if (!guild) return;
    let actions: Array<z.infer<typeof ActionSchema>> = [];
    try {
      actions = z.array(ActionSchema).parse(JSON.parse(row.actions ?? '[]'));
    } catch {
      this.log.warn(`Actions illisibles pour « ${row.name} » : ignorées.`);
      return;
    }

    const me = guild.members.me;
    const member = ctx.member ?? (ctx.userId ? await guild.members.fetch(ctx.userId).catch(() => null) : null);
    // Vocabulaire de templates UNIFIÉ ({{user.mention}} etc., comme welcome)
    // + les clés courtes historiques conservées pour compat des automatisations existantes.
    const vars = {
      user: ctx.userId ? `<@${ctx.userId}>` : '',
      'user.name': member?.displayName ?? '',
      'user.mention': ctx.userId ? `<@${ctx.userId}>` : '',
      server: guild.name,
      'server.name': guild.name,
      count: String(guild.memberCount),
      'member.count': String(guild.memberCount),
    };
    const render = (text: string): string => renderTemplate(text, vars);

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'sendMessage': {
            if (!me?.permissions.has(PermissionFlagsBits.SendMessages)) throw new Error('Bot sans SendMessages.');
            const channel = await this.client.channels.fetch(action.channelId).catch(() => null);
            if (!channel?.isTextBased() || !('send' in channel)) throw new Error('Salon de destination introuvable.');
            await channel.send(render(action.content));
            break;
          }
          case 'sendDm': {
            if (!ctx.userId) throw new Error('Aucun utilisateur cible pour le DM.');
            const target = await guild.members.fetch(ctx.userId).catch(() => null);
            if (!target) throw new Error('Membre cible introuvable.');
            await target.send(render(action.content)).catch(() => {
              throw new Error('DM fermés.');
            });
            break;
          }
          case 'addRole': {
            if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Bot sans ManageRoles.');
            if (!member) throw new Error('Membre cible introuvable.');
            await member.roles.add(action.roleId, `automation « ${row.name} »`);
            break;
          }
          case 'removeRole': {
            if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Bot sans ManageRoles.');
            if (!member) throw new Error('Membre cible introuvable.');
            await member.roles.remove(action.roleId, `automation « ${row.name} »`);
            break;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log.warn(`Action ${action.type} échouée (« ${row.name} ») : ${message}`);
        this.audit.record({
          guildId: ctx.guildId,
          source: 'agent',
          action: 'automation.action.failed',
          metadata: { automation: row.name, type: action.type, reason: message.slice(0, 200) },
        });
      }
    }
    this.audit.record({
      guildId: ctx.guildId,
      source: 'agent',
      action: 'automation.executed',
      metadata: { automation: row.name, trigger: row.triggerType, actions: actions.length },
    });
  }

  private buildTools(): BotTool[] {
    const guildOf = (ctx: { guildId: string | null }): string | null => ctx.guildId;

    return [
      {
        name: 'createAutomation',
        description:
          'Crée une automatisation durable : un trigger Discord (message.created / member.joined / member.left / channel.created, avec filtres salon + contenu) et 1 à 5 actions (sendMessage, sendDm, addRole, removeRole). Les actions s\u2019exécutent à chaque match.',
        category: 'agent',
        paramsSchema: CreateSchema,
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt:
          'GATE : ManageGuild requis. Utilise-le APRÈS avoir posé tes questions et récapitulé (pattern skills). Variables de template dans les contenus : {{user}}, {{user.name}}, {{server}}, {{count}}. Les permissions du BOT sont vérifiées à l\u2019exécution : si le bot manque de SendMessages/ManageRoles, l\u2019action échouera avec un audit clair.',
        handler: async (input, ctx) => {
          const guildId = guildOf(ctx);
          if (!guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          try {
            const parsed = CreateSchema.parse(input);
            const created = await this.prisma.agentAutomation.create({
              data: {
                guildId,
                name: parsed.name,
                triggerType: parsed.triggerType,
                triggerFilter: JSON.stringify(parsed.triggerFilter),
                actions: JSON.stringify(parsed.actions),
                createdByUserId: ctx.userId,
              },
            });
            await this.invalidate(guildId);
            this.audit.record({
              guildId,
              source: 'agent',
              action: 'automation.created',
              actorId: ctx.userId,
              metadata: { id: created.id, name: parsed.name, trigger: parsed.triggerType, actions: parsed.actions.length },
            });
            return {
              ok: true,
              summary: `Automatisation « ${parsed.name} » créée (${parsed.triggerType}, ${parsed.actions.length} action(s)).`,
              data: { automationId: created.id },
            };
          } catch (error) {
            return { ok: false, summary: error instanceof Error ? error.message.slice(0, 200) : 'Création impossible.' };
          }
        },
      },
      {
        name: 'listAutomations',
        description: 'Liste les automatisations du serveur (nom, trigger, actions, active/inactive).',
        category: 'agent',
        paramsSchema: z.record(z.string(), z.unknown()),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Read-only. À appeler avant une suppression ou modification.',
        handler: async (_input, ctx) => {
          const guildId = guildOf(ctx);
          if (!guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const rows = await this.prisma.agentAutomation.findMany({
            where: { guildId, enabled: true },
            orderBy: { createdAt: 'asc' },
          });
          const lines = rows.map(
            (row) => `- ${row.name} (${row.triggerType}${row.enabled ? '' : ', inactive'}, id ${row.id.slice(-6)})`,
          );
          return { ok: true, summary: `${rows.length} automatisation(s) : ${lines.join(' | ') || 'aucune'}`, data: { automations: rows } };
        },
      },
      {
        name: 'deleteAutomation',
        description: 'Supprime (définitivement) une automatisation par id.',
        category: 'agent',
        paramsSchema: z.object({ automationId: z.string().min(1) }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Résous l\u2019id via listAutomations d\u2019abord.',
        handler: async (input, ctx) => {
          const guildId = guildOf(ctx);
          if (!guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { automationId } = input as { automationId: string };
          const row = await this.prisma.agentAutomation.findFirst({ where: { guildId, id: automationId } });
          if (!row) return { ok: false, summary: 'Automatisation introuvable.' };
          await this.prisma.agentAutomation.delete({ where: { id: row.id } });
          await this.invalidate(guildId);
          this.audit.record({
            guildId,
            source: 'agent',
            action: 'automation.deleted',
            actorId: ctx.userId,
            metadata: { name: row.name },
          });
          return { ok: true, summary: `Automatisation « ${row.name} » supprimée.` };
        },
      },
    ];
  }
}
