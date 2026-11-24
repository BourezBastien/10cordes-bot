import { Injectable } from '@spraxium/common';
import type { ToolResult, ToolRunContext } from '@10cordes/shared';
import { LlmFormatLeakError, LlmService, QuotaExhaustedError, toApiToolName, type ChatCause, type ChatCompletionResult, type ChatMessage, type ChatOptions, type OpenAiTool } from './llm.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { fileLog } from '../logging/file-log.service';
import { stringifySafe } from '../../shared/utils/object';

/**
 * R0.2 : plafond relevé à 12 pour les constructions multi-étapes (un casino
 * complet = catégories + salons + surfaces + triggers dépasse 8 tours).
 */
const MAX_ITERATIONS = 12;

/** Relance du dernier tour, quand le plafond est atteint. */
const SUMMARY_NUDGE =
  'NB : la limite d\u0027étapes de cette demande est atteinte. N\u0027appelle plus aucun outil. Réponds maintenant au demandeur, en texte : ce qui a été fait, et ce qui reste à faire.';

export interface AgentLoopHooks {
  /** Avant chaque appel LLM (iteration 0-based). */
  onIterationStart?(iteration: number, messages: ChatMessage[]): Promise<void> | void;
  /**
   * Avant l'exécution d'un tool : effet de bord libre (progression, snapshot)
   * et possibilité de COURT-CIRCUITER (retourner un ToolResult sans exécuter
   * le tool : ex skipReply). Retourner undefined = exécution normale.
   * Un tool court-circuité n'entre PAS dans `executed`.
   */
  interceptToolCall?(name: string, input: unknown, iteration: number): Promise<ToolResult | undefined> | ToolResult | undefined;
  /** Après l'exécution d'un tool (audit, preState). */
  onToolResult?(name: string, result: ToolResult, input: unknown, iteration: number): Promise<void> | void;
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
  /** Vrai si le tour final de conclusion a été utilisé. */
  forcedSummary?: boolean;
}

export interface AgentLoopToolset {
  /** Tools injectés à l'API LLM au départ (noyau + pertinents). */
  active: OpenAiTool[];
  /** Catalogue COMPLET pour l'expansion dynamique après search_tools. */
  byName: Map<string, OpenAiTool>;
}

/** Options identiques sur tous les tours d'une même requête. */
export type TurnOptions = ChatOptions & { reasoningEffort: string | null; preferReasoning: boolean | undefined };

export interface AgentLoopRequest {
  userId: string;
  guildId: string | null;
  /**
   * Effort de raisonnement de TOUTE la requête, décidé par l'appelant avant
   * le premier tour. Absent : la boucle le décide elle-même une fois, avant
   * le premier tour, et le garde identique sur tous les tours.
   */
  reasoningEffort?: string | null;
  /** Même règle pour le modèle : la requête part sur `chat.reasoning` ou `chat.default`, sur tous ses tours. */
  preferReasoning?: boolean;
}

/** Message honnête au plafond : la demande n'est PAS terminée, on dit ce qui a été fait et comment reprendre. */
export function ceilingMessage(executed: readonly string[]): string {
  if (executed.length === 0) {
    return 'J\u0027ai atteint ma limite d\u0027étapes sans pouvoir agir. Reformule ta demande de façon plus directe.';
  }
  const actions = [...new Set(executed)];
  return (
    `Limite d\u0027étapes atteinte après ${executed.length} action(s) : la demande n\u0027est pas terminée. ` +
    `Dernières actions : ${actions.slice(-6).join(', ')}. Écris « continue » pour que je reprenne où je me suis arrêté.`
  );
}

/**
 * AgentLoop (Template Method) : LA boucle LLM + tools unique, consommée par
 * les deux canaux (Discord via AssistantService, dashboard via
 * WebAgentService).
 * - le texte d'un tour à tool_calls est JETÉ (jamais montré) : seul le texte
 *   du dernier tour, sans tool_calls, est la réponse, livrée en une fois ;
 * - plafond 12 itérations, puis un dernier tour de conclusion ;
 * - THINKING STABLE : l'effort de raisonnement se décide UNE fois, avant le
 *   premier tour, et reste identique sur toute la requête.
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
    options: AgentLoopRequest,
    hooks: AgentLoopHooks,
  ): Promise<AgentLoopOutcome> {
    const usage = { promptTokens: 0, completionTokens: 0 };
    const executed: string[] = [];
    const openAiTools = [...toolset.active];

    // THINKING STABLE : l'effort ET la capacité de conversation (donc le
    // modèle) se décident UNE fois, par l'appelant ou ici, et restent
    // identiques sur tous les tours de la requête.
    const plan =
      options.reasoningEffort !== undefined
        ? { reasoningEffort: options.reasoningEffort, preferReasoning: options.preferReasoning }
        : await this.llm.planRequest({ userId: options.userId, guildId: options.guildId, cause: hooks.cause }, openAiTools.length > 0);
    const callOptions: TurnOptions = { userId: options.userId, guildId: options.guildId, cause: hooks.cause, reasoningEffort: plan.reasoningEffort, preferReasoning: plan.preferReasoning };

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      await hooks.onIterationStart?.(iteration, messages);
      const iterationStartedAt = Date.now();
      let quotaExhausted = false;
      // Texte bufferisé PAR itération. Le texte d'un tour à tool_calls n'est
      // JAMAIS la réponse : il est jeté (tracé dans le journal).
      const turn = await this.chatTurn(messages, openAiTools, callOptions).catch((error: unknown) => {
        if (error instanceof QuotaExhaustedError) {
          quotaExhausted = true;
          const notice: ChatCompletionResult = { content: hooks.quotaExhaustedMessage, toolCalls: [], reasoningContent: null, usage: undefined };
          return { completion: notice, text: '' };
        }
        throw error;
      });
      const completion = turn.completion;
      const iterationText = turn.text;
      if (completion.usage) {
        usage.promptTokens += completion.usage.promptTokens;
        usage.completionTokens += completion.usage.completionTokens;
      }
      fileLog()?.llm({
        cause: hooks.cause,
        // Le modèle qui a réellement répondu (fournisseur de la route du serveur, ou de son repli).
        model: completion.served?.model ?? 'runtime',
        provider: completion.served?.provider,
        fallback: completion.served?.fallback,
        capability: completion.served?.capability,
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
          // Tool routing : search_tools ET openSkill élargissent le toolset
          // ACTIF avec les tools annoncés dans `data.tools`. Ils deviennent
          // appelables à l'itération suivante : une recette ouverte n'exige
          // plus une recherche par tool (chaque recherche coûte un tour).
          if (call.name === 'search_tools' || call.name === 'openSkill') {
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

      // Tour sans tool_calls : son texte est la réponse, livrée en une fois par l'appelant.
      return {
        finalText: completion.content ?? (iterationText.trim().length > 0 ? iterationText : null),
        executed,
        usage,
        error: null,
        completed: true,
        ...(quotaExhausted ? { quotaExhausted: true } : {}),
      };
    }

    // Plafond atteint : DERNIER TOUR de conclusion. Sans `tool_choice: 'none'`
    // (un modèle bridé par `none` au milieu d'un montage écrivait ses appels
    // d'outil en texte brut) : il est prié de conclure, et tout tool_call est
    // ignoré. Sans texte utilisable, un message honnête remplace le tour.
    await hooks.onIterationStart?.(MAX_ITERATIONS, messages);
    // Ignoré s'il appelle encore un outil : seul son texte est la réponse, et rien n'est publié en cours de route.
    const summary = await this.llm.chatStream([...messages, { role: 'user', content: SUMMARY_NUDGE }], openAiTools, callOptions, {}).catch(() => null);
    if (summary?.usage) {
      usage.promptTokens += summary.usage.promptTokens;
      usage.completionTokens += summary.usage.completionTokens;
    }
    const summaryText = summary && summary.toolCalls.length === 0 ? (summary.content?.trim() ?? '') : '';
    return {
      finalText: summaryText || ceilingMessage(executed),
      executed,
      usage,
      error: null,
      completed: true,
      forcedSummary: true,
    };
  }

  /**
   * Un tour LLM, texte bufferisé. Si le modèle laisse fuir ses balises
   * internes (LlmFormatLeakError), le tour est rejoué UNE fois à identique,
   * le texte déjà reçu étant jeté ; une seconde fuite fait échouer la requête.
   */
  private async chatTurn(
    messages: ChatMessage[],
    openAiTools: OpenAiTool[],
    callOptions: TurnOptions,
  ): Promise<{ completion: ChatCompletionResult; text: string }> {
    let text = '';
    const stream = async (): Promise<ChatCompletionResult> => {
      text = '';
      return this.llm.chatStream(messages, openAiTools, callOptions, {
        onDelta: (delta) => {
          text += delta;
        },
      });
    };
    try {
      return { completion: await stream(), text };
    } catch (error) {
      if (!(error instanceof LlmFormatLeakError)) throw error;
      fileLog()?.event('warn', 'loop', 'turn_leak_retried', { sample: error.sample });
      const completion = await stream();
      return { completion, text };
    }
  }
}
