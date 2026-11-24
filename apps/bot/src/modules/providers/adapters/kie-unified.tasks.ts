import type { ProviderRequest } from '../provider.types';
import { ProviderError } from '../provider.types';
import { compactRecord } from './kie-unified.json';

/**
 * Tâches kie.ai : ce qu'on envoie (`{ model, input }`) et combien on attend.
 * Image, vidéo, musique et voix passent toutes par le même endpoint de tâche ;
 * seuls le modèle de tâche et les champs d'entrée changent.
 */

/** Le modèle de la TÂCHE musicale ; le modèle Suno (V6_MINI, V6...) voyage dans `input.model`. */
export const KIE_MUSIC_TASK_MODEL = 'ai-music-api/generate';

/** Chemins de l'API de tâches, relatifs à l'URL de base (`https://api.kie.ai`, sans `/api/v1`). */
export const KIE_CREATE_TASK_PATH = '/api/v1/jobs/createTask';
export const KIE_RECORD_INFO_PATH = '/api/v1/jobs/recordInfo';

export interface KieTaskBody {
  model: string;
  input: Record<string, unknown>;
}

export interface KiePollTiming {
  maxWaitMs: number;
  pollIntervalMs: number;
}

type TaskFamily = 'image' | 'music' | 'video' | 'tts';

const TASK_FAMILY: Record<string, TaskFamily> = {
  'image.generate': 'image',
  'image.edit': 'image',
  'music.generate': 'music',
  'video.generate': 'video',
  'tts.speak': 'tts',
};

/** Attente maximale par famille quand ni la route ni l'appel ne la fixent (`maxWaitMs`). */
const DEFAULT_MAX_WAIT_MS: Record<TaskFamily, number> = { image: 90_000, music: 150_000, video: 300_000, tts: 90_000 };
const DEFAULT_POLL_INTERVAL_MS = 5_000;
/** Sonder plus vite n'accélère pas une génération : plancher de l'intervalle (`pollIntervalMs`). */
const MIN_POLL_INTERVAL_MS = 50;

/** Première valeur présente parmi les noms admis d'un paramètre (camelCase du bot, snake_case de l'API). */
function pick(params: Record<string, unknown>, ...keys: string[]): unknown {
  return keys.map((key) => params[key]).find((value) => value !== undefined && value !== null);
}

/** Corps de `createTask` pour une capacité : les paramètres de pilotage du sondage n'y entrent jamais. */
export function kieTaskInput(request: ProviderRequest): KieTaskBody {
  const { params } = request;
  const aspectRatio = pick(params, 'aspectRatio', 'aspect_ratio');
  switch (request.capability) {
    case 'music.generate': {
      const instrumental = params.instrumental === true;
      return {
        model: KIE_MUSIC_TASK_MODEL,
        input: compactRecord({
          custom_mode: true,
          model: request.modelId,
          title: params.title,
          style: params.style,
          // En mode personnalisé le prompt est chanté comme paroles : il est omis pour un instrumental.
          prompt: instrumental ? undefined : params.prompt,
          instrumental,
          duration: params.duration,
        }),
      };
    }
    case 'image.generate':
      return { model: request.modelId, input: compactRecord({ prompt: params.prompt, aspect_ratio: aspectRatio }) };
    case 'image.edit':
      return { model: request.modelId, input: compactRecord({ prompt: params.prompt, image: params.image, aspect_ratio: aspectRatio }) };
    case 'video.generate':
      return { model: request.modelId, input: compactRecord({ prompt: params.prompt, duration: params.duration, aspect_ratio: aspectRatio, image: params.image }) };
    case 'tts.speak':
      return { model: request.modelId, input: compactRecord({ text: params.input, voice_id: pick(params, 'voice', 'voice_id') }) };
    default:
      throw new ProviderError(`Le protocole kie-unified ne crée pas de tâche pour « ${request.capability} ».`, 'unsupported');
  }
}

function durationOr(value: unknown, fallback: number, floor = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.max(value, floor) : fallback;
}

/** Délai d'attente et intervalle de sondage effectifs (paramètres de l'appel, sinon valeurs par défaut). */
export function kiePollTiming(capability: string, params: Record<string, unknown>): KiePollTiming {
  return {
    maxWaitMs: durationOr(params.maxWaitMs, DEFAULT_MAX_WAIT_MS[TASK_FAMILY[capability] ?? 'image']),
    pollIntervalMs: durationOr(params.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS),
  };
}
