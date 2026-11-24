/**
 * Contrat d'échange entre un client LLM et ses consommateurs (boucle de
 * l'agent, pipeline de surfaces, conservateur de mémoire). Types purs, sans
 * dépendance : les adaptateurs de fournisseurs (modules/providers) et le
 * client LLM (modules/assistant) les partagent.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  /** Requis sur le message assistant qui précède des messages tool (exigé par l'API). */
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  /** Modèle thinking : le reasoning_content doit être renvoyé tel quel à l'écho assistant. */
  reasoning_content?: string | null;
}

export interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatCompletionResult {
  content: string | null;
  reasoningContent: string | null;
  toolCalls: ToolCallRequest[];
  usage?: ChatUsage;
  /** Qui a réellement exécuté le tour (moteur multi-fournisseurs) : la capacité routée, son fournisseur ou celui de repli. */
  served?: { provider: string; model: string; fallback: boolean; capability?: string };
}

export type ChatCause = 'reply' | 'web' | 'consolidation' | 'triage' | 'memory.ingestion';

export interface ChatOptions {
  /** 'none' = forcer un tour final de synthèse sans tool_calls (R0.2). */
  toolChoice?: 'auto' | 'none';
  userId: string;
  guildId: string | null;
  cause: ChatCause;
  /**
   * Valeur de `reasoning_effort` décidée UNE FOIS par requête, avant le
   * premier tour, et gardée identique sur tous ses tours (null = désactivé).
   * Absent seulement pour un appel isolé hors boucle.
   */
  reasoningEffort?: string | null;
  /**
   * La requête réclame le raisonnement (réglage du serveur + intention de la
   * demande) : le tour part sur la capacité `chat.reasoning` quand elle est
   * routée, sinon `chat.default`. Décidé UNE fois avec `reasoningEffort`,
   * avant le premier tour, et gardé sur tous les tours : le modèle d'une
   * requête ne change pas en cours de boucle.
   */
  preferReasoning?: boolean;
}
