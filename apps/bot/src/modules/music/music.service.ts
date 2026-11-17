import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client } from 'discord.js';
import { z } from 'zod';
import type { BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import { safeFetch } from '../../shared/utils/safe-fetch';
import { AppEnv } from '../../app.env';
import { getToolRegistry } from '../tool-registry/tool-registry.service';

/**
 * Génération musicale via kie.ai (Suno, V6). Clé KIE_API_KEY requise.
 * Asynchrone : createTask renvoie un taskId, le tool sonde recordInfo puis
 * livre l'audio. Pattern UX demandé : UN message de progression mis à jour
 * à chaque étape (vérif → requête envoyée → génération → prêt), le fichier
 * audio part en message séparé (Discord ne permet pas d'ajouter une pièce
 * jointe à un message existant par edit).
 */

const API_BASE = 'https://api.kie.ai/api/v1';
const POLL_INTERVAL_MS = 6_000;
const POLL_MAX_MS = 150_000;

interface SunoTrack {
  audio_url?: string;
  title?: string;
  duration?: number;
}

@Injectable()
export class MusicService implements SpraxiumOnBoot {
  private readonly log = new Logger('Music');

  constructor(
    private readonly env: AppEnv,
    private readonly client: Client,
  ) {}

  onBoot(): void {
    this.log.info(
      this.env.KIE_API_KEY ? `Music enabled (kie.ai, model ${this.env.KIE_MODEL}).` : 'Music disabled: KIE_API_KEY absent.',
    );
    const registry = getToolRegistry();
    for (const tool of this.buildTools()) registry.register(tool);
  }

  private apiKey(): string | null {
    return this.env.KIE_API_KEY || null;
  }

  private buildTools(): BotTool[] {
    const guildOnly = (ctx: ToolRunContext): ctx is ToolRunContext & { guildId: string } =>
      ctx.guildId !== null;

    const tools: BotTool[] = [
      {
        name: 'generateMusic',
        description:
          'Génère une musique complète (Suno V6_MINI via kie.ai) : titre, style, paroles calibrées, instrumental, 1 min 30 max. Asynchrone (30-120s). Coûteux en crédits (12 crédits par génération, durée sans effet sur le prix) : une génération par demande.',
        category: 'music',
        paramsSchema: z.object({
          title: z.string().min(1).max(80),
          style: z.string().min(3).max(1000).describe('Ex: trap marseillais mélancolique, 90 bpm, piano sombre'),
          prompt: z.string().max(3000).optional().describe('Paroles complètes (chantées telles quelles) ou description libre si instrumental'),
          instrumental: z.boolean().default(false),
          duration: z.number().int().min(10).max(90).default(90).describe('Durée cible en secondes. Plafonnée à 90 : 1 min 30 maximum'),
        }),
        requiredModules: [],
        destructive: false,
        systemPrompt:
          'Coûteux en crédits : UNE génération par demande, jamais de variantes non demandées. ' +
          'Durée : 90 secondes max (1 min 30). CALIBRE les paroles sur la durée cible : UN couplet + UN refrain + une fin ' +
          '(tags [Verse]/[Chorus]/[Outro]) qui se termine NATURELLEMENT dans la durée — jamais de couplets supplémentaires, ' +
          'sinon Suno coupe le morceau en plein texte. Adaptation requise : un son rapide (trap, drill) tient moins de texte ' +
          'qu\u0027une ballade ; réduis le nombre de lignes si le débit est élevé. ' +
          'Si le thème est éditorial (la vie actuelle, actu, société, fait divers) : fais de VRAIES recherches d\u0029abord (searchInternet, getNews) et écris des paroles qui parlent du VRAI (faits concrets, références datées) — pas de paroles génériques. ' +
          'Référence d\u0029artiste (« à la Booba », « style Simone »...) : ne passe JAMAIS le nom au prompt Suno (rejet copyright) — traduis en caractéristiques objectives : voix (grave, posée), époque (boom-bap 90s, trap moderne), ambiance, débit, instruments typiques. ' +
          'Le fichier audio est posté automatiquement dans le salon : ne répète pas l\u0027URL, commente le résultat en UN message court. ' +
          'data.audioUrl alimente voice.play si l\u0027utilisateur veut écouter en vocal.',
        handler: async (input, ctx) => {
          if (!guildOnly(ctx)) return { ok: false, summary: 'Contexte de serveur requis.' };
          const key = this.apiKey();
          if (!key) return { ok: false, summary: 'Génération musicale désactivée : KIE_API_KEY absente de la configuration.' };
          const { title, style, prompt, instrumental, duration } = input as {
            title: string;
            style: string;
            prompt?: string;
            instrumental?: boolean;
            duration?: number;
          };

          // Progression dans LA ligne de statut (ctx.progress). La seule
          // livraison visible : le fichier audio lui-même.
          const progressChannel = ctx.channelId
            ? await this.client.channels.fetch(ctx.channelId).catch(() => null)
            : null;
          const update = async (message: string): Promise<void> => {
            await ctx.progress?.(message);
          };

          const created = await safeFetch(`${API_BASE}/jobs/createTask`, {
            timeoutMs: 30_000,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: 'ai-music-api/generate',
              input: {
                custom_mode: true,
                model: this.env.KIE_MODEL || 'V6_MINI',
                title,
                style,
                prompt: instrumental ? undefined : prompt,
                instrumental: instrumental ?? false,
                // Valable uniquement en custom_mode + V6/V6_MINI/V6_WILD (doc kie.ai).
                duration: duration ?? 60,
              },
            }),
          });
          const createdData = (await created.json().catch(() => ({}))) as { code?: number; data?: { taskId?: string }; msg?: string };
          if (createdData.code !== 200 || !createdData.data?.taskId) {
            await update('musique : génération refusée par kie.ai');
            return { ok: false, summary: `Génération refusée par kie.ai : ${createdData.msg ?? 'erreur inconnue'}` };
          }

          await update(`musique : génération lancée (Suno ${this.env.KIE_MODEL || 'V6_MINI'}, cible ${duration ?? 90}s)`);

          // Poll jusqu'à complétion.
          const deadline = Date.now() + POLL_MAX_MS;
          let elapsed = 0;
          while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
            elapsed += POLL_INTERVAL_MS / 1000;
            await update(`musique : génération en cours... ${elapsed}s`);
            const record = await safeFetch(`${API_BASE}/jobs/recordInfo?taskId=${createdData.data.taskId}`, {
              timeoutMs: 15_000,
              headers: { Authorization: `Bearer ${key}` },
            });
            const recordData = (await record.json().catch(() => ({}))) as {
              data?: { response?: { data?: SunoTrack[] } };
            };
            const track = recordData.data?.response?.data?.[0];
            if (track?.audio_url) {
              // Une seule livraison : le fichier ci-dessous, sans autre message.
              const seconds = Math.round(track.duration ?? 0);
              await update(`musique prête (${seconds}s) — envoi du fichier`);
              if (progressChannel?.isTextBased() && 'send' in progressChannel) {
                const destination = progressChannel as import('discord.js').TextChannel;
                const audio = await fetch(track.audio_url).then((res) => res.arrayBuffer()).catch(() => null);
                if (audio) {
                  await destination
                    .send({
                      content: `**${track.title ?? title}** (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')})`,
                      files: [{ name: `${(track.title ?? title).replace(/[^a-zA-Z0-9-_]/gu, '-').slice(0, 40)}.mp3`, attachment: Buffer.from(audio) }],
                    })
                    .catch(() => {});
                }
              }
              return {
                ok: true,
                summary:
                  `Musique « ${track.title ?? title} » (${seconds}s) postée en pièce jointe dans le salon. ` +
                  'NE RÉPONDS RIEN : le fichier et le titre suffisent (sauf si un titre manquait, donne-le en une ligne).',
                data: { audioUrl: track.audio_url, taskId: createdData.data.taskId, duration: seconds },
              };
            }
          }
          await update('musique : dépasse 150s, le track arrivera — réessaie dans une minute');
          return { ok: false, summary: 'La génération dépasse 150 secondes : réessaie dans une minute, le track arrivera.' };
        },
      },
    ];
    return tools;
  }
}
