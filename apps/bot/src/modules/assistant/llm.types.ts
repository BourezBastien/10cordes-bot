/**
 * Contrats du client LLM compatible OpenAI (chat completions + tool calling).
 * Les types d'échange (messages, tools, options, résultat) vivent dans
 * `shared/llm/chat-contract.ts` : ils sont partagés avec les adaptateurs de
 * fournisseurs, qui ne doivent pas dépendre du module assistant.
 */

export * from '../../shared/llm/chat-contract';

/** Statut de connexion, clé masquée (jamais la clé). */
export interface LlmStatus {
  source: 'modal' | 'env' | 'none';
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  maskedKey: string | null;
}
