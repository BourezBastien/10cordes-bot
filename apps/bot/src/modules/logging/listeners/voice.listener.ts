import { Listener, On } from '@spraxium/common';
import { Events, type VoiceState } from 'discord.js';
import { LoggingService } from '../logging.service';

function channelLabel(state: VoiceState): string {
  return state.channelId ? `<#${state.channelId}>` : '—';
}

/** Logs vocaux : join/leave/move + détection stream / caméra (17✅). */
@Listener(Events.VoiceStateUpdate)
export class VoiceStateListener {
  constructor(private readonly logging: LoggingService) {}

  @On()
  async onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const guildId = newState.guild.id;
    const member = `<@${newState.id}>`;
    const lines: string[] = [];

    const moved = oldState.channelId !== newState.channelId;
    if (moved && !oldState.channelId) lines.push(`🔊 **${member}** a rejoint ${channelLabel(newState)}`);
    else if (moved && !newState.channelId) lines.push(`🔊 **${member}** a quitté ${channelLabel(oldState)}`);
    else if (moved) lines.push(`🔊 **${member}** : ${channelLabel(oldState)} → ${channelLabel(newState)}`);

    if (!oldState.streaming && newState.streaming) lines.push(`📺 **${member}** a commencé un stream dans ${channelLabel(newState)}`);
    if (oldState.streaming && !newState.streaming) lines.push(`📺 **${member}** a arrêté son stream`);
    if (!oldState.selfVideo && newState.selfVideo) lines.push(`🎥 **${member}** a activé sa caméra dans ${channelLabel(newState)}`);
    if (oldState.selfVideo && !newState.selfVideo) lines.push(`🎥 **${member}** a désactivé sa caméra`);

    if (lines.length === 0) return;
    await this.logging.log(guildId, 'voice', { title: '## 🔊 Vocal', lines });
  }
}
