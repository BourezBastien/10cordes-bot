import { ProviderError } from '../provider.types';
import { asList, asNumber, asRecord, asText } from './kie-unified.json';

/**
 * Lecture d'une tâche RÉUSSIE : où kie.ai range les fichiers produits dépend
 * du modèle. `data.resultJson` est une chaîne JSON pour les images et les
 * vidéos ; la musique (Suno) livre ses pistes dans `data.response.data[]`.
 */

/** Clés sous lesquelles les modèles rangent les fichiers produits. */
const RESULT_KEYS = ['resultUrls', 'resultUrl', 'videoUrl', 'videos', 'imageUrl', 'images', 'audioUrl', 'urls', 'data'] as const;
/** Dans une entrée de liste, la première de ces clés porte l'URL du fichier produit (jamais la miniature). */
const ENTRY_URL_KEYS = ['url', 'audio_url', 'video_url', 'stream_audio_url'] as const;

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && (/^https?:\/\/\S+$/iu).test(value);
}

/** `resultJson` : chaîne JSON (forme habituelle), URL nue, ou déjà un objet. */
function parseResultJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return asRecord(value);
  const trimmed = value.trim();
  if (isHttpUrl(trimmed)) return { resultUrls: [trimmed] };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function collectUrls(value: unknown): string[] {
  if (typeof value === 'string') return isHttpUrl(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectUrls(item));
  const entry = asRecord(value);
  for (const key of ENTRY_URL_KEYS) {
    const candidate = entry[key];
    if (isHttpUrl(candidate)) return [candidate];
  }
  return [];
}

function urlsUnderKeys(source: unknown): string[] {
  const record = asRecord(source);
  return RESULT_KEYS.flatMap((key) => collectUrls(record[key]));
}

/** Fichiers produits par une tâche réussie, dans l'ordre où le modèle les donne. */
export function collectResultUrls(record: Record<string, unknown>): string[] {
  const fromResult = urlsUnderKeys(parseResultJson(record.resultJson));
  return fromResult.length > 0 ? fromResult : urlsUnderKeys(record.response);
}

function unreadableResult(taskId: string): ProviderError {
  return new ProviderError(`La tâche kie.ai ${taskId} a réussi mais son résultat est illisible (aucun fichier produit).`, 'http');
}

/** `data` normalisé d'une exécution réussie : `{ urls }`, ou `{ audioUrl, title, duration }` pour la musique. */
export function kieTaskData(capability: string, record: Record<string, unknown>, params: Record<string, unknown>, taskId: string): Record<string, unknown> {
  if (capability !== 'music.generate') {
    const urls = collectResultUrls(record);
    if (urls.length === 0) throw unreadableResult(taskId);
    return { urls };
  }
  const track = asRecord(asList(asRecord(record.response).data)[0]);
  const audioUrl = [track.audio_url, track.stream_audio_url].find(isHttpUrl) ?? collectResultUrls(record)[0];
  if (!audioUrl) throw unreadableResult(taskId);
  const title = asText(track.title) ?? asText(params.title);
  const duration = asNumber(track.duration) ?? asNumber(params.duration);
  return { audioUrl, ...(title ? { title } : {}), ...(duration !== undefined ? { duration: Math.round(duration) } : {}) };
}
