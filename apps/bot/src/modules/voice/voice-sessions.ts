import { Logger } from '@spraxium/logger';
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
} from '@discordjs/voice';
import { StreamType } from '@discordjs/voice';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { assertSafeUrl } from '../../shared/utils/safe-fetch';
import type { GuildVoiceState, QueueTrack } from './voice.types';

/**
 * Sessions vocales par serveur : un player, un processus ffmpeg, une file
 * d'attente et la piste en cours. Assure l'enchaînement des pistes et la
 * libération complète d'une session (ffmpeg, player, connexion).
 */
export class VoiceSessions {
  private readonly log = new Logger('Voice');
  private readonly states = new Map<string, GuildVoiceState>();

  /** Session du serveur, créée à la demande avec son player (fin de piste : piste suivante). */
  stateFor(guildId: string): GuildVoiceState {
    let state = this.states.get(guildId);
    if (!state) {
      const player = createAudioPlayer();
      state = { connection: null, player, ffmpeg: null, queue: [], nowPlaying: null };
      this.states.set(guildId, state);
      // Fin de piste → suivante, sinon le player repasse idle.
      player.on(AudioPlayerStatus.Idle, () => this.onTrackEnd(guildId));
      player.on('error', (error) => {
        this.log.warn(`player error: ${error.message.slice(0, 120)}`);
        this.onTrackEnd(guildId);
      });
    }
    return state;
  }

  /** Session existante du serveur, sans en créer une (absente si le bot n'a rien lancé dessus). */
  stateOf(guildId: string): GuildVoiceState | undefined {
    return this.states.get(guildId);
  }

  private onTrackEnd(guildId: string): void {
    const state = this.stateFor(guildId);
    this.killFfmpeg(state);
    const next = state.queue.shift();
    if (next) this.startTrack(guildId, next);
    else state.nowPlaying = null;
  }

  killFfmpeg(state: GuildVoiceState): void {
    if (state.ffmpeg) {
      state.ffmpeg.kill('SIGKILL');
      state.ffmpeg = null;
    }
  }

  /**
   * Streame une URL audio via ffmpeg → PCM brut pour le player. L'URL est
   * validée (https, host non privé) AVANT le spawn ; retourne false si le
   * lancement échoue (URL refusée ou ffmpeg absent).
   */
  startTrack(guildId: string, track: QueueTrack): boolean {
    const state = this.stateFor(guildId);
    const bin = ffmpegPath as string | null;
    if (!bin) {
      this.log.error('ffmpeg-static binaire introuvable');
      return false;
    }
    let safeUrl: string;
    try {
      safeUrl = assertSafeUrl(track.url).toString();
    } catch (error) {
      this.log.warn(`URL refusée pour ffmpeg : ${(error as Error).message.slice(0, 120)}`);
      return false;
    }
    const ffmpeg = spawn(bin, ['-i', safeUrl, '-loglevel', 'error', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1']);
    state.ffmpeg = ffmpeg;
    state.nowPlaying = track;
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      const line = chunk.toString().slice(0, 160);
      if (line.trim()) this.log.warn(`ffmpeg: ${line}`);
    });
    const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
    state.player.play(resource);
    return true;
  }

  /** Libère tout ce que le serveur occupait : ffmpeg, player, connexion, puis oublie la session. */
  cleanupGuild(guildId: string): void {
    const state = this.states.get(guildId);
    if (!state) return;
    this.killFfmpeg(state);
    state.player.stop(true);
    state.connection?.destroy();
    this.states.delete(guildId);
  }
}
