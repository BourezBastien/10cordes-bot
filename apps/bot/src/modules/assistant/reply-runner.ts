import { Logger } from '@spraxium/logger';
import type { SkillPatternDetector } from '../agent/skill-pattern.detector';
import type { AuditService } from '../audit/audit.service';
import type { CacheStoreService } from '../../shared/cache/cache-store.service';
import { describeError, stackExcerpt } from '../../shared/utils/error-stack';
import { fileLog } from '../logging/file-log.service';
import type { AgentLoopService } from './agent-loop.service';
import { archiveServerSnapshot, requiresServerSnapshot } from './agent-history';
import type { ConversationContext } from './conversation-context';
import { QUOTA_EXHAUSTED_MESSAGE, QuotaExhaustedError } from './llm.errors';
import type { LlmService } from './llm.service';

const log = new Logger('Assistant');

/** Résultat de la boucle, avant toute livraison. */
export interface ReplyRunOutcome {
  /** Texte final du modèle (null si erreur, ou tools sans texte). */
  finalText: string | null;
  /** Noms des tools réellement exécutés, dans l'ordre. */
  executed: string[];
  usage: { promptTokens: number; completionTokens: number };
  /** Nombre d'appels LLM de la demande. */
  turns: number;
  error: Error | null;
}

export interface ReplyRunnerDeps {
  readonly loop: AgentLoopService;
  readonly llm: LlmService;
  readonly audit: AuditService;
  readonly patterns: SkillPatternDetector;
  readonly cacheStore: CacheStoreService;
}

/**
 * Exécute la boucle LLM + tools d'une demande et OBSERVE son déroulement :
 * instantané avant le premier tool structurel, audit de chaque tool (ok: true
 * est le seul succès), apprentissage des patterns. Rien ne s'affiche pendant
 * le traitement. Ne décide jamais de ce qui est livré au salon.
 */
export class AgentReplyRunner {
  constructor(private readonly deps: ReplyRunnerDeps) {}

  async run(conversation: ConversationContext): Promise<ReplyRunOutcome> {
    const { guild, request, requestId, session, toolset, runContext, messages } = conversation;
    const { loop, llm, audit, patterns, cacheStore } = this.deps;
    const outcome: ReplyRunOutcome = {
      finalText: null,
      executed: [],
      usage: { promptTokens: 0, completionTokens: 0 },
      turns: 0,
      error: null,
    };
    let snapshotTaken = false;

    // THINKING STABLE : l'effort et le modèle (capacité de conversation) se
    // décident ICI, une seule fois, et restent identiques sur tous les tours.
    const plan = await llm.planRequest({ userId: request.userId, guildId: guild.id, cause: 'reply' }, conversation.intent.action);

    const loopOutcome = await loop
      .run(messages, toolset, runContext, { userId: request.userId, guildId: guild.id, requestId, ...plan }, {
        cause: 'reply',
        quotaExhaustedMessage: QUOTA_EXHAUSTED_MESSAGE,
        onIterationStart: (iteration) => {
          log.info(`[FLOW][${requestId}] chat #${iteration + 1} : ${messages.length} messages en entrée`);
        },
        interceptToolCall: async (name) => {
          if (name === 'skipReply') {
            session.requestSilence();
            return { ok: true, summary: 'Compris : aucune réponse ne sera envoyée après les actions.' };
          }
          // Premier tool structurel de la demande : instantané complet du
          // serveur en audit AVANT toute modification (rollback garanti).
          if (!snapshotTaken && requiresServerSnapshot(name)) {
            snapshotTaken = true;
            archiveServerSnapshot(audit, guild, request.userId, requestId);
          }
          return undefined;
        },
        onToolResult: (name, result) => {
          const resultData = result.data as { preState?: Record<string, unknown> } | undefined;
          audit.record({
            guildId: guild.id,
            source: 'agent',
            action: `assistant.tool.${name}`,
            actorId: request.userId,
            metadata: {
              requestId,
              ok: result.ok,
              summary: result.summary.slice(0, 200),
              preState: (resultData as Record<string, unknown> | undefined)?.preState ?? undefined,
            },
          });
          // P3.2 Learning Loop : empreinte d'intention (seuil 3, 14 j, ICacheStore).
          if (result.ok && !name.startsWith('search_') && !name.startsWith('get') && !name.startsWith('records.read')) {
            void patterns
              .record({
                store: cacheStore.active,
                guildId: guild.id,
                userId: request.userId,
                categories: [name.split('.')[0]],
                toolNames: [name],
                hadMutation: true,
              })
              .catch(() => {});
          }
        },
      })
      .catch((error: unknown) => {
        log.info(`[FLOW][${requestId}] boucle ERREUR : ${error instanceof Error ? error.message : String(error)}`);
        // La console ne garde que le message ; le journal garde la nature de l'erreur et sa pile, tronquée.
        fileLog()?.event('error', 'loop', 'loop.error', { requestId, guildId: guild.id, error: describeError(error), stack: stackExcerpt(error) });
        outcome.error = error instanceof Error ? error : new Error(String(error));
        return null;
      });

    if (loopOutcome) {
      outcome.finalText = loopOutcome.finalText;
      outcome.executed.push(...loopOutcome.executed);
      outcome.usage.promptTokens += loopOutcome.usage.promptTokens;
      outcome.usage.completionTokens += loopOutcome.usage.completionTokens;
      outcome.turns = loopOutcome.turns;
      if (loopOutcome.quotaExhausted) {
        outcome.error = new QuotaExhaustedError();
      }
    }
    return outcome;
  }
}
