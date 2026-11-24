import type { ChatCompletionResult, ChatMessage, ChatOptions, OpenAiTool } from '../../shared/llm/chat-contract';

/**
 * Moteur multi-fournisseurs : contrats. Un serveur connecte des fournisseurs
 * (API + clé chiffrée) et associe chaque capacité du bot au modèle d'un
 * fournisseur. Toute capacité `custom.*` est acceptée.
 */

export const PROVIDER_PROTOCOLS = ['openai-chat', 'anthropic-messages', 'kie-unified', 'generic-http'] as const;
export type ProviderProtocol = (typeof PROVIDER_PROTOCOLS)[number];

export const PROVIDER_AUTH_TYPES = ['bearer', 'header', 'query', 'none'] as const;
export type ProviderAuthType = (typeof PROVIDER_AUTH_TYPES)[number];

/** Familles de capacités : le type de modèle qu'il faut pour la servir. */
export const CAPABILITY_KINDS = ['chat', 'image', 'music', 'tts', 'video', 'search', 'custom'] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export const NATIVE_CAPABILITIES = [
  'chat.default',
  'chat.reasoning',
  'chat.ingestion',
  'image.generate',
  'image.edit',
  'music.generate',
  'tts.speak',
  'video.generate',
  'web.search',
] as const;
export type NativeCapability = (typeof NATIVE_CAPABILITIES)[number];
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

const CUSTOM_CAPABILITY_RE = /^[a-z0-9][a-z0-9_.-]{1,47}$/u;

export function isCapability(value: string): value is Capability {
  return (NATIVE_CAPABILITIES as readonly string[]).includes(value) || (value.startsWith('custom.') && CUSTOM_CAPABILITY_RE.test(value));
}

/** Famille d'une capacité : détermine quels modèles proposer. */
export function capabilityKind(capability: string): CapabilityKind {
  const head = capability.split('.')[0] ?? '';
  return (CAPABILITY_KINDS as readonly string[]).includes(head) ? (head as CapabilityKind) : 'custom';
}

export function capabilityLabel(capability: string): string {
  return (CAPABILITY_LABELS as Record<string, string>)[capability] ?? capability.slice('custom.'.length);
}

export type ModelKind = 'chat' | 'image' | 'music' | 'tts' | 'video' | 'search' | 'other';

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
