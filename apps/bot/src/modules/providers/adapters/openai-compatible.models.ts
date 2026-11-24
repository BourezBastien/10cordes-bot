import { providerFetch, readJson } from '../provider-http';
import { ProviderError, type ModelKind, type ProviderConfig, type ProviderModel } from '../provider.types';
import { assertProviderOk } from './generic-http.errors';

/**
 * Catalogue : GET /models, la forme « compatible OpenAI » (`{ data: [{ id }] }`).
 * Les endpoints ne décrivent pas leurs modèles : la famille est devinée sur
 * l'identifiant, sinon le modèle est proposé comme modèle de conversation.
 */

const KIND_HINTS: ReadonlyArray<[RegExp, ModelKind]> = [
  [/image|dall-e|flux|stable-diffusion|sd-|imagen/iu, 'image'],
  [/tts|speech/iu, 'tts'],
  [/whisper|transcri|embed/iu, 'other'],
];

/** Famille devinée sur l'identifiant du modèle. */
export function guessModelKind(id: string): ModelKind {
  return KIND_HINTS.find(([pattern]) => pattern.test(id))?.[1] ?? 'chat';
}

/** Identifiants listés par le fournisseur. */
export async function listModelIds(config: ProviderConfig): Promise<string[]> {
  const response = await providerFetch(config, '/models');
  await assertProviderOk(response, config);
  return modelIds(await readJson(response));
}

export async function discoverRemoteModels(config: ProviderConfig): Promise<ProviderModel[]> {
  return (await listModelIds(config)).map((id) => ({ id, name: id, kind: guessModelKind(id) }));
}

function modelIds(payload: unknown): string[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new ProviderError('Réponse /models illisible : un tableau « data » est attendu.', 'unavailable');
  }
  return data
    .map((item) => (item as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}
