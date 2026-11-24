import { KIE_MODEL_CATALOG } from './adapters/kie-unified.catalog';
import { capabilityKind, type Capability, type ProviderModel, type ProviderProtocol } from './provider.types';

/**
 * Réglages par défaut de l'instance, UNE seule table pour tous les chemins
 * (premier appel d'un serveur, réconciliation au démarrage, changement de la
 * configuration d'instance) :
 *
 *   fournisseurs IA   deepseek-official (ou celui de l'hôte de l'instance), kie-ai
 *   routes            la conversation suit le fournisseur IA de l'instance,
 *                     les médias suivent kie.ai
 *
 * PixelLab n'y figure pas : c'est une intégration (API spécialisée), pas un
 * fournisseur de modèles IA. Les identifiants de modèles ne sont jamais codés
 * en dur ici : ils viennent du catalogue de l'adaptateur kie.unified.
 */

/** Marques, dans les options d'un fournisseur, de son origine : une copie d'instance suit la table ; un fournisseur créé par un administrateur n'en porte pas. */
export const INSTANCE_SOURCES = { llm: 'instance:llm', kie: 'instance:kie', pixellab: 'instance:pixellab' } as const;
export type InstanceSource = (typeof INSTANCE_SOURCES)[keyof typeof INSTANCE_SOURCES];

/** Clé réservée : le ou les modèles que la table a donnés à chaque capacité (les routes restées dessus suivent). */
const MODELS_KEY = '_models';
/** Clé réservée historique du fournisseur IA (modèle de conversation). */
const MODEL_KEY = '_model';

/** Le fournisseur kie.ai de l'instance. */
export const KIE_PROVIDER = { slug: 'kie-ai', displayName: 'kie.ai', protocol: 'kie-unified', baseUrl: 'https://api.kie.ai' } as const satisfies {
  slug: string;
  displayName: string;
  protocol: ProviderProtocol;
  baseUrl: string;
};

/** Ancien slug de la copie kie.ai : renommé, même identifiant, routes conservées. */
export const KIE_LEGACY_SLUGS = ['kie-main'] as const;

/** Routes par défaut : la conversation suit le fournisseur IA de l'instance, les médias suivent kie.ai. */
export const DEFAULT_ROUTES: ReadonlyArray<{ capability: Capability; source: InstanceSource }> = [
  { capability: 'chat.default', source: INSTANCE_SOURCES.llm },
  { capability: 'chat.reasoning', source: INSTANCE_SOURCES.llm },
  { capability: 'chat.ingestion', source: INSTANCE_SOURCES.llm },
  { capability: 'image.generate', source: INSTANCE_SOURCES.kie },
  { capability: 'image.edit', source: INSTANCE_SOURCES.kie },
  { capability: 'music.generate', source: INSTANCE_SOURCES.kie },
  { capability: 'tts.speak', source: INSTANCE_SOURCES.kie },
  { capability: 'video.generate', source: INSTANCE_SOURCES.kie },
];

/**
 * Modèle de kie.ai qui sert une capacité par défaut : le premier de sa
 * famille dans le catalogue de l'adaptateur, null si le catalogue n'en
 * déclare pas (la capacité reste alors à lier à la main).
 */
export function kieModelFor(capability: string, catalog: readonly ProviderModel[] = KIE_MODEL_CATALOG): string | null {
  const kind = capabilityKind(capability);
  return catalog.find((model) => model.kind === kind)?.id ?? null;
}

/** Origine d'instance d'un fournisseur, null pour un fournisseur créé par un administrateur. */
export function instanceSourceOf(provider: { extraConfig: Record<string, unknown> }): InstanceSource | null {
  const source = provider.extraConfig._source;
  return typeof source === 'string' && (Object.values(INSTANCE_SOURCES) as readonly string[]).includes(source) ? (source as InstanceSource) : null;
}

/** Modèle que la table avait donné à une capacité sur ce fournisseur, null si aucun. */
export function recordedModel(provider: { extraConfig: Record<string, unknown> }, capability: string): string | null {
  const models = provider.extraConfig[MODELS_KEY];
  if (models && typeof models === 'object') {
    const value = (models as Record<string, unknown>)[capability];
    if (typeof value === 'string') return value;
  }
  const single = provider.extraConfig[MODEL_KEY];
  return typeof single === 'string' ? single : null;
}

/** Options d'origine à écrire sur une copie d'instance : la marque, et le modèle donné à chaque capacité. */
export function instanceOptions(source: InstanceSource, models: Partial<Record<Capability, string>>): Record<string, unknown> {
  return { _source: source, [MODELS_KEY]: models, ...(source === INSTANCE_SOURCES.llm ? { [MODEL_KEY]: models['chat.default'] } : {}) };
}
