/**
 * Contrats du client LLM compatible OpenAI (chat completions + tool calling).
 * Types purs, importables sans charger le service ni le graphe DI.
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
}

/** Statut de connexion, clé masquée (jamais la clé). */
export interface LlmStatus {
  source: 'modal' | 'env' | 'none';
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  maskedKey: string | null;
}
