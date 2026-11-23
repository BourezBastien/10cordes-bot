import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client, type Guild, type VoiceBasedChannel } from 'discord.js';
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import { StreamType } from '@discordjs/voice';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';
import ffmpegPath from 'ffmpeg-static';
import type { BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { assertSafeUrl } from '../../shared/utils/safe-fetch';

/**
 * Lecture audio en vocal (@discordjs/voice). Stack 100 % pure JS (Node 27
 * alpha sans prebuilds natifs) : opusscript (encodage), libsodium-wrappers
 * (chiffrement), ffmpeg-static (transcodage mp3 → PCM). Un player par
 * serveur avec file d'attente ; le bot rejoint le vocal de l'appelant ou un
 * salon précisé, puis streame des URLs https directes (ex : pistes kie.ai).
 * URLs validées par assertSafeUrl avant le spawn ffmpeg (SSRF + injection
 * d'arguments) : jamais localhost / privé, https uniquement.
 */

interface QueueTrack {
  title: string;
  url: string;
}

interface GuildVoiceState {
  connection: VoiceConnection | null;
  player: AudioPlayer;
  ffmpeg: ChildProcessWithoutNullStreams | null;
  queue: QueueTrack[];
  nowPlaying: QueueTrack | null;
}

const JOIN_TIMEOUT_MS = 15_000;
const MAX_QUEUE = 20;

@Injectable()
export class VoiceService implements SpraxiumOnBoot {
  private readonly log = new Logger('Voice');
  private readonly states = new Map<string, GuildVoiceState>();

  constructor(private readonly client: Client) {}

  onBoot(): void {
    const registry = getToolRegistry();
    for (const tool of this.buildTools()) registry.register(tool);
    this.log.info(`${this.buildTools().length} tools vocal enregistrés (opusscript + libsodium + ffmpeg-static).`);
  }

  private stateFor(guildId: string): GuildVoiceState {
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

  private onTrackEnd(guildId: string): void {
    const state = this.stateFor(guildId);
    this.killFfmpeg(state);
    const next = state.queue.shift();
    if (next) this.startTrack(guildId, next);
    else state.nowPlaying = null;
  }

  private killFfmpeg(state: GuildVoiceState): void {
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
  private startTrack(guildId: string, track: QueueTrack): boolean {
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

  private voiceChannelOf(guild: Guild, channelId: string | null): VoiceBasedChannel | null {
    if (!channelId) return null;
    const channel = guild.channels.cache.get(channelId);
    return channel?.isVoiceBased() ? channel : null;
  }

  /** Rejoint le vocal : salon explicite sinon le VC de l'appelant. */
  private async joinGuildChannel(guild: Guild, ctx: ToolRunContext, explicitChannelId?: string): Promise<ToolResult> {
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
    if (me && !channel.permissionsFor(me).has(['Connect', 'Speak'])) {
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
    const state = this.stateFor(guild.id);
    state.connection = connection;
    connection.on(VoiceConnectionStatus.Disconnected, () => this.cleanupGuild(guild.id));
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, JOIN_TIMEOUT_MS);
    } catch {
      connection.destroy();
      state.connection = null;
      return { ok: false, summary: `Impossible d\u0027établir la connexion vocale à #${channel.name} (timeout).` };
    }
    return { ok: true, summary: `Connecté au vocal #${channel.name}.`, data: { channelId: channel.id } };
  }

  private cleanupGuild(guildId: string): void {
    const state = this.states.get(guildId);
    if (!state) return;
    this.killFfmpeg(state);
    state.player.stop(true);
    state.connection?.destroy();
    this.states.delete(guildId);
  }

  private buildTools(): BotTool[] {
    const guildOnly = (ctx: ToolRunContext): ctx is ToolRunContext & { guildId: string } => ctx.guildId !== null;

    const resolveGuild = async (ctx: ToolRunContext): Promise<Guild | null> => {
      if (!guildOnly(ctx)) return null;
      return this.client.guilds.fetch(ctx.guildId).catch(() => null);
    };

    return [
      {
        name: 'voice.join',
        description: 'Fait rejoindre au bot un salon vocal : celui de l\u0027appelant par défaut, ou un salon précisé par nom.',
        category: 'voice',
        paramsSchema: z.object({
          channelName: z.string().max(100).optional().describe('Nom du salon vocal ; vide = le vocal actuel de l\u0027appelant'),
        }),
        requiredModules: [],
        destructive: false,
        systemPrompt:
          'Connecte le bot en vocal. Si l\u0027utilisateur donne un nom de salon, passe-le tel quel. Le bot reste muet tant que voice.play n\u0027est pas appelé.',
        handler: async (input, ctx) => {
          const guild = await resolveGuild(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { channelName } = input as { channelName?: string };
          let channelId: string | undefined;
          if (channelName) {
            const found = guild.channels.cache.find(
              (channel) => channel.isVoiceBased() && channel.name.toLowerCase() === channelName.toLowerCase(),
            );
            if (!found) return { ok: false, summary: `Salon vocal « ${channelName} » introuvable.` };
            channelId = found.id;
          }
          return this.joinGuildChannel(guild, ctx, channelId);
        },
      },
      {
        name: 'voice.play',
        description:
          'Joue une URL audio directe (https, mp3) en vocal avec file d\u0027attente (20 max). Rejoint automatiquement le vocal si nécessaire. Idéal avec l\u0027audioUrl de generateMusic.',
        category: 'voice',
        paramsSchema: z.object({
          url: z.string().url().max(2000).describe('URL audio https directe (ex : piste Suno kie.ai)'),
          title: z.string().min(1).max(80).default('piste'),
        }),
        requiredModules: [],
        destructive: false,
        systemPrompt:
          'Enchaîne naturel après generateMusic : data.audioUrl → voice.play. Si l\u0027utilisateur demande « mets-la en vocal », PAS besoin de redemander : joue la piste générée. Une seule mise en file par demande.',
        handler: async (input, ctx) => {
          const guild = await resolveGuild(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { url, title } = input as { url: string; title?: string };
          try {
            assertSafeUrl(url);
          } catch (error) {
            return { ok: false, summary: `URL refusée : ${(error as Error).message.slice(0, 120)}` };
          }
          const state = this.stateFor(guild.id);

          if (!getVoiceConnection(guild.id) || !state.connection) {
            const joined = await this.joinGuildChannel(guild, ctx);
            if (!joined.ok) return joined;
          }

          const track = { title: title ?? 'piste', url };
          if (state.nowPlaying || state.queue.length > 0) {
            if (state.queue.length >= MAX_QUEUE) {
              return { ok: false, summary: `File d\u0027attente pleine (${MAX_QUEUE} max) : demande voice.skip d\u0027abord.` };
            }
            state.queue.push(track);
            return {
              ok: true,
              summary: `« ${track.title} » ajouté en file (${state.queue.length} en attente).`,
              data: { queued: true, position: state.queue.length },
            };
          }
          if (!this.startTrack(guild.id, track)) {
            return { ok: false, summary: `Lancement impossible pour « ${track.title} » : URL refusée ou format non lisible par ffmpeg.` };
          }
          return {
            ok: true,
            summary: `« ${track.title} » en lecture dans le vocal.`,
            data: { queued: false },
          };
        },
      },
      {
        name: 'voice.skip',
        description: 'Passe à la piste suivante de la file (ou arrête la lecture si la file est vide).',
        category: 'voice',
        paramsSchema: z.object({}),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Skip simple, pas de confirmation nécessaire.',
        handler: async (_input, ctx) => {
          const guild = await resolveGuild(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const state = this.states.get(guild.id);
          if (!state?.nowPlaying) return { ok: false, summary: 'Rien n\u0027est en lecture.' };
          const remaining = state.queue.length;
          state.player.stop();
          return { ok: true, summary: remaining > 0 ? `Piste suivante lancée (${remaining} restantes).` : 'Lecture arrêtée (file vide).' };
        },
      },
      {
        name: 'voice.stop',
        description: 'Stoppe la lecture et vide la file d\u0027attente.',
        category: 'voice',
        paramsSchema: z.object({}),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Stop total de la file. Le bot reste connecté (voice.leave pour partir).',
        handler: async (_input, ctx) => {
          const guild = await resolveGuild(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const state = this.states.get(guild.id);
          if (!state || (!state.nowPlaying && state.queue.length === 0)) return { ok: false, summary: 'Rien à arrêter : file déjà vide.' };
          this.killFfmpeg(state);
          state.queue = [];
          state.nowPlaying = null;
          state.player.stop();
          return { ok: true, summary: 'Lecture stoppée, file vidée.' };
        },
      },
      {
        name: 'voice.leave',
        description: 'Quitte le salon vocal et nettoie la file.',
        category: 'voice',
        paramsSchema: z.object({}),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Part du vocal quand l\u0027utilisateur a fini d\u0027écouter.',
        handler: async (_input, ctx) => {
          const guild = await resolveGuild(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const state = this.states.get(guild.id);
          if (!state && !getVoiceConnection(guild.id)) return { ok: false, summary: 'Je ne suis pas en vocal sur ce serveur.' };
          this.cleanupGuild(guild.id);
          return { ok: true, summary: 'Quitté le vocal, file nettoyée.' };
        },
      },
      {
        name: 'voice.status',
        description: 'État vocal : salon connecté, piste en cours, longueur de la file.',
        category: 'voice',
        paramsSchema: z.object({}),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Utile avant play/skip pour connaître l\u0027état sans deviner.',
        handler: async (_input, ctx) => {
          const guild = await resolveGuild(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const state = this.states.get(guild.id);
          if (!state?.connection) return { ok: true, summary: 'Pas connecté en vocal sur ce serveur.', data: { connected: false } };
          const channelId = state.connection.joinConfig.channelId;
          const channel = channelId ? guild.channels.cache.get(channelId)?.name : '?';
          const track = state.nowPlaying?.title ?? 'rien';
          return {
            ok: true,
            summary: `Connecté à #${channel ?? '?'} ; en lecture : ${track} ; file : ${state.queue.length}.`,
            data: { connected: true, channel: channel ?? null, nowPlaying: track, queue: state.queue.length },
          };
        },
      },
    ];
  }
}
