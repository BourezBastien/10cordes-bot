import type { z } from 'zod';

/** Contexte d'exécution fourni au tool par son appelant (assistant, dashboard, MCP). */
export interface ToolRunContext {
  guildId: string | null;
  userId: string;
  locale: string;
  /** Canal de réponse humain du frontend appelant (chat, vocal→TTS, dashboard). */
  reply: (message: string) => Promise<void>;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
}

/**
 * Contrat d'un tool du registry (MCP interne).
 * Chaque MODULE exporte ses tools — même registry pour l'assistant chat/vocal,
 * le dashboard et le futur serveur MCP over HTTP.
 */
export interface BotTool {
  /** Nom namespacé : "config.get", "moderation.warn", "image.icon"… */
  name: string;
  description: string;
  /** Id du module propriétaire — filtrage par modules actifs du serveur. */
  category: string;
  /** Schéma Zod des paramètres : validation à l'exécution + futur schéma LLM. */
  paramsSchema: z.ZodType;
  /** Modules obligatoires pour exécuter ce tool. */
  requiredModules: string[];
  /** Tier 3 (irréversible) → whitelist d'IDs + confirmation obligatoire. */
  destructive: boolean;
  /**
   * Consigne DÉDIÉE à ce tool (préconditions, effets, exemples valides/invalides,
   * cas de refus) — injectée dans le prompt de l'assistant. Un prompt par tool.
   */
  systemPrompt?: string;
  handler: (input: unknown, ctx: ToolRunContext) => Promise<ToolResult>;
}
