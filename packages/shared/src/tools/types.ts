import type { z } from 'zod';

/** Contexte d'exécution fourni au tool par son appelant (assistant, dashboard, MCP). */
export interface ToolRunContext {
  guildId: string | null;
  /** Canal d'où provient la demande : requis par les tools qui créent des plans/proposals. */
  channelId?: string | null;
  userId: string;
  /** Référence de la demande, posée par l'appelant : portée par chaque ligne d'audit et de journal de ses tools. */
  requestId?: string;
  /**
   * Autorisation de cette exécution, posée par le serveur seul (jamais par le
   * modèle) : plan approuvé au clic, action d'un membre sur une surface,
   * tâche du système. Une action ainsi autorisée n'est jamais remise en
   * attente d'approbation, ni celles qu'elle déclenche.
   */
  approvedBy?: string;
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
   * Progression d\u0027une opération longue (« analyse : 24/48 salons... »).
   * Optionnel : absent sur les surfaces sans suivi (dashboard). Rien ne
   * s\u0027affiche dans le salon : la progression part dans le journal. Les tools
   * ne postent JAMAIS leurs propres messages de progression.
   */
  progress?: (text: string) => Promise<void>;
  /**
   * IDs des rôles de l'appelant (pour les permission nodes allow/deny par
   * tool, résolus côté serveur, jamais choisis par le modèle). Optionnel.
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
 * Chaque MODULE exporte ses tools : même registry pour l'assistant chat/vocal,
 * le dashboard et le futur serveur MCP over HTTP.
 */
export interface BotTool {
  /** Nom namespacé : "config.get", "moderation.warn", "image.icon"… */
  name: string;
  description: string;
  /** Id du module propriétaire : sert au filtrage par modules actifs du serveur. */
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
  /**
   * Noms des paramètres qui transportent un secret (clé API...) : leur valeur
   * est MASQUÉE dans l'audit de l'appel. Le résultat du tool ne doit jamais
   * les restituer non plus.
   */
  sensitiveInputs?: string[];
  /** Tier 3 (irréversible) → whitelist d'IDs + confirmation obligatoire. */
  destructive: boolean;
  /**
   * Mots-clés de routage, en langue courante ("panneau", "bouton", "schedule") :
   * le nom et la description ne suffisent pas toujours à retrouver un tool.
   * Un mot de la demande qui COMMENCE par un mot-clé le classe dans les tools
   * pertinents (selectRelevantTools, search_tools).
   */
  keywords?: string[];
  /**
   * Consigne DÉDIÉE à ce tool (préconditions, effets, exemples valides/invalides,
   * cas de refus). Injectée dans le prompt de l'assistant pour les tools
   * épinglés du noyau ; pour les autres, montrée dans la carte de search_tools.
   */
  systemPrompt?: string;
  handler: (input: unknown, ctx: ToolRunContext) => Promise<ToolResult>;
}

/**
 * Factory typée pour déclarer un tool SANS cast `input as` : le handler
 * reçoit l'input déjà typé `z.infer<T>`. La validation reste faite par le
 * registry (safeParse avec refus actionnable) AVANT l'appel, donc le narrowing
 * interne est donc sûr par construction, et le cast n'existe plus qu'ICI.
 */
export function defineTool<T extends z.ZodType>(
  def: Omit<BotTool, 'handler' | 'paramsSchema'> & {
    paramsSchema: T;
    handler: (input: z.infer<T>, ctx: ToolRunContext) => Promise<ToolResult>;
  },
): BotTool {
  return {
    ...def,
    handler: (input: unknown, ctx: ToolRunContext) => def.handler(input as z.infer<T>, ctx),
  };
}
