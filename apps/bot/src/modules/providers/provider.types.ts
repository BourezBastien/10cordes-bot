import type { ChatCompletionResult, ChatMessage, ChatOptions, OpenAiTool } from '../../shared/llm/chat-contract';
import { CapabilitySchema, capabilityKind as kindOfCapability, CAPABILITY_KINDS, MODEL_KINDS, NATIVE_CAPABILITIES, PROVIDER_AUTH_TYPES, PROVIDER_PROTOCOLS } from '@10cordes/shared';
import type { CapabilityKind, ModelKind, NativeCapability, ProviderAuthType, ProviderProtocol } from '@10cordes/shared';

/**
 * Moteur multi-fournisseurs : contrats. Un serveur connecte des fournisseurs
 * (API + clé chiffrée) et associe chaque capacité du bot au modèle d'un
 * fournisseur. Toute capacité `custom.*` est acceptée.
 *
 * Les protocoles, types d'authentification et capacités natives sont définis
 * dans @10cordes/shared (contrat du panel) et réexportés ici : le bot et le
 * dashboard lisent la même liste.
 */

export { CAPABILITY_KINDS, MODEL_KINDS, NATIVE_CAPABILITIES, PROVIDER_AUTH_TYPES, PROVIDER_PROTOCOLS };
export type { CapabilityKind, ModelKind, NativeCapability, ProviderAuthType, ProviderProtocol };

export type Capability = NativeCapability | `custom.${string}`;

export const CAPABILITY_LABELS: Record<NativeCapability, string> = {
  'chat.default': 'Conversation (défaut)',
  'chat.reasoning': 'Raisonnement (actions complexes)',
  'chat.ingestion': 'Ingestion et mémoire',
  'image.generate': 'Génération d\u0027image',
  'image.edit': 'Édition d\u0027image',
  'music.generate': 'Musique',
  'tts.speak': 'Voix (TTS)',
  'video.generate': 'Vidéo',
  'web.search': 'Recherche web',
};

export function isCapability(value: string): value is Capability {
  return CapabilitySchema.safeParse(value).success;
}

/** Famille d'une capacité : détermine quels modèles proposer. */
export const capabilityKind = kindOfCapability;

export function capabilityLabel(capability: string): string {
  return (CAPABILITY_LABELS as Record<string, string>)[capability] ?? capability.slice('custom.'.length);
}

/** Origine d'un modèle du catalogue : lu chez le fournisseur, ou slug saisi à la main (il survit à un rafraîchissement du catalogue). */
export type ModelOrigin = 'discovered' | 'manual';

/** Un modèle que propose un fournisseur. */
export interface ProviderModel {
  id: string;
  name?: string;
  /** Famille principale (la première de `kinds`). */
  kind?: ModelKind;
  /** Toutes les familles que le modèle sert, détectées (métadonnées de `/models`, sinon identifiant) ou posées à la main. Absent : `kind` seule. */
  kinds?: ModelKind[];
  contextWindow?: number;
  maxOutput?: number;
  /** Absente : découvert (la forme historique du catalogue). */
  origin?: ModelOrigin;
}

/** Un fournisseur, prêt à l'emploi. */
export interface ProviderConfig {
  id: string;
  guildId: string;
  slug: string;
  displayName: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  authType: ProviderAuthType;
  authHeaderName: string | null;
  /** DÉCHIFFRÉE. En mémoire seulement : jamais dans un résultat de tool, un audit ou un presenter. */
  apiKey: string | null;
  customHeaders: Record<string, string>;
  extraConfig: Record<string, unknown>;
  models: ProviderModel[];
  enabled: boolean;
}

export interface ConnectionCheckResult {
  ok: boolean;
  summary: string;
  modelsFound: number;
}

export interface ProviderRequest {
  capability: Capability;
  modelId: string;
  params: Record<string, unknown>;
}

export interface ProviderExecutionResult {
  ok: boolean;
  summary: string;
  data: Record<string, unknown>;
}

/** Un tour de conversation, au format interne du bot. */
export interface ChatTurnInput {
  /** Modèle qui exécute ce tour (celui de la route, ou de son repli). */
  modelId: string;
  messages: ChatMessage[];
  tools: OpenAiTool[];
  options: ChatOptions;
  /** Delta de texte SÛR (déjà filtré) quand l'adaptateur streame. */
  onDelta?: (text: string) => void;
}

export type ChatResult = ChatCompletionResult;

/** De quoi appeler un fournisseur pour une capacité hors conversation (musique, image...). */
export interface CapabilityCredentials {
  apiKey: string;
  baseUrl: string;
  modelId: string;
}

export type ProviderErrorKind = 'invalid' | 'auth' | 'quota' | 'rate-limit' | 'unavailable' | 'timeout' | 'unsupported' | 'http';

/** Erreur typée d'un fournisseur. Le message ne contient jamais la clé. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: ProviderErrorKind,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Erreurs qui déclenchent la bascule sur le fournisseur de repli. */
const FALLBACK_KINDS: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>(['rate-limit', 'unavailable', 'timeout']);

export function isFallbackEligible(error: unknown): boolean {
  return error instanceof ProviderError && FALLBACK_KINDS.has(error.kind);
}
