import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { ImagelabModule } from '../imagelab/imagelab.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { GuildRulesModule } from '../rules/guild-rules.module';
import { IntegrationModule } from '../integrations/integration.module';
import { ProvidersModule } from '../providers/providers.module';
import { CacheModule } from '../../shared/cache/cache.module';
import { SkillPatternDetector } from '../agent/skill-pattern.detector';
import { AssistantMentionListener } from './listeners/assistant-mention.listener';
import { AssistantQueue } from './assistant.queue';
import { AgentLoopService } from './agent-loop.service';
import { AssistantService } from './assistant.service';
import { LlmService } from './llm.service';
import { TypingIndicator } from './typing-indicator';

import { WebAgentService } from './web-agent.service';
import { RequestProgressService } from './request-progress.service';

import { ResponseCacheService } from './response-cache.service';

import { BootRecoveryService } from './boot-recovery.service';
import { AgentDecisionJournal } from './agent-decision.journal';

// @Global : LlmService + AssistantQueue + WebAgentService consommés par la
// santé et l'API dashboard fournie au niveau AppModule : sans ça, les exports
// restent confinés au container du premier chargeur transitif.
// CacheModule : SkillPatternDetector (Learning Loop P3.2) utilise ICacheStore.
// ProvidersModule : chaque tour part sur le modèle que le serveur a routé (CapabilityRouterService).
// AgentDecisionJournal : une ligne par demande traitée par le modèle, purgée à 14 jours.
@Global()
@Module({
  imports: [AuditModule, CacheModule, GuildConfigModule, GuildRulesModule, ImagelabModule, IntegrationModule, ProvidersModule, ToolRegistryModule],
  listeners: [AssistantMentionListener],
  providers: [
    TypingIndicator,
    AssistantQueue,
    AgentDecisionJournal,
    AgentLoopService,
    SkillPatternDetector,
    AssistantService,
    LlmService,
    WebAgentService,
    RequestProgressService,
    ResponseCacheService,
    BootRecoveryService,
  ],
  exports: [LlmService, AssistantQueue, WebAgentService, RequestProgressService, ResponseCacheService],
})
export class AssistantModule {}
