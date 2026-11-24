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

import { WebAgentService } from './web-agent.service';

import { ResponseCacheService } from './response-cache.service';

import { BootRecoveryService } from './boot-recovery.service';

// @Global : LlmService + AssistantQueue + WebAgentService consommés par la
// santé et l'API dashboard fournie au niveau AppModule : sans ça, les exports
// restent confinés au container du premier chargeur transitif.
// CacheModule : SkillPatternDetector (Learning Loop P3.2) utilise ICacheStore.
// ProvidersModule : chaque tour part sur le modèle que le serveur a routé (CapabilityRouterService).
@Global()
@Module({
  imports: [AuditModule, CacheModule, GuildConfigModule, GuildRulesModule, ImagelabModule, IntegrationModule, ProvidersModule, ToolRegistryModule],
  listeners: [AssistantMentionListener],
  providers: [AssistantQueue, AgentLoopService, SkillPatternDetector, AssistantService, LlmService, WebAgentService, ResponseCacheService, BootRecoveryService],
  exports: [LlmService, AssistantQueue, WebAgentService, ResponseCacheService],
})
export class AssistantModule {}
