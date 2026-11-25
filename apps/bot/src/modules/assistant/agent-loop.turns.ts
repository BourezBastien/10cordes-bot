import { LlmFormatLeakError } from './llm.errors';
import type { LlmService } from './llm.service';
import type { ChatCause, ChatCompletionResult, ChatMessage, ChatOptions, OpenAiTool } from './llm.types';
import { fileLog } from '../logging/file-log.service';
import type { UsageLogService } from '../usage/usage-log.service';

/** Options identiques sur tous les tours d'une même requête. */
export type TurnOptions = ChatOptions & { reasoningEffort: string | null; preferReasoning: boolean | undefined };

/** Un tour LLM exécuté : sa réponse et le texte reçu (jeté quand le tour porte des tool_calls). */
export interface LoopTurn {
  completion: ChatCompletionResult;
  text: string;
}

/**
 * Les tours LLM de la boucle : l'appel, le rejeu après une fuite de balises
 * internes, et la ligne du journal des coûts. Chaque appel réel passe par
 * le compteur de tours de la boucle, et entre dans la comptabilité du
 * serveur (journal des appels au modèle).
 */
export class LoopTurns {
  constructor(
    private readonly llm: LlmService,
    private readonly usage: UsageLogService,
  ) {}

  /**
   * Un tour, texte bufferisé. Si le modèle laisse fuir ses balises internes
   * (LlmFormatLeakError), le tour est rejoué UNE fois à identique, le texte
   * déjà reçu étant jeté ; une seconde fuite fait échouer la requête.
   */
  async run(messages: ChatMessage[], openAiTools: OpenAiTool[], options: TurnOptions, onCall: () => void): Promise<LoopTurn> {
    let text = '';
    const stream = async (): Promise<ChatCompletionResult> => {
      text = '';
      onCall();
      return this.llm.chatStream(messages, openAiTools, options, {
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

  /**
   * Ligne du journal LLM d'un tour : le modèle qui a réellement répondu
   * (fournisseur de la route du serveur, ou de son repli), sa durée, la
   * référence de la demande et son serveur. La comptabilité du serveur
   * reçoit les mêmes valeurs, calculées une seule fois : les deux journaux
   * ne peuvent pas diverger.
   */
  log(completion: ChatCompletionResult, cause: ChatCause, ms: number, ok: boolean, requestId?: string, guildId?: string | null): void {
    const model = completion.served?.model ?? 'runtime';
    const provider = completion.served?.provider;
    const fallback = completion.served?.fallback;
    const capability = completion.served?.capability;
    const promptTokens = completion.usage?.promptTokens ?? 0;
    const completionTokens = completion.usage?.completionTokens ?? 0;
    fileLog()?.llm({ cause, model, provider, fallback, capability, promptTokens, completionTokens, ms, ok, requestId, guildId: guildId ?? undefined });
    this.usage.record({ guildId: guildId ?? null, requestId: requestId ?? null, cause, capability: capability ?? null, provider: provider ?? null, model, fallback: fallback === true, promptTokens, completionTokens, ms, ok });
  }
}
