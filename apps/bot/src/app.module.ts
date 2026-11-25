import { Module } from '@spraxium/common';
import { ComponentsModule } from '@spraxium/components';
import { HttpModule, HttpClientModule, LoggerMiddleware } from '@spraxium/http';
import { AuthController } from './auth/auth.controller';
import { getValidatedEnv } from './auth/env.accessor';
import { trustedOriginsOf } from './auth/auth-origins';
import { ApiModule } from './modules/api/api.module';
import { ApiPolicyMiddleware } from './modules/api/api-policy.middleware';
import { AgentSettingsController } from './modules/api/agent-settings.controller';
import { CapabilitiesController } from './modules/api/capabilities.controller';
import { EventsController } from './modules/api/events.controller';
import { IntegrationsController } from './modules/api/integrations.controller';
import { PanelController } from './modules/api/panel.controller';
import { ProvidersController } from './modules/api/providers.controller';
import { RulesController } from './modules/api/rules.controller';
import { UsageController } from './modules/api/usage.controller';
import { WebhooksController } from './modules/api/webhooks.controller';
import { AgentModule } from './modules/agent/agent.module';
import { SurfaceModule } from './modules/surface/surface.module';
import { GuildRulesModule } from './modules/rules/guild-rules.module';
import { IntegrationModule } from './modules/integrations/integration.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { AuditModule } from './modules/audit/audit.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { DatabaseModule } from './modules/database/database.module';
import { GuildConfigModule } from './modules/guild-config/guild-config.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { ImagelabModule } from './modules/imagelab/imagelab.module';
import { LoggingModule } from './modules/logging/logging.module';
import { MemoryModule } from './modules/memory/memory.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { ModuleManagerModule } from './modules/module-manager/module-manager.module';
import { GuildsController } from './modules/api/guilds.controller';
import { LegalController } from './modules/api/legal.controller';
import { MetaController } from './modules/api/meta.controller';
import { HealthController } from './modules/health/health.controller';
import { HealthMonitor } from './modules/health/health.monitor';
import { HealthModule } from './modules/health/health.module';
import { ToolRegistryModule } from './modules/tool-registry/tool-registry.module';
import { ActionPlanModule } from './modules/action-plan/action-plan.module';
// Ordre d'importation obligatoire : ces deux modules globaux sont chargés par
// ActionPlanModule et AssistantModule, qui injectent leurs services dès leur
// chargement ; importés après eux, ils vaudraient « cannot resolve dependency ».
// HealthModule, lui, vient EN DERNIER : son service d'extinction injecte la
// file de l'assistant. Un service injecté par un contrôleur HTTP doit venir
// d'un module global (le serveur construit les contrôleurs dans le conteneur
// racine) : voir app.module.scopes.spec.ts.
import { UsageModule } from './modules/usage/usage.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

import { WebToolsModule } from './modules/webtools/webtools.module';
import { MusicModule } from './modules/music/music.module';
import { VoiceModule } from './modules/voice/voice.module';
import { ServerlifeModule } from './modules/serverlife/serverlife.module';
import { SecurityModule } from './modules/security/security.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { RecordsModule } from './modules/records/records.module';
import { UtilityModule } from './modules/utility/utility.module';

// Règle framework : @HttpClientModule et @Module sur LA MÊME classe (AppModule) :
// un second module HTTP serait ignoré silencieusement.
// Guards scoping : SessionGuard + GuildAccessGuard sont posés PAR CONTRÔLEUR
// (@HttpGuards) : /legal, /api/auth et le panel doivent rester publics.
// Pas de clé API globale : ProbeKeyGuard protège /healthz seul ; les routes
// du dashboard s'authentifient par la session, et ApiPolicyMiddleware vérifie
// l'origine de toute requête de l'API qui modifie (les origines sont lues à
// la requête : ce middleware est construit avant l'environnement).
// Ordre des contrôleurs = ordre d'enregistrement des routes : le panel
// fourre-tout (GET /*) reste le DERNIER, sinon il répondrait 404 à la place
// de toute route d'API déclarée après lui.
@HttpClientModule({
  controllers: [
    AuthController,
    MetaController,
    GuildsController,
    LegalController,
    HealthController,
    EventsController,
    ProvidersController,
    CapabilitiesController,
    IntegrationsController,
    RulesController,
    AgentSettingsController,
    UsageController,
    WebhooksController,
    PanelController,
  ],
  middleware: [new LoggerMiddleware(), new ApiPolicyMiddleware(() => trustedOriginsOf(getValidatedEnv().DASHBOARD_ORIGIN))],
})
@Module({
  imports: [
    DatabaseModule,
    ComponentsModule,
    AuditModule,
    ApiModule,
    HttpModule,
    GuildConfigModule,
    ProvidersModule,
    ImagelabModule,
    LoggingModule,
    MemoryModule,
    ModerationModule,
    ModuleManagerModule,
    ToolRegistryModule,
    UsageModule,
    WebhooksModule,
    ActionPlanModule,
    WebToolsModule,
    MusicModule,
    VoiceModule,
    ServerlifeModule,
    SecurityModule,
    JobsModule,
    RecordsModule,
    UtilityModule,
    AutomationsModule,
    AgentModule,
    SurfaceModule,
    GuildRulesModule,
    IntegrationModule,
    AssistantModule,
    HealthModule,
  ],
  providers: [
    AuthController,
    MetaController,
    GuildsController,
    LegalController,
    HealthController,
    EventsController,
    PanelController,
    ProvidersController,
    CapabilitiesController,
    IntegrationsController,
    RulesController,
    AgentSettingsController,
    UsageController,
    WebhooksController,
    HealthMonitor,
  ],
})
export class AppModule {}
