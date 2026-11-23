import {
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import type { Guild, VoiceBasedChannel } from 'discord.js';
import type { ToolResult, ToolRunContext } from '@10cordes/shared';
import { botPermissionPolicy } from '../../core/security/bot-permission.policy';
import { JOIN_TIMEOUT_MS } from './voice.constants';
import type { VoiceSessions } from './voice-sessions';

/**
 * Connexion vocale d'un serveur : choisit le salon (salon explicite, sinon
 * celui de l'appelant), vérifie que le bot peut y entrer et y parler, puis
 * le rejoint et attend que la connexion soit prête.
 */
export class VoiceConnectionManager {
  constructor(private readonly sessions: VoiceSessions) {}

  private voiceChannelOf(guild: Guild, channelId: string | null): VoiceBasedChannel | null {
    if (!channelId) return null;
    const channel = guild.channels.cache.get(channelId);
    return channel?.isVoiceBased() ? channel : null;
  }

  /** Rejoint le vocal : salon explicite sinon le VC de l'appelant. */
  async joinGuildChannel(guild: Guild, ctx: ToolRunContext, explicitChannelId?: string): Promise<ToolResult> {
    const me = guild.members.me;
    let channel: VoiceBasedChannel | null = this.voiceChannelOf(guild, explicitChannelId ?? null);
    if (!channel) {
      const member = await guild.members.fetch(ctx.userId).catch(() => null);
      channel = member?.voice.channel ?? null;
      if (!channel) {
        return {
          ok: false,
          summary: 'Tu n\u0027es pas en vocal et aucun salon vocal précisé : rejoins un vocal ou donne son nom.',
        };
      }
    }
    if (me && !botPermissionPolicy.canAllInChannel(channel, ['Connect', 'Speak'])) {
      return {
        ok: false,
        summary: `Permissions manquantes pour #${channel.name} : j\u0027ai besoin de Connect et Speak (réglage Discord).`,
      };
    }

    const existing = getVoiceConnection(guild.id);
    existing?.destroy();
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    const state = this.sessions.stateFor(guild.id);
    state.connection = connection;
    connection.on(VoiceConnectionStatus.Disconnected, () => this.sessions.cleanupGuild(guild.id));
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, JOIN_TIMEOUT_MS);
    } catch {
      connection.destroy();
      state.connection = null;
      return { ok: false, summary: `Impossible d\u0027établir la connexion vocale à #${channel.name} (timeout).` };
    }
    return { ok: true, summary: `Connecté au vocal #${channel.name}.`, data: { channelId: channel.id } };
  }
}
