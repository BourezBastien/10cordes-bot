import { safeFetch } from '../../shared/utils/safe-fetch';

/**
 * Image du modèle routé sur un serveur (capacité `image.generate`). Les deux
 * protocoles ne rendent pas la même forme : OpenAI-compatible renvoie des
 * images en ligne (`{ images: [{ b64_json?, url? }] }`), kie.ai une tâche
 * sondée puis ses fichiers (`{ urls }`). L'outil ne voit qu'un seul contrat :
 * des octets, et jamais une URL à montrer.
 */

/** Ratios proposés, et la taille équivalente attendue par les API de type OpenAI. */
export const IMAGE_RATIOS = {
  '1:1': { size: '1024x1024' },
  '16:9': { size: '1536x1024' },
  '9:16': { size: '1024x1536' },
  '4:3': { size: '1536x1024' },
  '3:4': { size: '1024x1536' },
} as const;
export type ImageRatio = keyof typeof IMAGE_RATIOS;

const RATIOS = Object.keys(IMAGE_RATIOS);

/** Une demande de génération, telle que l'outil la garde. */
export interface ImageRequest {
  prompt: string;
  /** Nom du fichier livré : lettres, chiffres, tirets, 40 caractères. */
  label: string;  ratio: ImageRatio;
  /** Taille équivalente, pour les API de type OpenAI. */
  size: string;
}

/** Nom de fichier sûr : lettres et chiffres (toutes écritures), tirets et soulignés ; le reste devient un tiret. */
function fileNameOf(label: string | null | undefined): string {
  const cleaned = (label ?? '').trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40);
  // Sans rien de lisible (espaces, ponctuation seule), le nom par défaut.
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : 'image';
}

/**
 * Valeurs par défaut appliquées même à un appelant qui contourne la
 * validation du schéma (une recette qui rejoue des paramètres enregistrés) :
 * nom « image », et un ratio inconnu ramené au carré.
 */
export function imageRequestOf(input: { prompt: string; label?: string | null; aspect_ratio?: string | null }): ImageRequest {
  const ratio = RATIOS.includes(String(input.aspect_ratio)) ? (input.aspect_ratio as ImageRatio) : '1:1';
  return { prompt: input.prompt, label: fileNameOf(input.label), ratio, size: IMAGE_RATIOS[ratio].size };
}

/** Une tâche longue (vidéo, image lente) n'a pas rendu de fichier dans le délai : rien à livrer. */
export const PENDING_MESSAGE = 'La génération dépasse le délai d\u0027attente : elle se termine côté fournisseur, réessaie dans une minute.';

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** Première image d'un résultat de capacité, en octets. Base64 telle quelle, URL téléchargée par la garde des requêtes sortantes. */
export async function firstImageBytes(data: Record<string, unknown>): Promise<Buffer> {
  const first = asRecord(Array.isArray(data.images) ? data.images[0] : undefined);
  if (typeof first.b64_json === 'string' && first.b64_json.length > 0) return Buffer.from(first.b64_json, 'base64');
  const url = [first.url, Array.isArray(data.urls) ? data.urls[0] : undefined].find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
  if (!url) throw new Error('Le fournisseur n\u0027a pas renvoyé d\u0027image.');
  const bytes = await safeFetch(url, { timeoutMs: 60_000 }).then((response) => response.arrayBuffer());
  const image = Buffer.from(bytes);
  if (image.length === 0) throw new Error('Le fournisseur a renvoyé une image vide.');
  return image;
}
