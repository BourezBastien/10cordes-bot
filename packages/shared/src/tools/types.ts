import type { z } from 'zod';

/** Contexte d'exécution fourni au tool par son appelant (assistant, dashboard, MCP). */
export interface ToolRunContext {
  guildId: string | null;
  /** Canal d'où provient la demande — requis par les tools qui créent des plans/proposals. */
  channelId?: string | null;
  userId: string;
  locale: string;
  /**
   * Permissions Discord de l'appelant (noms des flags, ex: "ManageGuild", "Administrator").
   * Le registry refuse les tools dont `permissions` n'est pas satisfaite.
   */
  permissions: string[];
  /** Canal de réponse humain du frontend appelant (chat, vocal→TTS, dashboard). */
  reply: (message: string) => Promise<void>;
  /**
   * Envoi d'un fichier dans le salon de la demande (ou targetChannelId).
   * Optionnel : absent sur les surfaces sans fichiers (dashboard web).
   */
  sendFile?: (file: { name: string; attachment: Uint8Array | string }, targetChannelId?: string) => Promise<void>;
  /**
   * Progression longue opération : édite LA ligne de statut unique du
   * traitement (« [TOOL] analyse : 24/48 salons... »). Optionnel : absent
   * sur les surfaces sans salon (dashboard). Les tools ne postent JAMAIS
   * leurs propres messages de progression.
   */
  progress?: (text: string) => Promise<void>;
  /**
   * IDs des rôles de l'appelant (pour les permission nodes allow/deny par
   * tool, résolus côté serveur — jamais choisis par le modèle). Optionnel.
   */
  roleIds?: string[];
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
  /**
   * Permissions Discord requises (noms de flags, ex: "ManageChannels").
   * Vide/absent = exécutable par tous. "Administrator" dans les permissions de
   * l'appelant court-circuite la vérification.
   */
  permissions?: string[];
  /**
   * Portée du résultat : "guild" (défaut) = réponse publique dans le canal ;
   * "user" = info personnelle → le frontend répond en privé (MP).
   */
  scope?: 'guild' | 'user';
  /** Tier 3 (irréversible) → whitelist d'IDs + confirmation obligatoire. */
  destructive: boolean;
  /**
   * Consigne DÉDIÉE à ce tool (préconditions, effets, exemples valides/invalides,
   * cas de refus) — injectée dans le prompt de l'assistant. Un prompt par tool.
   */
  systemPrompt?: string;
  handler: (input: unknown, ctx: ToolRunContext) => Promise<ToolResult>;
}
