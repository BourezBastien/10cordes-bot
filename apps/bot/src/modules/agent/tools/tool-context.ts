import type { AdminOp, ToolResult, ToolRunContext } from '@10cordes/shared';
import type { Client, Guild, NewsChannel, TextChannel, ThreadChannel } from 'discord.js';
import type { AgentService } from '../agent.service';

/** Salon dans lequel le bot peut envoyer un message et lire l'historique. */
export type WritableTextChannel = TextChannel | NewsChannel | ThreadChannel;

/**
 * Contexte partagé par tous les tools Discord de l'agent : résolution du
 * serveur de la demande, refus standard, exécution d'une op d'administration
 * (gates et audit inclus dans AgentService), résolution d'un salon textuel.
 *
 * Aucun tool ne vérifie une permission Discord lui-même : les policies de
 * `core/security` s'en chargent, le registry applique `permissions`.
 */
export interface DiscordToolContext {
  /** Serveur de la demande (null hors serveur). */
  guildOf: (ctx: ToolRunContext) => Guild | null;
  /** Refus standard hors serveur. */
  noGuild: () => ToolResult;
  /** Exécution directe d'une op via AgentService. */
  executeDirectOp: (ctx: ToolRunContext, op: AdminOp) => Promise<ToolResult>;
  /** Salon textuel complet (null si introuvable, non textuel ou partiel). */
  textChannelOf: (guild: Guild, channelId: string) => Promise<WritableTextChannel | null>;
}

/** Raison d'audit jointe à chaque mutation de salon, rôle ou membre. */
export function agentReason(ctx: ToolRunContext): string {
  return `agent tool (by <@${ctx.userId}>)`;
}

export function createDiscordToolContext(agent: AgentService, client: Client): DiscordToolContext {
  const guildOf = (ctx: ToolRunContext): Guild | null =>
    ctx.guildId ? (client.guilds.cache.get(ctx.guildId) ?? null) : null;

  return {
    guildOf,
    noGuild: (): ToolResult => ({ ok: false, summary: 'Contexte de serveur requis.' }),
    executeDirectOp: async (ctx: ToolRunContext, op: AdminOp): Promise<ToolResult> => {
      const guild = guildOf(ctx);
      if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
      const result = await agent.executeDirect(guild.id, ctx.userId, op);
      return { ok: result.ok, summary: `${result.label}${result.detail ? ` (${result.detail})` : ''}` };
    },
    textChannelOf: async (guild: Guild, channelId: string): Promise<WritableTextChannel | null> => {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      return channel && channel.isTextBased() && !channel.partial ? (channel as WritableTextChannel) : null;
    },
  };
}
