import { providerFetch, readJson } from '../provider-http';
import { ProviderError, type ProviderConfig, type ProviderExecutionResult, type ProviderRequest } from '../provider.types';
import { optionalNumber, optionalText, requiredText } from './openai-compatible.common';
import { assertProviderOk, responseError } from './generic-http.errors';

/**
 * Images (`/images/generations`, `/images/edits`) et voix (`/audio/speech`) :
 * des appels longs, loin des 30 s par défaut.
 */

const MEDIA_TIMEOUT_MS = 120_000;
const IMAGE_FORMATS = ['b64_json', 'url'] as const;

/** Les modèles GPT Image répondent toujours en base64 et ne supportent pas `response_format`. */
const ALWAYS_BASE64_MODEL = 'gpt-image';

interface DecodedImage {
  file: Blob;
  extension: string;
}

/** Premiers octets d'un fichier image, en base64 : le préfixe suffit à reconnaître le format. */
const SIGNATURES: ReadonlyArray<[string, string]> = [
  ['iVBORw0KGgo', 'image/png'],
  ['/9j/', 'image/jpeg'],
  ['UklGR', 'image/webp'],
];
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function generateImage(config: ProviderConfig, request: ProviderRequest, signal?: AbortSignal): Promise<ProviderExecutionResult> {
  const { params } = request;
  const responseFormat = optionalText(params, 'responseFormat') ?? 'b64_json';
  if (!(IMAGE_FORMATS as readonly string[]).includes(responseFormat)) {
    throw new ProviderError('Paramètre invalide : responseFormat (b64_json ou url).', 'invalid');
  }
  const count = optionalNumber(params, 'n', true);
  const size = optionalText(params, 'size');
  const quality = optionalText(params, 'quality');
  const response = await providerFetch(config, '/images/generations', {
    method: 'POST',
    timeoutMs: MEDIA_TIMEOUT_MS,
    signal,
    body: JSON.stringify({
      model: request.modelId,
      prompt: requiredText(params, 'prompt'),
      ...(count === null ? {} : { n: count }),
      ...(size === null ? {} : { size }),
      ...(quality === null ? {} : { quality }),
      ...(request.modelId.startsWith(ALWAYS_BASE64_MODEL) ? {} : { response_format: responseFormat }),
    }),
  });
  await assertProviderOk(response, config);
  return imageResult(response, config, 'générée(s)');
}

export async function editImage(config: ProviderConfig, request: ProviderRequest, signal?: AbortSignal): Promise<ProviderExecutionResult> {
  const { params } = request;
  const image = decodeImage(params.image, 'image');
  const mask = params.mask === undefined || params.mask === null ? null : decodeImage(params.mask, 'mask');
  const count = optionalNumber(params, 'n', true);
  const size = optionalText(params, 'size');
  const form = new FormData();
  form.append('model', request.modelId);
  form.append('image', image.file, `image.${image.extension}`);
  if (mask) form.append('mask', mask.file, `mask.${mask.extension}`);
  form.append('prompt', requiredText(params, 'prompt'));
  if (count !== null) form.append('n', String(count));
  if (size !== null) form.append('size', size);
  const response = await providerFetch(config, '/images/edits', { method: 'POST', timeoutMs: MEDIA_TIMEOUT_MS, signal, body: form });
  await assertProviderOk(response, config);
  return imageResult(response, config, 'modifiée(s)');
}

/** `{ images: [{ b64_json?, url? }], revisedPrompt? }` : la forme normalisée attendue par les consommateurs. */
async function imageResult(
  response: Response,
  config: ProviderConfig,
  participle: 'générée(s)' | 'modifiée(s)',
): Promise<ProviderExecutionResult> {
  const items = ((await readJson(response)) as { data?: unknown } | null)?.data;
  if (!Array.isArray(items)) {
    throw new ProviderError('Le fournisseur a renvoyé une réponse d\u0027image illisible.', 'unavailable');
  }
  const entries = items.map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : {}));
  const images = entries.map((entry) => ({
    ...(typeof entry.b64_json === 'string' ? { b64_json: entry.b64_json } : {}),
    ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
  }));
  const revisedPrompt = entries.find((entry) => typeof entry.revised_prompt === 'string')?.revised_prompt;
  return {
    ok: true,
    summary: `${images.length} image(s) ${participle}.`,
    data: { images, ...(typeof revisedPrompt === 'string' ? { revisedPrompt } : {}) },
  };
}

/** Image d'un paramètre : data URL (`data:image/png;base64,...`) ou base64 nu. Le format non déclaré est reconnu à la signature. */
function decodeImage(value: unknown, key: string): DecodedImage {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProviderError(`Paramètre manquant : ${key} (image en base64 ou data URL).`, 'invalid');
  }
  const comma = value.slice(0, 5).toLowerCase() === 'data:' ? value.indexOf(',') : -1;
  const meta = comma === -1 ? [] : value.slice(5, comma).split(';').map((part) => part.trim().toLowerCase());
  const base64 = (comma === -1 ? value : value.slice(comma + 1)).replace(/\s+/gu, '').replaceAll('-', '+').replaceAll('_', '/');
  if ((comma !== -1 && !meta.includes('base64')) || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) {
    throw new ProviderError(`Paramètre invalide : ${key} (base64 ou data URL attendu).`, 'invalid');
  }
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  if (bytes.length === 0) throw new ProviderError(`Paramètre invalide : ${key} (image vide).`, 'invalid');
  const mime = meta[0] || SIGNATURES.find(([prefix]) => base64.startsWith(prefix))?.[1] || 'image/png';
  return { file: new Blob([bytes], { type: mime }), extension: EXTENSIONS[mime] ?? 'png' };
}

/** `/audio/speech` répond en binaire. Un corps JSON (ou vide) sur un 2xx est une panne du fournisseur, pas un audio. */
export async function synthesizeSpeech(
  config: ProviderConfig,
  request: ProviderRequest,
  signal?: AbortSignal,
): Promise<ProviderExecutionResult> {
  const { params } = request;
  const format = optionalText(params, 'format') ?? 'mp3';
  if (!/^[a-z0-9]{1,10}$/iu.test(format)) {
    throw new ProviderError('Paramètre invalide : format (mp3, opus, aac, flac, wav, pcm...).', 'invalid');
  }
  const speed = optionalNumber(params, 'speed', false);
  const response = await providerFetch(config, '/audio/speech', {
    method: 'POST',
    timeoutMs: MEDIA_TIMEOUT_MS,
    signal,
    body: JSON.stringify({
      model: request.modelId,
      input: requiredText(params, 'input'),
      voice: requiredText(params, 'voice'),
      ...(params.format === undefined ? {} : { response_format: format }),
      ...(speed === null ? {} : { speed }),
    }),
  });
  await assertProviderOk(response, config);
  if ((response.headers.get('content-type') ?? '').includes('json')) throw await responseError(response, config);
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) throw new ProviderError('Le fournisseur n\u0027a renvoyé aucun audio.', 'unavailable');
  return { ok: true, summary: `Voix générée (${format}, durée inconnue).`, data: { audioBase64: audio.toString('base64'), format } };
}
