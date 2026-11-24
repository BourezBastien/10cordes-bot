import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { z } from 'zod';
import type { BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import { safeFetch } from '../../shared/utils/safe-fetch';
import { GuildIntegrationService } from '../integrations/guild-integration.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { pixelLabCredentials } from '../providers/image-engines';
import { CapabilityRouterService } from '../providers/capability-router.service';
import type { ProviderExecutionResult } from '../providers/provider.types';
import { renderCard } from './imagelab-card';
import { PENDING_MESSAGE, firstImageBytes, imageRequestOf, type ImageRequest } from './routed-image';

/** URL de base de PixelLab quand ni le serveur ni l'instance n'en donnent. */
const PIXELLAB_BASE_URL = 'https://api.pixellab.ai';

interface PixfluxResponse {
  image: { type: string; base64: string };
  usage?: { type: string; usd?: number };
}

interface GeneratedImage {
  base64: string;
  costUsd?: number;
}

/** Livraison : UNE vraie pièce jointe dans le salon de la demande (jamais une URL). */
async function deliver(ctx: { sendFile?: (file: { name: string; attachment: Uint8Array | string }) => Promise<void> }, file: { name: string; attachment: Buffer }): Promise<boolean> {
  if (!ctx.sendFile) return false;
  return ctx.sendFile(file).then(() => true).catch(() => false);
}

/** Suite d'un bilan quand le fichier n'a pas pu partir : le contenu existe, mais le salon ne l'a pas reçu. */
const NOT_DELIVERED = ', mais l\u0027envoi dans le salon a échoué : ne dis PAS que c\u0027est posté.';

const reason = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * Images du bot, trois moteurs bien distincts :
 *
 *   image.icon, image.emoji   PixelLab, l'INTÉGRATION pixel art (clé du serveur, sinon d'instance)
 *   generateImage             le modèle d'IA routé sur le serveur (capacité image.generate)
 *   image.compose             la carte composée en local (aucune clé)
 *
 * Sans clé ni route, chaque outil répond fail-closed : jamais d'image inventée.
 */
@Injectable()
export class ImagelabService implements SpraxiumOnBoot {
  /** L'intégration PixelLab est configurée pour l'instance (lu au démarrage). */
  private instanceConfigured = false;

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly integrations: GuildIntegrationService,
    private readonly router: CapabilityRouterService,
  ) {}

  async onBoot(): Promise<void> {
    this.instanceConfigured = await pixelLabCredentials(this.integrations, null, PIXELLAB_BASE_URL)
      .then(Boolean)
      .catch(() => false);
    for (const tool of this.buildTools()) this.registry.register(tool);
  }

  /** PixelLab est configuré pour l'instance (état lu au démarrage, pour le statut de connexion). */
  get configured(): boolean {
    return this.instanceConfigured;
  }

  /** Une image PixelLab (pixel art) sur ce serveur : la clé du serveur, sinon celle de l'instance. */
  private async pixelArt(prompt: string, size: number, opts: { transparent: boolean; palette?: string[] }, guildId: string | null): Promise<GeneratedImage> {
    const credentials = await pixelLabCredentials(this.integrations, guildId, PIXELLAB_BASE_URL);
    if (!credentials) throw new Error('Clé PixelLab manquante.');
    const apiBase = `${credentials.baseUrl.replace(/\/+$/u, '')}/v2`;
    const response = await safeFetch(`${apiBase}/create-image-pixflux`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.apiKey}` },
      body: JSON.stringify({
        description: prompt,
        image_size: { width: size, height: size },
        no_background: opts.transparent,
        ...(opts.palette && opts.palette.length >= 2 ? { forced_palette: opts.palette } : {}),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`PixelLab ${response.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await response.json()) as PixfluxResponse;
    if (data.image?.type !== 'base64' || !data.image.base64) throw new Error('PixelLab response did not contain a base64 image.');
    return { base64: data.image.base64.replace(/^data:image\/png;base64,/, ''), costUsd: data.usage?.usd };
  }

  private pixelLabOff(): ToolResult {
    return {
      ok: false,
      summary:
        'PixelLab n\u0027est pas configuré sur ce serveur : la génération de pixel art (icônes, émojis, sprites) est désactivée. ' +
        'Informe l\u0027utilisateur qu\u0027un administrateur peut saisir la clé PixelLab (intégration).',
    };
  }

  private modelOff(): ToolResult {
    return {
      ok: false,
      summary:
        'Aucun modèle d\u0027image routé sur ce serveur (capacité image.generate) : un administrateur en lie un depuis le panneau « Fournisseurs et modèles ». ' +
        'Dis-le honnêtement, n\u0027invente pas d\u0027image.',
    };
  }

  /** Le modèle d'image de la route du serveur : le ratio pour kie.ai, la taille équivalente pour les API de type OpenAI. */
  private async routedImage(request: ImageRequest, ctx: Pick<ToolRunContext, 'guildId' | 'userId' | 'sendFile'>): Promise<ToolResult> {
    if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
    if (!(await this.router.resolve(ctx.guildId, 'image.generate').catch(() => null))) return this.modelOff();
    const result: ProviderExecutionResult = await this.router
      .runCapability(
        ctx.guildId,
        'image.generate',
        { params: { prompt: request.prompt, aspect_ratio: request.ratio, size: request.size } },
        ctx.userId,
      )
      .catch((error: unknown): ProviderExecutionResult => ({ ok: false, summary: reason(error), data: {} }));
    if (!result.ok) return { ok: false, summary: `Génération d\u0027image impossible : ${result.summary}` };
    // Tâche encore en cours au-delà du délai : elle finit côté fournisseur, rien à livrer maintenant.
    if (result.data.pending === true) return { ok: false, summary: PENDING_MESSAGE };
    let image: Buffer;
    try {
      image = await firstImageBytes(result.data);
    } catch (error) {
      return { ok: false, summary: `Génération d\u0027image impossible : ${reason(error)}` };
    }
    const sent = await deliver(ctx, { name: `${request.label}.png`, attachment: image });
    return { ok: sent, summary: sent ? `Image générée et envoyée dans le salon (ratio ${request.ratio}).` : `Image générée${NOT_DELIVERED}`, data: { aspectRatio: request.ratio } };
  }

  private buildTools(): BotTool[] {
    return [
      {
        name: 'image.icon',
        description: 'Génère une icône PIXEL ART carrée (moteur PixelLab) : avatar de bot, icône de serveur, emblème. Pour un rendu non pixel art, utilise generateImage.',
        category: 'imagelab',
        keywords: ['icone', 'icône', 'avatar', 'emblème', 'embleme', 'sprite'],
        paramsSchema: z.object({
          description: z.string().min(10).max(600),
          size: z.number().int().min(32).max(400).default(128),
          transparent: z.boolean().default(false),
          palette: z.array(z.string()).max(32).optional(),
        }),
        requiredModules: [],
        permissions: ['ManageGuildExpressions'],
        destructive: false,
        systemPrompt:
          'Génération d\u0027image consommant des crédits PixelLab (budget limité). ' +
          'Décris le visuel pixel art de façon précis (sujet, palette, fond) ; size 128 pour un avatar, 64 pour un petit émoji. ' +
          'Ne régénère pas sans validation explicite de l\u0027utilisateur.',
        handler: async (input, ctx): Promise<ToolResult> => {
          if (!(await this.integrations.active(ctx.guildId, 'pixellab'))) return this.pixelLabOff();
          const { description, size, transparent, palette } = input as { description: string; size: number; transparent: boolean; palette?: string[] };
          const image = await this.pixelArt(`pixel art icon, ${description}`, size, { transparent, palette }, ctx.guildId);
          const sent = await deliver(ctx, { name: `pixel-icon-${Date.now()}.png`, attachment: Buffer.from(image.base64, 'base64') });
          const done = `Icône ${size}x${size} générée`;
          return { ok: sent, summary: sent ? `${done} et envoyée dans le salon (${image.costUsd ? `$${image.costUsd}` : 'crédits consommés'}).` : `${done}${NOT_DELIVERED}`, data: { size } };
        },
      },
      {
        name: 'image.emoji',
        description: 'Génère un émoji PIXEL ART 64x64 à fond transparent (moteur PixelLab), prêt pour Discord.',
        category: 'imagelab',
        keywords: ['emoji', 'emote', 'smiley'],
        paramsSchema: z.object({ description: z.string().min(5).max(300), palette: z.array(z.string()).max(32).optional() }),
        requiredModules: [],
        permissions: ['ManageGuildExpressions'],
        destructive: false,
        systemPrompt: 'Émoji 64x64 transparent : décris UN seul sujet simple et lisible en petit (visage, objet, animal). Propose un nom d\u0027émoji court à l\u0027utilisateur après génération.',
        handler: async (input, ctx): Promise<ToolResult> => {
          if (!(await this.integrations.active(ctx.guildId, 'pixellab'))) return this.pixelLabOff();
          const { description, palette } = input as { description: string; palette?: string[] };
          const image = await this.pixelArt(`pixel art emoji, single centered subject, ${description}`, 64, { transparent: true, palette }, ctx.guildId);
          const sent = await deliver(ctx, { name: `pixel-emoji-${Date.now()}.png`, attachment: Buffer.from(image.base64, 'base64') });
          return { ok: sent, summary: sent ? 'Émoji 64x64 généré et envoyé dans le salon. Propose un nom d\u0027émoji court à l\u0027utilisateur.' : `Émoji 64x64 généré${NOT_DELIVERED}`, data: { size: 64 } };
        },
      },
      {
        name: 'generateImage',
        description:
          'Génère une image libre (pas du pixel art) avec le modèle d\u0027image routé sur ce serveur (Z-Image via kie.ai, DALL-E, Flux, Gemini Image...) : prompt descriptif, choix du ratio, image livrée en pièce jointe dans le salon. Pixel art, sprite, émoji : image.icon ou image.emoji.',
        category: 'imagelab',
        keywords: ['image', 'illustration', 'dessin', 'photo', 'rendu', 'picture', 'wallpaper', 'logo', 'imagine'],
        paramsSchema: z.object({
          prompt: z.string().min(10).max(2000).describe('Description visuelle détaillée (sujet, style, lumière, cadrage)'),
          label: z.string().min(2).max(60).default('image').describe('Nom court du fichier image'),
          aspect_ratio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).default('1:1').describe('1:1 icône/avatar, 16:9 paysage/carte, 9:16 fond vertical, 4:3 et 3:4 photo'),
        }),
        requiredModules: [],
        permissions: [],
        destructive: false,
        systemPrompt:
          'Pour les images NON pixel art (scènes, cartes, illustrations, logos libres), exemple : « imagine la carte de GTA 7 ». Le pixel art reste sur image.icon/image.emoji (PixelLab). ' +
          'Choisis le ratio adapté (16:9 pour une carte ou un paysage, 1:1 pour un visuel carré, 9:16 pour un fond mobile). Pose les questions avant si le visuel est vague, puis UNE génération. ' +
          'Le modèle est celui de la ligne MOTEURS D\u0027IMAGE de tes consignes ; le fichier est envoyé automatiquement dans le salon.',
        handler: async (input, ctx): Promise<ToolResult> => this.routedImage(imageRequestOf(input as { prompt: string; label?: string; aspect_ratio?: string }), ctx),
      },
      {
        name: 'image.compose',
        description: 'Compose une CARTE visuelle en local (canvas, aucune clé requise) : titre, sous-titre, avatar optionnel : bannière de bienvenue, carte de rang, en-tête d\u0027événement. Texte précis et fiable (contrairement à la génération IA).',
        category: 'imagelab',
        paramsSchema: z.object({
          title: z.string().min(1).max(80),
          subtitle: z.string().max(160).optional(),
          avatarUrl: z.string().url().max(500).optional().describe('Avatar circulaire à gauche (URL)'),
        }),
        requiredModules: [],
        permissions: [],
        destructive: false,
        systemPrompt: 'Bannière locale instantanée (bienvenue, niveau, événement). Fond sombre, accent orange : le style maison. Le fichier part en pièce jointe.',
        handler: async (input, ctx): Promise<ToolResult> => {
          const { title, subtitle, avatarUrl } = input as { title: string; subtitle?: string; avatarUrl?: string };
          const card = await renderCard({ title, subtitle, avatarUrl });
          const sent = await deliver(ctx, { name: `card-${Date.now()}.png`, attachment: card.png });
          return sent ? { ok: true, summary: `Carte « ${title} » envoyée en pièce jointe.`, data: { width: card.width, height: card.height } } : { ok: false, summary: 'Carte générée mais envoi impossible (surface sans fichiers).' };
        },
      },
    ];
  }
}
