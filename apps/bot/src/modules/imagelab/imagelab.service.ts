import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { z } from 'zod';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { safeFetch } from '../../shared/utils/safe-fetch';
import { AppEnv } from '../../app.env';
import { PrismaService } from '../database/prisma.service';
import type { BotTool, ToolResult } from '@10cordes/shared';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { IntegrationService } from '../integrations/integration.service';

const API_BASE = "https://api.pixellab.ai/v2";

interface PixfluxResponse {
  image: { type: string; base64: string };
  usage?: { type: string; usd?: number };
}

/**
 * PixelLab API v2 - génération pixel art (icônes, émojis, sprites).
 * Clé : modale owner (table IntegrationConfig, effet immédiat) sinon env
 * intégration (modal Discord). Sans clé, les tools répondent fail-closed.
 */
@Injectable()
export class ImagelabService implements SpraxiumOnBoot {
  private runtimeKey: string | null = null;

  constructor(
    private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
    private readonly integrations: IntegrationService,
  ) {}

  async onBoot(): Promise<void> {
    const resolved = await this.integrations.get('pixellab').catch(() => null);
    if (resolved?.config.apiKey) this.runtimeKey = resolved.config.apiKey;
    for (const tool of this.buildTools()) this.registry.register(tool);
  }

  get configured(): boolean {
    return Boolean(this.runtimeKey || '');
  }

  /** Branche la clé PixelLab saisie via la modale (effet immédiat). */
  async setPixellabKey(apiKey: string): Promise<void> {
    await this.integrations.upsert('pixellab', { apiKey }, 'modal');
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
    const apiKey = this.runtimeKey ?? '';
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
          const delivered = ctx.sendFile
            ? await ctx.sendFile({ name: `pixel-icon-${Date.now()}.png`, attachment: Buffer.from(image.base64, 'base64') })
                .then(() => true)
                .catch(() => false)
            : false;
          return {
            ok: delivered,
            summary: delivered
              ? `Icône ${size}x${size} générée et envoyée dans le salon (${image.costUsd ? `$${image.costUsd}` : 'crédits consommés'}).`
              : `Icône générée mais l'envoi dans le salon a échoué (surface sans fichiers) : ne dis PAS qu'elle est postée.`,
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
          const delivered = ctx.sendFile
            ? await ctx.sendFile({ name: `pixel-emoji-${Date.now()}.png`, attachment: Buffer.from(image.base64, 'base64') })
                .then(() => true)
                .catch(() => false)
            : false;
          return {
            ok: delivered,
            summary: delivered
              ? "Émoji 64x64 généré et envoyé dans le salon. Propose un nom d'émoji court à l'utilisateur."
              : "Émoji généré mais l'envoi dans le salon a échoué : ne dis PAS qu'il est posté.",
            data: { size: 64 },
          };
        },
      },
      {
        name: 'image.compose',
        description:
          "Compose une CARTE visuelle en local (canvas, aucune clé requise) : titre, sous-titre, avatar optionnel : bannière de bienvenue, carte de rang, en-tête d'événement. Texte précis et fiable (contrairement à la génération IA).",
        category: 'imagelab',
        paramsSchema: z.object({
          title: z.string().min(1).max(80),
          subtitle: z.string().max(160).optional(),
          avatarUrl: z.string().url().max(500).optional().describe('Avatar circulaire à gauche (URL)'),
        }),
        requiredModules: [],
        permissions: [],
        destructive: false,
        systemPrompt:
          'Bannière locale instantanée (bienvenue, niveau, événement). Fond sombre, accent orange : le style maison. Le fichier part en pièce jointe.',
        handler: async (input, ctx) => {
          const { title, subtitle, avatarUrl } = input as { title: string; subtitle?: string; avatarUrl?: string };
          const W = 900;
          const H = 280;
          const canvas = createCanvas(W, H);
          const c = canvas.getContext('2d');
          // Fond sombre + accent orange (branding maison).
          c.fillStyle = '#111114';
          c.fillRect(0, 0, W, H);
          c.fillStyle = '#d95926';
          c.fillRect(0, 0, 14, H);
          let textX = 60;
          if (avatarUrl) {
            const avatarBuffer = await safeFetch(avatarUrl, { timeoutMs: 10_000 })
              .then((response) => response.arrayBuffer())
              .catch(() => null);
            if (avatarBuffer) {
              const image = await loadImage(Buffer.from(avatarBuffer)).catch(() => null);
              if (image) {
                c.save();
                c.beginPath();
                c.arc(130, H / 2, 80, 0, Math.PI * 2);
                c.closePath();
                c.clip();
                c.drawImage(image, 50, H / 2 - 80, 160, 160);
                c.restore();
                textX = 240;
              }
            }
          }
          c.fillStyle = '#f5f5f7';
          c.font = 'bold 52px sans-serif';
          c.fillText(title.slice(0, 24), textX, subtitle ? H / 2 - 8 : H / 2 + 18);
          if (subtitle) {
            c.fillStyle = '#a8a8ad';
            c.font = '30px sans-serif';
            c.fillText(subtitle.slice(0, 40), textX, H / 2 + 44);
          }
          const delivered = ctx.sendFile
            ? await ctx.sendFile({ name: `card-${Date.now()}.png`, attachment: canvas.toBuffer('image/png') })
                .then(() => true)
                .catch(() => false)
            : false;
          return delivered
            ? { ok: true, summary: `Carte « ${title} » envoyée en pièce jointe.`, data: { width: W, height: H } }
            : { ok: false, summary: 'Carte générée mais envoi impossible (surface sans fichiers).' };
        },
      },
    ];
  }
}
