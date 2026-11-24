import type { AppEnv } from '../../app.env';
import type { AgentSettingsService } from '../guild-config/agent-settings.service';
import type { ChatOptions } from './llm.types';
import { endpointAcceptsThinking, reasoningEffortValue, shouldEnableThinkingForRequest, type ThinkingMode } from './llm-thinking';

export interface ReasoningEffortPlannerDeps {
  readonly env: Pick<AppEnv, 'LLM_EFFORT'>;
  readonly agentSettings: Pick<AgentSettingsService, 'get'>;
  /** URL de base du fournisseur d'instance (modale owner ou env). */
  readonly baseUrl: () => string | null;
}

/**
 * Décide l'effort de raisonnement (`reasoning_effort`) d'UNE requête : une
 * seule fois, avant son premier tour, selon le réglage du serveur, l'endpoint
 * et l'intention de la demande. La valeur ne change plus ensuite.
 */
export class ReasoningEffortPlanner {
  constructor(private readonly deps: ReasoningEffortPlannerDeps) {}

  /**
   * La requête doit-elle penser, selon le réglage du serveur ? Indépendant de
   * l'endpoint : c'est elle qui choisit la capacité de conversation
   * (`chat.reasoning` ou `chat.default`), l'effort envoyé en découle.
   */
  async wants(options: Pick<ChatOptions, 'guildId'>, actionIntent: boolean): Promise<boolean> {
    let mode: ThinkingMode = 'adaptive';
    if (options.guildId) mode = (await this.deps.agentSettings.get(options.guildId)).thinkingMode;
    return shouldEnableThinkingForRequest(mode, actionIntent);
  }

  /** `baseUrl` : celle du fournisseur qui exécutera la requête ; absente, celle de l'instance. */
  async plan(options: Pick<ChatOptions, 'userId' | 'guildId' | 'cause'>, actionIntent: boolean, baseUrl?: string | null): Promise<string | null> {
    const effort = this.deps.env.LLM_EFFORT;
    if (!effort) return null;
    const url = baseUrl ?? this.deps.baseUrl() ?? '';
    if (!endpointAcceptsThinking(url)) return null;
    return reasoningEffortValue(url, await this.wants(options, actionIntent), effort);
  }
}
