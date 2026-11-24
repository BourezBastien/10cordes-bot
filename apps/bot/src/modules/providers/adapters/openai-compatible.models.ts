import { providerFetch, readJson } from '../provider-http';
import { detectModelKinds } from '../provider-model.kinds';
import { ProviderError, type ProviderConfig, type ProviderModel } from '../provider.types';
import { assertProviderOk } from './generic-http.errors';

/**
 * Catalogue : GET /models, la forme « compatible OpenAI » (`{ data: [{ id }] }`).
 * Quand l'entrée porte des métadonnées (sorties déclarées, capacités), elles
 * décident des familles du modèle ; sinon elles se lisent dans l'identifiant,
 * et à défaut le modèle est proposé comme modèle de conversation.
 */

/** Entrées du catalogue : l'identifiant, et l'entrée entière comme métadonnées. */
async function modelEntries(config: ProviderConfig): Promise<Array<[string, unknown]>> {
  const response = await providerFetch(config, '/models');
  await assertProviderOk(response, config);
  const data = ((await readJson(response)) as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new ProviderError('Réponse /models illisible : un tableau « data » est attendu.', 'unavailable');
  }
  return data
    .map((item) => [(item as { id?: unknown } | null)?.id, item] as [unknown, unknown])
    .filter((entry): entry is [string, unknown] => typeof entry[0] === 'string' && entry[0].length > 0);
}

/** Identifiants listés par le fournisseur. */
export async function listModelIds(config: ProviderConfig): Promise<string[]> {
  return (await modelEntries(config)).map(([id]) => id);
}

export async function discoverRemoteModels(config: ProviderConfig): Promise<ProviderModel[]> {
  return (await modelEntries(config)).map(([id, metadata]) => {
    const kinds = detectModelKinds(id, metadata);
    // Une seule famille : `kind` suffit (kindsOf la relit). Plusieurs (modèle multimodal déclaré) : toutes sont gardées.
    return { id, name: id, kind: kinds[0], ...(kinds.length > 1 ? { kinds } : {}) };
  });
}
