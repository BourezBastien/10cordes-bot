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
          'Génère une musique complète (Suno V6_MINI via kie.ai) : titre, style, paroles, instrumental, 1 minute max. Asynchrone (30-120s). Coûteux en crédits (12 crédits par génération, durée sans effet sur le prix) : une génération par demande.',
        category: 'music',
        paramsSchema: z.object({
          title: z.string().min(1).max(80),
          style: z.string().min(3).max(1000).describe('Ex: trap marseillais mélancolique, 90 bpm, piano sombre'),
          prompt: z.string().max(3000).optional().describe('Paroles complètes (chantées telles quelles) ou description libre si instrumental'),
          instrumental: z.boolean().default(false),
          duration: z.number().int().min(10).max(60).default(60).describe('Durée cible en secondes. Plafonnée à 60 : une minute maximum, pas d\u0027exception'),
        }),
        requiredModules: [],
        destructive: false,
        systemPrompt:
          'Coûteux en crédits : UNE génération par demande, jamais de variantes non demandées. ' +
          'Durée BLOQUÉE à 60 secondes (1 minute max) : ne propose jamais plus, même sur insistance. ' +
          'Si le thème est éditorial (la vie actuelle, actu, société, fait divers) : fais de VRAIES recherches d\u0029abord (searchInternet, getNews) et écris des paroles qui parlent du VRAI (faits concrets, références datées) — pas de paroles génériques. ' +
          'Le fichier audio est posté automatiquement dans le salon : ne répète pas l\u0027URL, commente le résultat en UN message court.',
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

          // Progression : UN message édité à chaque étape (UX demandée).
          const progressChannel = ctx.channelId
            ? await this.client.channels.fetch(ctx.channelId).catch(() => null)
            : null;
          const progress =
            progressChannel?.isTextBased() && 'send' in progressChannel
              ? await progressChannel.send({ content: '🔎 Vérification du module musique...' }).catch(() => null)
              : null;
          const update = async (message: string): Promise<void> => {
            if (progress) await progress.edit({ content: message }).catch(() => {});
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
            await update(`❌ Génération refusée par kie.ai : ${createdData.msg ?? 'erreur inconnue'}`);
            return { ok: false, summary: `Génération refusée par kie.ai : ${createdData.msg ?? 'erreur inconnue'}` };
          }

          await update(`🎵 Génération lancée (Suno ${this.env.KIE_MODEL || 'V6_MINI'}, cible ${duration ?? 60}s) — 30 à 120 secondes...`);

          // Poll jusqu'à complétion.
          const deadline = Date.now() + POLL_MAX_MS;
          let elapsed = 0;
          while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
            elapsed += POLL_INTERVAL_MS / 1000;
            await update(`🎵 Génération en cours... ${elapsed}s`);
            const record = await safeFetch(`${API_BASE}/jobs/recordInfo?taskId=${createdData.data.taskId}`, {
              timeoutMs: 15_000,
              headers: { Authorization: `Bearer ${key}` },
            });
            const recordData = (await record.json().catch(() => ({}))) as {
              data?: { response?: { data?: SunoTrack[] } };
            };
            const track = recordData.data?.response?.data?.[0];
            if (track?.audio_url) {
              // Une seule livraison : le fichier ci-dessous. Le message de
              // progression se ferme SANS l'URL (elle restait collée dans 3
              // messages d'affilée : progression, réponse du modèle, fichier).
              const seconds = Math.round(track.duration ?? 0);
              await update(`✅ Musique « ${track.title ?? title} » prête (${seconds}s) — envoi du fichier...`);
              // Le fichier part en message séparé : Discord ne permet pas
              // d'attacher une pièce jointe en éditant un message existant.
              if (progressChannel?.isTextBased() && 'send' in progressChannel) {
                const destination = progressChannel as import('discord.js').TextChannel;
                const audio = await fetch(track.audio_url).then((res) => res.arrayBuffer()).catch(() => null);
                if (audio) {
                  await destination
                    .send({
                      files: [{ name: `${(track.title ?? title).replace(/[^a-zA-Z0-9-_]/gu, '-').slice(0, 40)}.mp3`, attachment: Buffer.from(audio) }],
                    })
                    .catch(() => {});
                }
              }
              return {
                ok: true,
                summary:
                  `Musique « ${track.title ?? title} » générée (${seconds}s) et postée en pièce jointe dans le salon. ` +
                  'Le lien kie.ai (14 jours) est dans data.audioUrl si besoin. ' +
                  'Ne répète PAS l\u0027URL ni ne reposte le fichier : réponds en UN message court de commentaire.',
                data: { audioUrl: track.audio_url, taskId: createdData.data.taskId, duration: seconds },
              };
            }
          }
          await update('⌛ La génération dépasse 150 secondes : le track arrivera, réessaie dans une minute pour le lien.');
          return { ok: false, summary: 'La génération dépasse 150 secondes : réessaie dans une minute, le track arrivera.' };
        },
      },
    ];
    return tools;
  }
}
