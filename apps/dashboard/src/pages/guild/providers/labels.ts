import type { TFunction } from 'i18next';
import {
  capabilityKind,
  type CapabilityKind,
  type ModelKind,
  type NativeCapability,
  type ProviderAuthType,
  type ProviderProtocol,
} from '@10cordes/shared';
import type { Tone } from '@/ds/badge';

/*
 * LIBELLÉS DE LA PAGE IA. Les identifiants techniques (openai-chat,
 * chat.default, kie-unified) ont leur nom traduit ici ; un identifiant
 * inconnu des tableaux s'affiche tel quel, jamais sous un nom deviné.
 */

const PROTOCOL_KEY = {
  'openai-chat': 'openaiChat',
  'anthropic-messages': 'anthropicMessages',
  'kie-unified': 'kieUnified',
  'generic-http': 'genericHttp',
} as const satisfies Record<ProviderProtocol, string>;

const AUTH_KEY = {
  bearer: 'bearer',
  header: 'header',
  query: 'query',
  none: 'none',
} as const satisfies Record<ProviderAuthType, string>;

const CAPABILITY_KEY = {
  'chat.default': 'chatDefault',
  'chat.reasoning': 'chatReasoning',
  'chat.ingestion': 'chatIngestion',
  'image.generate': 'imageGenerate',
  'image.edit': 'imageEdit',
  'music.generate': 'musicGenerate',
  'tts.speak': 'ttsSpeak',
  'video.generate': 'videoGenerate',
  'web.search': 'webSearch',
} as const satisfies Record<NativeCapability, string>;

export function protocolLabel(t: TFunction, protocol: string): string {
  return protocol in PROTOCOL_KEY ? t(`providers.protocol.${PROTOCOL_KEY[protocol as ProviderProtocol]}`) : protocol;
}

export function authLabel(t: TFunction, auth: string): string {
  return auth in AUTH_KEY ? t(`providers.auth.${AUTH_KEY[auth as ProviderAuthType]}`) : auth;
}

/** Nom lisible d'une capacité ; une capacité `custom.*` garde son identifiant. */
export function capabilityLabel(t: TFunction, capability: string): string {
  return capability in CAPABILITY_KEY ? t(`providers.capability.${CAPABILITY_KEY[capability as NativeCapability]}`) : capability;
}

/** Badges de type d'un modèle, dans l'ordre d'affichage. */
export type KindBadge = 'chat' | 'reasoning' | 'image' | 'audio' | 'video' | 'web' | 'other';

const KIND_BADGE: Record<ModelKind, KindBadge> = {
  chat: 'chat',
  image: 'image',
  music: 'audio',
  tts: 'audio',
  video: 'video',
  search: 'web',
  other: 'other',
};

const BADGE_ORDER: ReadonlyArray<KindBadge> = ['chat', 'reasoning', 'image', 'audio', 'video', 'web', 'other'];

export const BADGE_TONE: Record<KindBadge, Tone> = {
  chat: 'info',
  reasoning: 'skill',
  image: 'accent',
  audio: 'ok',
  video: 'warn',
  web: 'neutral',
  other: 'neutral',
};

/*
 * Les identifiants de modèles faits pour raisonner. Le catalogue ne dit rien
 * de la réflexion : le badge « Raisonnement » se lit sur l'identifiant, et
 * c'est une indication, pas une déclaration du fournisseur.
 */
const REASONER = /reason|(^|[-_.])r1($|[-_.])|thinking|qwq/iu;

export function kindBadges(model: { id: string; kinds: ReadonlyArray<ModelKind> }): KindBadge[] {
  const badges = new Set<KindBadge>(model.kinds.map((kind) => KIND_BADGE[kind] ?? 'other'));
  if (badges.has('chat') && REASONER.test(model.id)) badges.add('reasoning');
  return BADGE_ORDER.filter((badge) => badges.has(badge));
}

/** Le type de modèle qu'il faut pour servir une capacité ; `custom` : la route décide. */
export function kindOfCapability(capability: string): CapabilityKind {
  return capabilityKind(capability);
}

/** Les modèles d'un fournisseur qui servent une capacité (tous, pour `custom`). */
export function servingModels(models: ReadonlyArray<{ id: string; kinds: ReadonlyArray<ModelKind> }>, capability: string): Array<{ id: string; kinds: ReadonlyArray<ModelKind> }> {
  const kind = kindOfCapability(capability);
  if (kind === 'custom') return [...models];
  return models.filter((model) => model.kinds.includes(kind as ModelKind));
}
