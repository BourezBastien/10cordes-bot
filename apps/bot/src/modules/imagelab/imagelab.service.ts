import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { z } from 'zod';
import { safeFetch } from '../../shared/utils/safe-fetch';
import type { AppEnv } from '../../app.env';
import type { BotTool, ToolResult } from '@10cordes/shared';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';

const API_BASE = "https://api.pixellab.ai/v2";

interface PixfluxResponse {
  image: { type: string; base64: string };
  usage?: { type: string; usd?: number };
}

/**
 * PixelLab API v2 - génération pixel art (icônes, émojis, sprites).
 * La clé est fournie par l'Opérateur via PIXELLAB_API_KEY : sans clé,
 * les tools répondent fail-closed avec la marche à suivre.
 */
@Injectable()
export class ImagelabService implements SpraxiumOnBoot {
  constructor(
    private readonly env: AppEnv,
    private readonly registry: ToolRegistryService,
  ) {}

  async onBoot(): Promise<void> {
    for (const tool of this.buildTools()) this.registry.register(tool);
  }

  get configured(): boolean {
    return Boolean(this.env.PIXELLAB_API_KEY);
  }

  private notConfigured(): ToolResult {
    return {
      ok: false,
      summary:
        "PIXELLAB_API_KEY n'est pas configurée sur cette instance. " +
        "L'Opérateur doit définir sa propre clé (https://pixellab.ai) dans l'environnement avant d'activer la génération d'images.",
    };
  }

  /** Crée une image pixel art via create-image-pixflux (synchrone, base64 PNG). */
  async generateImage(
    description: string,
    size: number,
    opts: { transparent: boolean; palette?: string[] },
  ): Promise<{ base64: string; costUsd?: number }> {
    const response = await safeFetch(`${API_BASE}/create-image-pixflux`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.env.PIXELLAB_API_KEY}`,
      },
      body: JSON.stringify({
        description,
        image_size: { width: size, height: size },
        no_background: opts.transparent,
        ...(opts.palette && opts.palette.length >= 2 ? { forced_palette: opts.palette } : {}),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`PixelLab ${response.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await response.json()) as PixfluxResponse;
    if (data.image?.type !== "base64" || !data.image.base64) {
      throw new Error("PixelLab response did not contain a base64 image.");
    }
    const base64 = data.image.base64.replace(/^data:image\/png;base64,/, "");
    return { base64, costUsd: data.usage?.usd };
  }

  private buildTools(): BotTool[] {
    return [
      {
        name: "image.icon",
        description: "Génère une icône pixel art carrée : avatar de bot, icône de serveur, emblème.",
        category: "imagelab",
        paramsSchema: z.object({
          description: z.string().min(10).max(600),
          size: z.number().int().min(32).max(400).default(128),
          transparent: z.boolean().default(false),
          palette: z.array(z.string()).max(32).optional(),
        }),
        requiredModules: [],
        destructive: false,
        systemPrompt:
          "Génération d'image consommant des crédits PixelLab (budget limité). " +
          "Décris le visuel pixel art de façon précise (sujet, palette, fond) ; size 128 pour un avatar, 64 pour un petit émoji. " +
          "Ne régénère pas sans validation explicite de l'utilisateur.",
        handler: async (input) => {
          if (!this.configured) return this.notConfigured();
          const { description, size, transparent, palette } = input as {
            description: string;
            size: number;
            transparent: boolean;
            palette?: string[];
          };
          const image = await this.generateImage(`pixel art icon, ${description}`, size, {
            transparent,
            palette,
          });
          return {
            ok: true,
            summary: `Icône ${size}x${size} générée (${image.costUsd ? `$${image.costUsd}` : "crédits consommés"}).`,
            data: { base64: image.base64, size },
          };
        },
      },
      {
        name: "image.emoji",
        description: "Génère un émoji pixel art 64x64 à fond transparent, prêt pour Discord.",
        category: "imagelab",
        paramsSchema: z.object({
          description: z.string().min(5).max(300),
          palette: z.array(z.string()).max(32).optional(),
        }),
        requiredModules: [],
        destructive: false,
        systemPrompt:
          "Émoji 64x64 transparent : décris UN seul sujet simple et lisible en petit (visage, objet, animal). " +
          "Propose un nom d'émoji court à l'utilisateur après génération.",
        handler: async (input) => {
          if (!this.configured) return this.notConfigured();
          const { description, palette } = input as { description: string; palette?: string[] };
          const image = await this.generateImage(`pixel art emoji, single centered subject, ${description}`, 64, {
            transparent: true,
            palette,
          });
          return { ok: true, summary: "Émoji 64x64 généré.", data: { base64: image.base64, size: 64 } };
        },
      },
    ];
  }
}
