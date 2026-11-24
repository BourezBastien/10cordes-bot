import type { ProviderModel } from '../provider.types';
import { asList, asNumber, asRecord, asText } from './kie-unified.json';

/**
 * Catalogue STATIQUE de kie.ai : uniquement des identifiants déjà prouvés dans
 * ce dépôt (music.service : V6_MINI, V6 ; webtools-kie-image : z-image).
 * L'endpoint des modèles ne liste que le CHAT : tout le reste (les modèles de
 * conversation) vient de `KieUnifiedAdapter.discoverModels`. Un modèle vidéo,
 * voix ou édition d'image absent de cette liste se saisit à la main.
 */
export const KIE_MODEL_CATALOG: readonly ProviderModel[] = [
  { id: 'V6_MINI', name: 'Suno V6_MINI', kind: 'music' },
  { id: 'V6', name: 'Suno V6', kind: 'music' },
  { id: 'z-image', name: 'Z-Image (Tongyi-MAI)', kind: 'image' },
];

/**
 * Décode `GET /openai/v1/models`. La réponse officielle porte les DEUX formes
 * pour les mêmes modèles : `models[]` (riche : slug, display_name,
 * context_window) et `data[]` (OpenAI : id seul). On dédoublonne sur
 * l'identifiant, la forme riche d'abord.
 */
export function decodeKieModels(payload: unknown): ProviderModel[] {
  const root = asRecord(payload);
  const models = new Map<string, ProviderModel>();
  for (const entry of asList(root.models)) {
    const item = asRecord(entry);
    const id = asText(item.slug) ?? asText(item.id);
    if (!id) continue;
    const contextWindow = asNumber(item.context_window);
    models.set(id, { id, name: asText(item.display_name) ?? id, kind: 'chat', ...(contextWindow !== undefined ? { contextWindow } : {}) });
  }
  for (const entry of asList(root.data)) {
    const id = asText(asRecord(entry).id);
    if (id && !models.has(id)) models.set(id, { id, name: id, kind: 'chat' });
  }
  return [...models.values()];
}
