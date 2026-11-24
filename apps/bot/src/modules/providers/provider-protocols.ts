import type { ProviderProtocol } from './provider.types';

/**
 * Ce qui distingue chaque protocole : libellé, URL de base conseillée et
 * chemin du chat. Connaissance partagée par le client LLM, les tools et le
 * panneau (les adaptateurs eux-mêmes détiennent le détail des appels).
 */

export const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  'openai-chat': 'Compatible OpenAI (OpenAI, DeepSeek, OpenRouter, Groq, Gemini...)',
  'anthropic-messages': 'Anthropic Messages (Claude)',
  'kie-unified': 'kie.ai (chat, images, musique, vidéo, voix)',
  'generic-http': 'API REST quelconque (opérations sur mesure)',
};

export const PROTOCOL_DEFAULT_BASE_URLS: Record<ProviderProtocol, string> = {
  'openai-chat': 'https://api.openai.com/v1',
  'anthropic-messages': 'https://api.anthropic.com',
  'kie-unified': 'https://api.kie.ai',
  'generic-http': '',
};

/** Protocoles dont le chat se streame en SSE par le client LLM lui-même. */
export const STREAMABLE_CHAT_PROTOCOLS: ReadonlySet<ProviderProtocol> = new Set<ProviderProtocol>(['openai-chat', 'kie-unified']);

/** Chemin de l'endpoint chat/completions, à ajouter à l'URL de base du fournisseur. */
export function chatCompletionsPath(protocol: ProviderProtocol): string {
  return protocol === 'kie-unified' ? '/v1/chat/completions' : '/chat/completions';
}
