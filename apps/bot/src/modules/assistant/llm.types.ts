/**
 * Contrats du client LLM compatible OpenAI (chat completions + tool calling).
 * Les types d'échange (messages, tools, options, résultat) vivent dans
 * `shared/llm/chat-contract.ts` : ils sont partagés avec les adaptateurs de
 * fournisseurs, qui ne doivent pas dépendre du module assistant.
 */

export * from '../../shared/llm/chat-contract';

/**
 * Statut de connexion, clé masquée (jamais la clé). La source est celle que
 * IntegrationService résout : la base (ligne chiffrée), ou l'environnement,
 * qui ne sert qu'à une base encore vide.
 */
export interface LlmStatus {
  source: 'db' | 'env' | 'none';
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  maskedKey: string | null;
}
