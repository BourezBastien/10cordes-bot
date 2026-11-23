import { Injectable } from '@spraxium/common';
import type { ToolResult, ToolRunContext } from '@10cordes/shared';
import { LlmService, QuotaExhaustedError, toApiToolName, type ChatCause, type ChatMessage, type OpenAiTool } from './llm.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { fileLog } from '../logging/file-log.service';
import { stringifySafe } from '../../shared/utils/object';

/**
 * R0.2 : plafond relevé à 12 pour les constructions multi-étapes (un casino
 * complet = catégories + salons + surfaces + triggers dépasse 8 tours).
 */
const MAX_ITERATIONS = 12;

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
  /**
   * Texte d'une itération SANS tool_calls, commis pour publication
   * progressive (R0.2 : le texte d'une itération AVEC tool_calls n'arrive
   * JAMAIS ici — il va à onIntermediateText pour la narration LiveStatus).
   */
  onDelta?(text: string): void;
  /** Texte intermédiaire d'une itération qui contient des tool_calls : narration LiveStatus uniquement, jamais publié. */
  onIntermediateText?(text: string): void;
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
  /** Vrai si le tour final de synthèse forcé (tool_choice none) a été utilisé. */
  forcedSummary?: boolean;
}

export interface AgentLoopToolset {
  /** Tools injectés à l'API LLM au départ (noyau + pertinents). */
  active: OpenAiTool[];
  /** Catalogue COMPLET pour l'expansion dynamique après search_tools. */
  byName: Map<string, OpenAiTool>;
}

/**
 * AgentLoop (Template Method) : LA boucle LLM + tools unique, consommée par
 * les deux canaux (Discord via AssistantService, dashboard via
 * WebAgentService). R0.2 — FIN DES PHRASES COUPÉES :
 * - le texte d'une itération est BUFFERISÉ et ne va au responder que si
 *   l'itération ne contient AUCUN tool_call (sinon : LiveStatus uniquement) ;
 * - plafond 12 itérations ;
 * - tour final de synthèse GARANTI : si le plafond est atteint, un dernier
 *   appel avec tool_choice:'none' force le modèle à conclure proprement.
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
      const iterationStartedAt = Date.now();
      let quotaExhausted = false;
      // R0.2 : buffer PAR itération — les deltas ne sont commis au responder
      // qu'à la fin de l'itération, et seulement sans tool_calls.
      let iterationText = '';
      const completion = await this.llm
        .chatStream(messages, openAiTools, { userId: options.userId, guildId: options.guildId, cause: hooks.cause }, {
          onDelta: (text) => {
            iterationText += text;
          },
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
      fileLog()?.llm({
        cause: hooks.cause,
        model: 'runtime',
        promptTokens: completion.usage?.promptTokens ?? 0,
        completionTokens: completion.usage?.completionTokens ?? 0,
        ms: Date.now() - iterationStartedAt,
        ok: !quotaExhausted,
      });
      fileLog()?.event('info', 'loop', 'iteration', {
        iteration,
        toolCalls: completion.toolCalls.length,
        textChars: iterationText.length,
        thrownAway: completion.toolCalls.length > 0 && iterationText.trim().length > 0,
      });

      if (completion.toolCalls.length > 0) {
        // Le texte de CE tour contient des tool_calls : il n'est JAMAIS
        // publié — narration LiveStatus seulement (le récap viendra du tour
        // final sans tool_calls).
        if (iterationText.trim().length > 0) hooks.onIntermediateText?.(iterationText);
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
            // stringifySafe : un BigInt dans data (agrégat SQL) faisait planter
            // toute la requête, l'exception étant hors du try/catch du registry.
            content: stringifySafe(result).slice(0, 4000),
          });
        }
        continue;
      }

      // Tour sans tool_calls : le texte bufferisé est commis au responder
      // (publication progressive) puis retourné comme texte final.
      if (iterationText.length > 0) hooks.onDelta?.(iterationText);
      return {
        finalText: completion.content ?? (iterationText.trim().length > 0 ? iterationText : null),
        executed,
        usage,
        error: null,
        completed: true,
        ...(quotaExhausted ? { quotaExhausted: true } : {}),
      };
    }

    // Plafond atteint : TOUR FINAL DE SYNTHÈSE FORCÉ (tool_choice none) —
    // le modèle DOIT conclure (récapitulatif complet), sans appel d'outil.
    await hooks.onIterationStart?.(MAX_ITERATIONS, messages);
    const summary = await this.llm
      .chatStream(
        messages,
        openAiTools,
        { userId: options.userId, guildId: options.guildId, cause: hooks.cause },
        {
          toolChoice: 'none',
          onDelta: (text) => hooks.onDelta?.(text),
        },
      )
      .catch(() => null);
    if (summary?.usage) {
      usage.promptTokens += summary.usage.promptTokens;
      usage.completionTokens += summary.usage.completionTokens;
    }
    const finalText = summary?.content ?? 'Terminé (plafond d\u2019itérations atteint) : demande-moi le récapitulatif si besoin.';
    return {
      finalText,
      executed,
      usage,
      error: null,
      completed: true,
      forcedSummary: true,
    };
  }
}
