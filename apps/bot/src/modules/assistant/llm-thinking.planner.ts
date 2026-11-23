import type { AppEnv } from '../../app.env';
import type { AgentSettingsService } from '../guild-config/agent-settings.service';
import type { ChatOptions } from './llm.types';
import { endpointAcceptsThinking, reasoningEffortValue, shouldEnableThinkingForRequest, type ThinkingMode } from './llm-thinking';

export interface ReasoningEffortPlannerDeps {
  readonly env: Pick<AppEnv, 'LLM_EFFORT'>;
  readonly agentSettings: Pick<AgentSettingsService, 'get'>;
  /** URL de base du fournisseur configuré à l'instant T. */
  readonly baseUrl: () => string | null;
}

/**
 * Décide l'effort de raisonnement (`reasoning_effort`) d'UNE requête : une
 * seule fois, avant son premier tour, selon le réglage du serveur, l'endpoint
 * et l'intention de la demande. La valeur ne change plus ensuite.
 */
export class ReasoningEffortPlanner {
  constructor(private readonly deps: ReasoningEffortPlannerDeps) {}

  async plan(options: Pick<ChatOptions, 'userId' | 'guildId' | 'cause'>, actionIntent: boolean): Promise<string | null> {
    const effort = this.deps.env.LLM_EFFORT;
    if (!effort) return null;
    const baseUrl = this.deps.baseUrl() ?? '';
    if (!endpointAcceptsThinking(baseUrl)) return null;
    let mode: ThinkingMode = 'adaptive';
    if (options.guildId) mode = (await this.deps.agentSettings.get(options.guildId)).thinkingMode;
    return reasoningEffortValue(baseUrl, shouldEnableThinkingForRequest(mode, actionIntent), effort);
  }
}
