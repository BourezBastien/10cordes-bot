import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { z } from 'zod';
import { safeFetch } from '../../shared/utils/safe-fetch';
import { AppEnv } from '../../app.env';
import { PrismaService } from '../database/prisma.service';
import type { BotTool, ToolResult } from '@10cordes/shared';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';

const API_BASE = "https://api.pixellab.ai/v2";

interface PixfluxResponse {
  image: { type: string; base64: string };
  usage?: { type: string; usd?: number };
}

/**
 * PixelLab API v2 - génération pixel art (icônes, émojis, sprites).
 * Clé : modale owner (table IntegrationConfig, effet immédiat) sinon env
 * PIXELLAB_API_KEY. Sans clé, les tools répondent fail-closed avec la marche à suivre.
 */
@Injectable()
export class ImagelabService implements SpraxiumOnBoot {
  private runtimeKey: string | null = null;

  constructor(
    private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
  ) {}

  async onBoot(): Promise<void> {
    try {
      const row = await this.prisma.integrationConfig.findUnique({ where: { id: 'imagelab' } });
      if (row) this.runtimeKey = row.apiKey;
    } catch {
      // Table pas encore migrée au tout premier boot.
    }
    for (const tool of this.buildTools()) this.registry.register(tool);
  }

  get configured(): boolean {
    return Boolean(this.runtimeKey || this.env.PIXELLAB_API_KEY);
  }

  /** Branche la clé PixelLab saisie via la modale (effet immédiat). */
  async setPixellabKey(apiKey: string): Promise<void> {
    const row = { provider: 'pixellab', baseUrl: API_BASE, apiKey, model: '' };
    await this.prisma.integrationConfig.upsert({
      where: { id: 'imagelab' },
      create: { id: 'imagelab', ...row },
      update: row,
    });
    this.runtimeKey = apiKey;
  }

  private notConfigured(): ToolResult {
    return {
      ok: false,
      summary:
        "Clé PixelLab manquante : la génération d'images est désactivée. " +
        "Informe l'utilisateur que l'owner du serveur peut la connecter via la modale " +
        "(mentionne le bot pour l'ouvrir, champ PixelLab optionnel).",
    };
  }

  /** Crée une image pixel art via create-image-pixflux (synchrone, base64 PNG). */
  async generateImage(
    description: string,
    size: number,
    opts: { transparent: boolean; palette?: string[] },
  ): Promise<{ base64: string; costUsd?: number }> {
    const apiKey = this.runtimeKey ?? this.env.PIXELLAB_API_KEY;
    const response = await safeFetch(`${API_BASE}/create-image-pixflux`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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
        permissions: ["ManageGuildExpressions"],
        destructive: false,
        systemPrompt:
          "Génération d'image consommant des crédits PixelLab (budget limité). " +
          "Décris le visuel pixel art de façon précise (sujet, palette, fond) ; size 128 pour un avatar, 64 pour un petit émoji. " +
          "Ne régénère pas sans validation explicite de l'utilisateur.",
        handler: async (input, ctx) => {
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
          // LIVRAISON : l'image part en pièce jointe dans le salon de la
          // demande (sans ça, le base64 restait coincé dans le résultat du
          // tool et le modèle annonçait faussement « image postée »).
          await ctx.sendFile
            ?.({ name: `pixel-icon-${Date.now()}.png`, attachment: Buffer.from(image.base64, 'base64') })
            .catch(() => {});
          return {
            ok: true,
            summary: `Icône ${size}x${size} générée et envoyée dans le salon (${image.costUsd ? `$${image.costUsd}` : 'crédits consommés'}).`,
            data: { size },
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
        permissions: ["ManageGuildExpressions"],
        destructive: false,
        systemPrompt:
          "Émoji 64x64 transparent : décris UN seul sujet simple et lisible en petit (visage, objet, animal). " +
          "Propose un nom d'émoji court à l'utilisateur après génération.",
        handler: async (input, ctx) => {
          if (!this.configured) return this.notConfigured();
          const { description, palette } = input as { description: string; palette?: string[] };
          const image = await this.generateImage(`pixel art emoji, single centered subject, ${description}`, 64, {
            transparent: true,
            palette,
          });
          await ctx.sendFile
            ?.({ name: `pixel-emoji-${Date.now()}.png`, attachment: Buffer.from(image.base64, 'base64') })
            .catch(() => {});
          return { ok: true, summary: 'Émoji 64x64 généré et envoyé dans le salon. Propose un nom d\u0027émoji court à l\u0027utilisateur.', data: { size: 64 } };
        },
      },
    ];
  }
}
