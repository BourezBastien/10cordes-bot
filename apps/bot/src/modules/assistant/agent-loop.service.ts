import { Injectable } from '@spraxium/common';
import type { ToolResult, ToolRunContext } from '@10cordes/shared';
import { LlmService, QuotaExhaustedError, toApiToolName, type ChatCause, type ChatMessage, type OpenAiTool } from './llm.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';

const MAX_ITERATIONS = 8;

export interface AgentLoopHooks {
  /** Avant chaque appel LLM (iteration 0-based). */
  onIterationStart?(iteration: number, messages: ChatMessage[]): Promise<void> | void;
  /**
   * Avant l'exécution d'un tool : effet de bord libre (progression, snapshot)
   * et possibilité de COURT-CIRCUITER (retourner un ToolResult sans exécuter
   * le tool — ex : skipReply). Retourner undefined = exécution normale.
   * Un tool court-circuité n'entre PAS dans `executed`.
   */
  interceptToolCall?(name: string, input: unknown, iteration: number): Promise<ToolResult | undefined> | ToolResult | undefined;
  /** Après l'exécution d'un tool (audit, preState). */
  onToolResult?(name: string, result: ToolResult, input: unknown, iteration: number): Promise<void> | void;
  /** Delta de texte streamé (progressive responder du canal). */
  onDelta?(text: string): void;
  /** Message à produire quand les crédits sont épuisés (402). */
  quotaExhaustedMessage: string;
  /** Étiquette de cause pour la comptabilité llm.usage. */
  cause: ChatCause;
}

export interface AgentLoopOutcome {
  /** Texte final du modèle (null si tools sans texte, ou erreur). */
  finalText: string | null;
  /** Noms des tools réellement exécutés dans l'ordre (hors court-circuits). */
  executed: string[];
  usage: { promptTokens: number; completionTokens: number };
  error: Error | null;
  /** Vrai si le dernier appel LLM ne contenait plus de tool_calls. */
  completed: boolean;
  /** Vrai si les crédits du fournisseur étaient épuisés (402). */
  quotaExhausted?: boolean;
}

export interface AgentLoopToolset {
  /** Tools injectés à l'API LLM au départ (noyau + pertinents). */
  active: OpenAiTool[];
  /** Catalogue COMPLET pour l'expansion dynamique après search_tools. */
  byName: Map<string, OpenAiTool>;
}

/**
 * AgentLoop (Template Method, Phase 2.2) : LA boucle LLM + tools unique,
 * consommée par les deux canaux (Discord via AssistantService, dashboard via
 * WebAgentService). Le canal branche ses hooks (progression, snapshots,
 * audit, livraison) ; la mécanique d'itération, le streaming SSE, la
 * réassemblage des tool_calls et l'EXPANSION DYNAMIQUE du toolset (pattern
 * routing Anthropic : search_tools rend les tools trouvés appelables)
 * vivent ICI.
 */
@Injectable()
export class AgentLoopService {
  constructor(
    private readonly llm: LlmService,
    private readonly registry: ToolRegistryService,
  ) {}

  async run(
    messages: ChatMessage[],
    toolset: AgentLoopToolset,
    ctx: ToolRunContext,
    options: { userId: string; guildId: string | null },
    hooks: AgentLoopHooks,
  ): Promise<AgentLoopOutcome> {
    const usage = { promptTokens: 0, completionTokens: 0 };
    const executed: string[] = [];
    const openAiTools = [...toolset.active];

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      await hooks.onIterationStart?.(iteration, messages);
      let quotaExhausted = false;
      const completion = await this.llm
        .chatStream(messages, openAiTools, { userId: options.userId, guildId: options.guildId, cause: hooks.cause }, {
          onDelta: (text) => hooks.onDelta?.(text),
        })
        .catch((error: unknown) => {
          if (error instanceof QuotaExhaustedError) {
            quotaExhausted = true;
            return { content: hooks.quotaExhaustedMessage, toolCalls: [], reasoningContent: null, usage: undefined };
          }
          throw error;
        });
      if (completion.usage) {
        usage.promptTokens += completion.usage.promptTokens;
        usage.completionTokens += completion.usage.completionTokens;
      }

      if (completion.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: completion.content ?? '',
          reasoning_content: completion.reasoningContent ?? '',
          tool_calls: completion.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: toApiToolName(call.name), arguments: call.arguments },
          })),
        });
        for (const call of completion.toolCalls) {
          let input: unknown = {};
          try {
            input = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {
            input = {};
          }
          const intercepted = await hooks.interceptToolCall?.(call.name, input, iteration);
          let result: ToolResult;
          if (intercepted) {
            result = intercepted;
          } else {
            result = await this.registry.run(call.name, input, ctx);
            executed.push(call.name);
          }
          // Tool routing : search_tools élargit le toolset ACTIF avec les
          // tools trouvés — ils deviennent appelables à l'itération suivante.
          if (call.name === 'search_tools') {
            const found = (result.data?.tools as Array<{ name: string }> | undefined) ?? [];
            for (const card of found) {
              const openAiTool = toolset.byName.get(card.name);
              if (openAiTool && !openAiTools.some((tool) => tool.function.name === openAiTool.function.name)) {
                openAiTools.push(openAiTool);
              }
            }
          }
          await hooks.onToolResult?.(call.name, result, input, iteration);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 4000),
          });
        }
        continue;
      }

      return {
        finalText: completion.content ?? null,
        executed,
        usage,
        error: null,
        completed: true,
        ...(quotaExhausted ? { quotaExhausted: true } : {}),
      };
    }

    return { finalText: null, executed, usage, error: null, completed: false };
  }
}
