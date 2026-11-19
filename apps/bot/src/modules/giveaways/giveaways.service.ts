import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client, ChannelType, PermissionFlagsBits } from 'discord.js';
import { GiveawaysManager } from 'discord-giveaways';
import { z } from 'zod';
import type { BotTool, ToolResult } from '@10cordes/shared';
import { getToolRegistry } from '../tool-registry/tool-registry.service';

/**
 * Giveaways gérés par l'agent (lib discord-giveaways v6) : annonce 🎉,
 * participation par réaction, multi-gagnants, drop (premier arrivé), pause,
 * reroll. La lib poste et édite ses propres messages ; les tools se contentent
 * de piloter le cycle de vie. Stockage JSON dans data/ (répertoire gitignoré).
 */

@Injectable()
export class GiveawaysService implements SpraxiumOnBoot {
  private readonly log = new Logger('Giveaways');
  private manager: GiveawaysManager | null = null;

  constructor(private readonly client: Client) {}

  onBoot(): void {
    try {
      this.manager = new GiveawaysManager(
        this.client,
        {
          storage: 'data/giveaways.json',
          default: {
            botsCanWin: false,
            embedColor: '#d95926',
            reaction: '🎉',
            lastChance: { enabled: true, threshold: 10_000, embedColor: '#e8b23b' },
          },
        },
        true,
      );
    } catch (error) {
      this.log.error(`Init giveaways impossible : ${(error as Error).message.slice(0, 140)}`);
      return;
    }
    for (const tool of this.buildTools()) getToolRegistry().register(tool);
    this.log.info(`${this.buildTools().length} tools giveaways enregistrés.`);
  }

  private managerOrError(): GiveawaysManager | ToolResult {
    if (!this.manager) return { ok: false, summary: 'Module giveaways indisponible (init échouée).' };
    return this.manager;
  }

  private textChannelOf(guildId: string, channelId: string) {
    return this.client.channels.fetch(channelId).catch(() => null);
  }

  private buildTools(): BotTool[] {
    const managerOf = (): GiveawaysManager | null => this.manager;

    return [
      {
        name: 'giveaway.start',
        description:
          'Lance un giveaway 🎉 : annonce embed, participation par réaction, tirage automatique à l\u0029échéance. Pour un DROP (premier arrivé gagnant), utilise giveaway.drop.',
        category: 'giveaways',
        paramsSchema: z.object({
          channelId: z.string().min(1),
          durationMinutes: z.number().int().min(1).max(20_160).describe('Durée en minutes (1 min à 14 jours)'),
          winnerCount: z.number().int().min(1).max(20).default(1),
          prize: z.string().min(1).max(200),
        }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt:
          'Le tirage est AUTOMATIQUE à l\u0029échéance : ne promets jamais de tirer à la main. Une fois lancé, réponds en UNE phrase courte (heure de fin + lots) sans répéter l\u0029embed. Questions préalables si la durée/le prix manquent.',
        handler: async (input, ctx) => {
          const manager = managerOf();
          if (!manager) return this.managerOrError() as ToolResult;
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { channelId, durationMinutes, winnerCount, prize } = input as {
            channelId: string;
            durationMinutes: number;
            winnerCount?: number;
            prize: string;
          };
          const channel = await this.textChannelOf(ctx.guildId, channelId);
          if (!channel || channel.type !== ChannelType.GuildText) {
            return { ok: false, summary: 'Salon cible introuvable ou non textuel.' };
          }
          const me = this.client.guilds.cache.get(ctx.guildId)?.members.me;
          if (!me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return { ok: false, summary: "Le bot n'a pas la permission ManageMessages sur ce serveur." };
          }
          const giveaway = await manager.start(channel, {
            duration: (durationMinutes ?? 10) * 60_000,
            winnerCount: winnerCount ?? 1,
            prize,
          });
          return {
            ok: true,
            summary: `Giveaway « ${prize} » lancé dans <#${channelId}> : ${winnerCount ?? 1} gagnant(s), tirage dans ${durationMinutes} min.`,
            data: { messageId: giveaway.messageId, endAt: giveaway.endAt },
          };
        },
      },
      {
        name: 'giveaway.drop',
        description: 'Giveaway DROP : le premier arrivé réagit 🎉 et gagne immédiatement (durée nulle).',
        category: 'giveaways',
        paramsSchema: z.object({
          channelId: z.string().min(1),
          winnerCount: z.number().int().min(1).max(20).default(1),
          prize: z.string().min(1).max(200),
        }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Mode express : se termine dès que le nombre de participants atteint le nombre de gagnants.',
        handler: async (input, ctx) => {
          const manager = managerOf();
          if (!manager) return this.managerOrError() as ToolResult;
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { channelId, winnerCount, prize } = input as { channelId: string; winnerCount?: number; prize: string };
          const channel = await this.textChannelOf(ctx.guildId, channelId);
          if (!channel || channel.type !== ChannelType.GuildText) {
            return { ok: false, summary: 'Salon cible introuvable ou non textuel.' };
          }
          const giveaway = await manager.start(channel, {
            duration: 0,
            winnerCount: winnerCount ?? 1,
            prize,
            isDrop: true,
          });
          return {
            ok: true,
            summary: `Drop « ${prize} » lancé dans <#${channelId}> : le premier arrivé gagne.`,
            data: { messageId: giveaway.messageId },
          };
        },
      },
      {
        name: 'giveaway.end',
        description: 'Termine un giveaway en cours immédiatement et tire les gagnants.',
        category: 'giveaways',
        paramsSchema: z.object({ messageId: z.string().min(1) }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: true,
        systemPrompt: 'Clôture anticipée. Utilise giveaway.list d\u0029abord si l\u0029utilisateur ne donne pas l\u0029ID du message.',
        handler: async (input, ctx) => {
          const manager = managerOf();
          if (!manager) return this.managerOrError() as ToolResult;
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { messageId } = input as { messageId: string };
          const giveaway = manager.giveaways.find((g) => g.messageId === messageId && g.guildId === ctx.guildId);
          if (!giveaway) return { ok: false, summary: 'Giveaway introuvable pour ce message.' };
          const winners = await manager.end(messageId);
          return { ok: true, summary: `Giveaway « ${giveaway.prize} » terminé : ${winners.length} gagnant(s) tiré(s).` };
        },
      },
      {
        name: 'giveaway.reroll',
        description: 'Retire de nouveaux gagnants pour un giveaway terminé.',
        category: 'giveaways',
        paramsSchema: z.object({ messageId: z.string().min(1), winnerCount: z.number().int().min(1).max(20).optional() }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Reroll d\u0029un giveaway terminé (nouveau tirage parmi les participants).',
        handler: async (input, ctx) => {
          const manager = managerOf();
          if (!manager) return this.managerOrError() as ToolResult;
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { messageId, winnerCount } = input as { messageId: string; winnerCount?: number };
          const winners = await manager.reroll(messageId, { winnerCount });
          return { ok: true, summary: `Reroll effectué : ${winners.length} nouveau(x) gagnant(s).` };
        },
      },
      {
        name: 'giveaway.pause',
        description: 'Met en pause un giveaway en cours (durée gelée). Utilise giveaway.unpause pour reprendre.',
        category: 'giveaways',
        paramsSchema: z.object({ messageId: z.string().min(1) }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Pause du compte à rebours. unpause pour reprendre.',
        handler: async (input) => {
          const manager = managerOf();
          if (!manager) return this.managerOrError() as ToolResult;
          const { messageId } = input as { messageId: string };
          await manager.pause(messageId);
          return { ok: true, summary: 'Giveaway en pause.' };
        },
      },
      {
        name: 'giveaway.unpause',
        description: 'Reprend un giveaway en pause.',
        category: 'giveaways',
        paramsSchema: z.object({ messageId: z.string().min(1) }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Reprise du compte à rebours.',
        handler: async (input) => {
          const manager = managerOf();
          if (!manager) return this.managerOrError() as ToolResult;
          const { messageId } = input as { messageId: string };
          await manager.unpause(messageId);
          return { ok: true, summary: 'Giveaway repris.' };
        },
      },
      {
        name: 'giveaway.list',
        description: 'Liste les giveaways du serveur : en cours et terminés récents.',
        category: 'giveaways',
        paramsSchema: z.object({}),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Read-only. Présente le résultat en liste [PANEL] si demandé publiquement.',
        handler: async (_input, ctx) => {
          const manager = managerOf();
          if (!manager) return this.managerOrError() as ToolResult;
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const mine = manager.giveaways.filter((g) => g.guildId === ctx.guildId);
          const running = mine.filter((g) => !g.ended);
          const ended = mine.filter((g) => g.ended).slice(-5);
          const lines = [
            ...running.map((g) => `EN COURS : « ${g.prize} » → <#${g.channelId}> (<t:${Math.floor(g.endAt / 1000)}:R>)`),
            ...ended.map((g) => `terminé : « ${g.prize} » → <#${g.channelId}>`),
          ];
          return { ok: true, summary: `${mine.length} giveaway(s) : ${lines.join(' | ') || 'aucun'}` };
        },
      },
    ];
  }
}
