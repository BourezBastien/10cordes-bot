import { normalizeProviderUrl } from './provider-http';
import type { ResolvedRoute, ProviderInput } from './provider-store.service';
import type { Capability, ProviderConfig, ProviderModel } from './provider.types';
import { DEFAULT_ROUTES, INSTANCE_SOURCES, KIE_PROVIDER, instanceOptions, instanceSourceOf, kieModelFor, recordedModel, type InstanceSource } from './instance-defaults';

/**
 * Plan d'application des réglages par défaut de l'instance à UN serveur.
 * Fonction pure : l'état du serveur entre, la liste des changements sort.
 *
 * Deux règles gardent la main de l'administrateur :
 *   - une route tenue par un fournisseur qu'il a créé lui-même n'est jamais
 *     touchée (seules les copies d'instance suivent la table) ;
 *   - sur une copie d'instance, une route dont il a changé le modèle garde
 *     ce modèle.
 */

/** Configuration d'instance d'une intégration, telle qu'IntegrationService la résout. */
export interface InstanceConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface DefaultsInput {
  providers: ProviderConfig[];
  routes: ResolvedRoute[];
  llm: InstanceConfig | null;
  kie: InstanceConfig | null;
  catalog?: readonly ProviderModel[];
}

export interface InstanceProviderStep {
  source: InstanceSource;
  /** Fournisseur existant (identifiant conservé), null pour une création. */
  providerId: string | null;
  /** Slug visé : celui de la table, avec un suffixe `-instance` s'il est pris, sauf pour une copie existante qui garde le sien. */
  slug: string;
  /** Écrire le fournisseur : création, ou clé, URL, nom ou modèles enregistrés qui diffèrent. */
  write: boolean;
  input: ProviderInput;
}

export interface DefaultsPlan {
  providers: InstanceProviderStep[];
  routes: Array<{ capability: Capability; source: InstanceSource; modelId: string; keepFallback: boolean }>;
  /** Fournisseurs d'instance à retirer (ancienne copie PixelLab : c'est une intégration, plus un fournisseur). */
  removals: Array<{ providerId: string; slug: string }>;
}

/** Slug lisible depuis un hôte : api.deepseek.com → deepseek-official, api.openrouter.ai → openrouter. */
export function slugFromHost(host: string): string {
  const labels = host.toLowerCase().split('.').filter((label) => label && !['www', 'api', 'ai', 'com', 'io', 'net', 'dev'].includes(label));
  const base = labels.at(-2) ?? labels[0] ?? 'fournisseur';
  return base === 'deepseek' ? 'deepseek-official' : base;
}

function hostOf(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return null;
  }
}

/** Modèles enregistrés identiques (à l'ordre des clés près). */
function sameRecord(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return left === right;
  const sort = (value: Record<string, unknown>): string => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return sort(left as Record<string, unknown>) === sort(right as Record<string, unknown>);
}

/**
 * Slug d'une copie d'instance à créer : celui de la table, ou un suffixe
 * `-instance` s'il est pris. Le slug d'un fournisseur créé par un
 * administrateur n'est jamais repris : l'écriture passe par le slug, le
 * reprendre réécrirait sa ligne.
 */
function freeSlug(wanted: string, taken: readonly string[]): string {
  if (!taken.includes(wanted)) return wanted;
  const base = `${wanted}-instance`;
  return [base, ...Array.from({ length: 20 }, (_, index) => `${base}-${index + 2}`)].find((slug) => !taken.includes(slug)) ?? base;
}

/** Création, alignement ou rien pour un fournisseur d'instance. */
function planProvider(source: InstanceSource, existing: ProviderConfig | null, wanted: ProviderInput, taken: readonly string[]): InstanceProviderStep {
  if (!existing) {
    const slug = freeSlug(wanted.slug, taken);
    return { source, providerId: null, slug, write: true, input: { ...wanted, slug } };
  }
  // Copie existante sous un slug qu'un autre fournisseur porte déjà : elle garde le sien.
  const slug = taken.includes(wanted.slug) ? existing.slug : wanted.slug;
  const same =
    existing.slug === slug &&
    existing.displayName === wanted.displayName &&
    existing.protocol === wanted.protocol &&
    normalizeProviderUrl(existing.baseUrl) === normalizeProviderUrl(wanted.baseUrl) &&
    existing.apiKey === wanted.apiKey &&
    sameRecord(existing.extraConfig._models, wanted.extraConfig?._models);
  // La mise à jour passe par le slug actuel : même ligne, même identifiant.
  return { source, providerId: existing.id, slug, write: !same, input: { ...wanted, slug: existing.slug, enabled: existing.enabled } };
}

export function planInstanceDefaults(input: DefaultsInput): DefaultsPlan {
  const plan: DefaultsPlan = { providers: [], routes: [], removals: [] };
  const copyOf = (source: InstanceSource): ProviderConfig | null => input.providers.find((provider) => instanceSourceOf(provider) === source) ?? null;
  const slugs = input.providers.map((provider) => provider.slug);

  const llm = input.llm?.apiKey ? input.llm : null;
  const llmHost = llm?.baseUrl ? hostOf(llm.baseUrl) : null;
  if (llm && llmHost) {
    const conversation = ['chat.default', 'chat.reasoning', 'chat.ingestion'] as const;
    plan.providers.push(
      planProvider(
        INSTANCE_SOURCES.llm,
        copyOf(INSTANCE_SOURCES.llm),
        {
          slug: slugFromHost(llmHost),
          displayName: `IA (${llmHost})`,
          protocol: 'openai-chat',
          baseUrl: llm.baseUrl ?? '',
          apiKey: llm.apiKey,
          extraConfig: instanceOptions(INSTANCE_SOURCES.llm, llm.model ? Object.fromEntries(conversation.map((capability) => [capability, llm.model ?? ''])) : {}),
        },
        slugs,
      ),
    );
  }

  if (input.kie?.apiKey) {
    const models = Object.fromEntries(
      DEFAULT_ROUTES.filter((route) => route.source === INSTANCE_SOURCES.kie)
        .map((route) => [route.capability, kieModelFor(route.capability, input.catalog)] as const)
        .filter((entry): entry is readonly [Capability, string] => Boolean(entry[1])),
    );
    plan.providers.push(
      planProvider(INSTANCE_SOURCES.kie, copyOf(INSTANCE_SOURCES.kie), { ...KIE_PROVIDER, apiKey: input.kie.apiKey, extraConfig: instanceOptions(INSTANCE_SOURCES.kie, models) }, slugs),
    );
  }

  for (const { capability, source } of DEFAULT_ROUTES) {
    const step = plan.providers.find((entry) => entry.source === source);
    if (!step) continue;
    const modelId = source === INSTANCE_SOURCES.llm ? input.llm?.model ?? '' : kieModelFor(capability, input.catalog) ?? '';
    // Famille absente du catalogue : la capacité reste à lier à la main.
    if (!modelId) continue;
    const current = input.routes.find((route) => route.capability === capability) ?? null;
    const currentSource = current ? instanceSourceOf(current.provider) : null;
    // Route d'un administrateur : jamais touchée.
    if (current && !currentSource) continue;
    const sameProvider = current?.provider.id === step.providerId;
    if (current && currentSource === source && sameProvider) {
      // Déjà conforme, ou modèle changé par l'administrateur sur la copie : il le garde.
      if (current.modelId === modelId || recordedModel(current.provider, capability) !== current.modelId) continue;
    }
    plan.routes.push({ capability, source, modelId, keepFallback: Boolean(current && currentSource === source && sameProvider) });
  }

  for (const legacy of input.providers.filter((provider) => instanceSourceOf(provider) === INSTANCE_SOURCES.pixellab)) {
    plan.removals.push({ providerId: legacy.id, slug: legacy.slug });
  }
  return plan;
}
