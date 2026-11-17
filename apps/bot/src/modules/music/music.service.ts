import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { z } from 'zod';
import type { BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import { safeFetch } from '../../shared/utils/safe-fetch';
import { AppEnv } from '../../app.env';

/**
 * Génération musicale via kie.ai (Suno, V6). Clé KIE_API_KEY requise.
 * La génération est asynchrone : createTask renvoie un taskId, le tool
 * sonde recordInfo jusqu'à 90s puis livre l'URL audio (fichiers gardés
 * 14 jours par kie.ai). Coûteux côté crédits : documenté au user.
 */

const API_BASE = 'https://api.kie.ai/api/v1';
const POLL_INTERVAL_MS = 6_000;
const POLL_MAX_MS = 90_000;

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
  ) {}

  onBoot(): void {
    this.log.info(this.env.KIE_API_KEY ? 'Music enabled (kie.ai).' : 'Music disabled: KIE_API_KEY absent.');
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
          'Génère une musique complète (Suno V6 via kie.ai) : titre, style, instrumental ou paroles. Asynchrone (30-90s). Coûteux en crédits : une génération par demande.',
        category: 'music',
        paramsSchema: z.object({
          title: z.string().min(1).max(80),
          style: z.string().min(3).max(1000).describe('Ex: trap marseillais mélancolique, 90 bpm, piano sombre'),
          prompt: z.string().max(3000).optional().describe('Paroles ou description libre si non instrumental'),
          instrumental: z.boolean().default(false),
        }),
        requiredModules: [],
        destructive: false,
        systemPrompt:
          'Coûteux en crédits : UNE génération par demande, jamais de variantes non demandées. Pose les questions avant (style, ambiance, instrumental ?) via le workflow skills, puis lance UNE génération et livre l\u0027URL audio. Ne promets pas de fichier local : c\u0029est un lien kie.ai valable 14 jours.',
        handler: async (input, ctx) => {
          if (!guildOnly(ctx)) return { ok: false, summary: 'Contexte de serveur requis.' };
          const key = this.apiKey();
          if (!key) return { ok: false, summary: 'Génération musicale désactivée : KIE_API_KEY absente de la configuration.' };
          const { title, style, prompt, instrumental } = input as {
            title: string;
            style: string;
            prompt?: string;
            instrumental?: boolean;
          };

          const created = await safeFetch(`${API_BASE}/jobs/createTask`, {
            timeoutMs: 30_000,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: 'ai-music-api/generate',
              input: {
                custom_mode: true,
                model: 'V6',
                title,
                style,
                prompt: instrumental ? undefined : prompt,
                instrumental: instrumental ?? false,
              },
            }),
          });
          const createdData = (await created.json().catch(() => ({}))) as { code?: number; data?: { taskId?: string }; msg?: string };
          if (createdData.code !== 200 || !createdData.data?.taskId) {
            return { ok: false, summary: `Génération refusée par kie.ai : ${createdData.msg ?? 'erreur inconnue'}` };
          }

          // Poll jusqu'à complétion (le callback kie.ai n'a pas d'URL publique).
          const deadline = Date.now() + POLL_MAX_MS;
          while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
            const record = await safeFetch(`${API_BASE}/jobs/recordInfo?taskId=${createdData.data.taskId}`, {
              timeoutMs: 15_000,
              headers: { Authorization: `Bearer ${key}` },
            });
            const recordData = (await record.json().catch(() => ({}))) as {
              data?: { response?: { data?: SunoTrack[] } };
            };
            const track = recordData.data?.response?.data?.[0];
            if (track?.audio_url) {
              return {
                ok: true,
                summary: `Musique « ${track.title ?? title} » générée (${Math.round(track.duration ?? 0)}s) : ${track.audio_url}`,
                data: { audioUrl: track.audio_url, taskId: createdData.data.taskId },
              };
            }
          }
          return { ok: false, summary: 'La génération dépasse 90 secondes : réessaie dans une minute, le track arrivera.' };
        },
      },
    ];
    return tools;
  }
}
