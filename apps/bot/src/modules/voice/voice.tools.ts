import { getVoiceConnection } from '@discordjs/voice';
import type { Client, Guild } from 'discord.js';
import { z } from 'zod';
import type { BotTool, ToolRunContext } from '@10cordes/shared';
import { assertSafeUrl } from '../../shared/utils/safe-fetch';
import { MAX_QUEUE } from './voice.constants';
import type { VoiceConnectionManager } from './voice-connection';
import type { VoiceSessions } from './voice-sessions';

/** Ce dont les tools vocaux ont besoin : le client (serveur de la demande), les sessions et la connexion. */
export interface VoiceToolsDeps {
  readonly client: Client;
  readonly sessions: VoiceSessions;
  readonly connection: VoiceConnectionManager;
}

/**
 * Tools voice.* : rejoindre un vocal, jouer une URL, passer, arrêter, partir,
 * consulter l'état. Aucune permission Discord requise du côté de l'appelant.
 */
export function buildVoiceTools(deps: VoiceToolsDeps): BotTool[] {
  const { client, sessions, connection } = deps;
  const guildOnly = (ctx: ToolRunContext): ctx is ToolRunContext & { guildId: string } => ctx.guildId !== null;

  const resolveGuild = async (ctx: ToolRunContext): Promise<Guild | null> => {
    if (!guildOnly(ctx)) return null;
    return client.guilds.fetch(ctx.guildId).catch(() => null);
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
        return connection.joinGuildChannel(guild, ctx, channelId);
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
        const state = sessions.stateFor(guild.id);

        if (!getVoiceConnection(guild.id) || !state.connection) {
          const joined = await connection.joinGuildChannel(guild, ctx);
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
        if (!sessions.startTrack(guild.id, track)) {
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
        const state = sessions.stateOf(guild.id);
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
        const state = sessions.stateOf(guild.id);
        if (!state || (!state.nowPlaying && state.queue.length === 0)) return { ok: false, summary: 'Rien à arrêter : file déjà vide.' };
        sessions.killFfmpeg(state);
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
        const state = sessions.stateOf(guild.id);
        if (!state && !getVoiceConnection(guild.id)) return { ok: false, summary: 'Je ne suis pas en vocal sur ce serveur.' };
        sessions.cleanupGuild(guild.id);
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
        const state = sessions.stateOf(guild.id);
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
