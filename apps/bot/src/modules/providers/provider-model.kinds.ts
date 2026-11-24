import { ProviderError, capabilityKind, capabilityLabel, type ModelKind, type ProviderModel } from './provider.types';

/**
 * Ce qu'un modèle sait faire. Un fournisseur compatible OpenAI ne décrit
 * presque jamais ses modèles : quand `/models` porte des métadonnées
 * (OpenRouter : `architecture.output_modalities`...), elles font foi ; sinon
 * la famille se lit dans l'identifiant, et à défaut le modèle est proposé
 * comme modèle de conversation.
 */

/** Ce qu'un modèle sait faire, en langage d'administration. */
export type ModelCapability = 'chat' | 'reasoning' | 'image' | 'audio' | 'video';

/** Familles détectées dans l'identifiant du modèle, la plus spécifique d'abord. */
const ID_HINTS: ReadonlyArray<[RegExp, ModelKind]> = [
  [/dall-e|gpt-image|flux|stable-diffusion|sdxl|sd-?3|imagen|midjourney|kandinsky|pixflux|z-image|nano-?banana|ideogram|recraft|image/iu, 'image'],
  [/veo|sora|kling|runway|pika|luma|hailuo|vidu|video/iu, 'video'],
  [/tts|speech|elevenlabs/iu, 'tts'],
  [/suno|musicgen|udio|stable-audio|music/iu, 'music'],
  [/whisper|transcri|embed|rerank/iu, 'other'],
];

/** Un identifiant qui trahit un modèle qui raisonne (liste du modèle, jamais une déduction). */
const REASONING_HINT = /(?:^|[^a-z])(?:r1|o1|o3|o4)(?:$|[^a-z0-9])|reason|thinking|qwq|gpt-5|deepseek-r/iu;

/** Sortie déclarée par les métadonnées → famille. */
const MODALITY_KIND: Readonly<Record<string, ModelKind>> = { text: 'chat', image: 'image', video: 'video', audio: 'tts' };

const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' ? [value] : []);

/** Sorties déclarées par les métadonnées, aux formes les plus répandues. */
function outputModalities(metadata: unknown): string[] {
  const record = asRecord(metadata);
  if (!record) return [];
  const architecture = asRecord(record.architecture);
  const modalities = asRecord(record.modalities);
  return [
    ...asStrings(record.output_modalities),
    ...asStrings(architecture?.output_modalities),
    ...asStrings(modalities?.output),
    ...asStrings(record.output_modality),
  ].map((modality) => modality.toLowerCase());
}

/** Capacités déclarées « vrai » par les métadonnées (`capabilities.image_generation: true`...). */
function declaredFlags(metadata: unknown): ModelKind[] {
  const flags = asRecord(asRecord(metadata)?.capabilities);
  if (!flags) return [];
  const kindOf = (key: string): ModelKind | null =>
    /image/iu.test(key) ? 'image' : /video/iu.test(key) ? 'video' : /music/iu.test(key) ? 'music' : /audio|speech|tts/iu.test(key) ? 'tts' : null;
  return Object.entries(flags).flatMap(([key, value]) => {
    const kind = kindOf(key);
    return value === true && kind ? [kind] : [];
  });
}

/** Familles que le modèle sert, la principale d'abord. */
export function detectModelKinds(id: string, metadata?: unknown): ModelKind[] {
  const declared = outputModalities(metadata);
  const kinds = new Set<ModelKind>();
  if (declared.length > 0) {
    for (const modality of declared) {
      const kind = MODALITY_KIND[modality];
      if (kind) kinds.add(kind);
    }
  }
  for (const kind of declaredFlags(metadata)) kinds.add(kind);
  if (kinds.size === 0) {
    const hinted = ID_HINTS.find(([pattern]) => pattern.test(id))?.[1];
    if (hinted) kinds.add(hinted);
  }
  if (kinds.size === 0) kinds.add('chat');
  return [...kinds];
}

/** Famille principale : la première des familles du modèle. */
export function guessModelKind(id: string, metadata?: unknown): ModelKind {
  return detectModelKinds(id, metadata)[0] ?? 'chat';
}

/** Les familles d'un modèle, quel que soit l'âge de sa fiche. */
export function kindsOf(model: Pick<ProviderModel, 'kind' | 'kinds'>): ModelKind[] {
  if (model.kinds && model.kinds.length > 0) return model.kinds;
  return model.kind ? [model.kind] : [];
}

/** Ce que le modèle sait faire, pour l'administration. */
export function modelCapabilitiesOf(model: Pick<ProviderModel, 'id' | 'kind' | 'kinds'>): ModelCapability[] {
  const kinds = kindsOf(model);
  const capabilities: ModelCapability[] = [];
  if (kinds.includes('chat')) capabilities.push(REASONING_HINT.test(model.id) ? 'reasoning' : 'chat');
  if (kinds.includes('image')) capabilities.push('image');
  if (kinds.includes('music') || kinds.includes('tts')) capabilities.push('audio');
  if (kinds.includes('video')) capabilities.push('video');
  return capabilities;
}

/**
 * Refuse de lier une capacité à un modèle du catalogue qui déclare ne pas
 * la servir, et nomme ceux qui la servent. Un modèle hors catalogue
 * (identifiant libre) passe : on ne sait pas, on ne l'interdit pas.
 */
export function assertModelServes(catalog: readonly ProviderModel[], modelId: string, capability: string, slug: string): void {
  const known = catalog.find((model) => model.id === modelId);
  const kinds = known ? kindsOf(known) : [];
  // Hors catalogue, ou capacité libre (custom.*) : on ne sait pas, on ne refuse pas.
  const wanted = capabilityKind(capability);
  if (!known || kinds.length === 0 || wanted === 'custom') return;
  if (kinds.includes(wanted)) return;
  const alternatives = catalog.filter((model) => kindsOf(model).includes(wanted)).map((model) => model.id);
  throw new ProviderError(
    `« ${modelId.slice(0, 80)} » ne sert pas ${capabilityLabel(capability).toLowerCase()} (familles détectées : ${kinds.join(', ')}). ` +
      `Modèles de ${slug} qui la servent : ${alternatives.length > 0 ? alternatives.slice(0, 8).join(', ') : 'aucun dans le catalogue ; enregistre un identifiant qui la sert'}.`,
    'invalid',
  );
}
