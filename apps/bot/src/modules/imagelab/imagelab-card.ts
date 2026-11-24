import { createCanvas, loadImage } from '@napi-rs/canvas';
import { safeFetch } from '../../shared/utils/safe-fetch';

/**
 * Carte visuelle composée en local (canvas, aucune clé, aucun réseau sauf
 * l'avatar demandé) : bannière de bienvenue, carte de rang, en-tête
 * d'événement. Le texte y est fiable, contrairement à une génération IA.
 */

export interface CardOptions {
  title: string;
  subtitle?: string;
  /** Avatar circulaire à gauche (URL publique https). */
  avatarUrl?: string;
}

export interface RenderedCard {
  png: Buffer;
  width: number;
  height: number;
}

const WIDTH = 900;
const HEIGHT = 280;
/** Style maison : fond sombre, liseré orange. */
const CANVAS_COLOR = '#111114';
const ACCENT_COLOR = '#d95926';
const TITLE_COLOR = '#f5f5f7';
const SUBTITLE_COLOR = '#a8a8ad';

/** Avatar distant en bytes, null s'il est absent ou illisible. */
async function fetchAvatar(avatarUrl: string | undefined): Promise<Buffer | null> {
  if (!avatarUrl) return null;
  const bytes = await safeFetch(avatarUrl, { timeoutMs: 10_000 })
    .then((response) => response.arrayBuffer())
    .catch(() => null);
  return bytes ? Buffer.from(bytes) : null;
}

/** Avatar aux bords adoucis par un cache circulaire ; l'appelant gère la sauvegarde du contexte. */
async function drawAvatar(context: ReturnType<ReturnType<typeof createCanvas>['getContext']>, avatarUrl: string | undefined): Promise<number> {
  const buffer = await fetchAvatar(avatarUrl);
  if (!buffer) return 60;
  const image = await loadImage(buffer).catch(() => null);
  if (!image) return 60;
  context.save();
  context.beginPath();
  context.arc(130, HEIGHT / 2, 80, 0, Math.PI * 2);
  context.closePath();
  context.clip();
  context.drawImage(image, 50, HEIGHT / 2 - 80, 160, 160);
  context.restore();
  return 240;
}

export async function renderCard(options: CardOptions): Promise<RenderedCard> {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext('2d');
  context.fillStyle = CANVAS_COLOR;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = ACCENT_COLOR;
  context.fillRect(0, 0, 14, HEIGHT);
  const textX = await drawAvatar(context, options.avatarUrl);
  context.fillStyle = TITLE_COLOR;
  context.font = 'bold 52px sans-serif';
  context.fillText(options.title.slice(0, 24), textX, options.subtitle ? HEIGHT / 2 - 8 : HEIGHT / 2 + 18);
  if (options.subtitle) {
    context.fillStyle = SUBTITLE_COLOR;
    context.font = '30px sans-serif';
    context.fillText(options.subtitle.slice(0, 40), textX, HEIGHT / 2 + 44);
  }
  return { png: canvas.toBuffer('image/png'), width: WIDTH, height: HEIGHT };
}
