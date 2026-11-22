import { Module } from '@spraxium/common';
import { ComponentsModule } from '@spraxium/components';
import { HttpModule, HttpClientModule, LoggerMiddleware } from '@spraxium/http';
import { AuthController } from './auth/auth.controller';
import { SessionGuard } from './auth/guards/session.guard';
import { GuildAccessGuard } from './auth/guards/guild-access.guard';
import { AgentModule } from './modules/agent/agent.module';
import { SurfaceModule } from './modules/surface/surface.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { AuditModule } from './modules/audit/audit.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { DatabaseModule } from './modules/database/database.module';
import { GuildConfigModule } from './modules/guild-config/guild-config.module';
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
import { RolesModule } from './modules/roles/roles.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { ToolRegistryModule } from './modules/tool-registry/tool-registry.module';
import { WelcomeModule } from './modules/welcome/welcome.module';
import { WebToolsModule } from './modules/webtools/webtools.module';
import { MusicModule } from './modules/music/music.module';
import { VoiceModule } from './modules/voice/voice.module';
import { PollsModule } from './modules/polls/polls.module';
import { ServerlifeModule } from './modules/serverlife/serverlife.module';
import { SecurityModule } from './modules/security/security.module';
import { InvitesModule } from './modules/invites/invites.module';
import { LevelsModule } from './modules/levels/levels.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { RecordsModule } from './modules/records/records.module';
import { UtilityModule } from './modules/utility/utility.module';

// Règle framework : @HttpClientModule et @Module sur LA MÊME classe (AppModule) —
// un second module HTTP serait ignoré silencieusement.
// Guards scoping : SessionGuard + GuildAccessGuard sont posés PAR CONTRÔLEUR
// (@HttpGuards) — /legal et /api/auth doivent rester publics.
@HttpClientModule({
  controllers: [AuthController, MetaController, GuildsController, LegalController, HealthController],
  middleware: [new LoggerMiddleware()],
})
@Module({
  imports: [
    DatabaseModule,
    ComponentsModule,
    AuditModule,
    HttpModule,
    GuildConfigModule,
    ImagelabModule,
    LoggingModule,
    MemoryModule,
    ModerationModule,
    ModuleManagerModule,
    RolesModule,
    TicketsModule,
    ToolRegistryModule,
    WebToolsModule,
    MusicModule,
    VoiceModule,
    PollsModule,
    ServerlifeModule,
    SecurityModule,
    InvitesModule,
    LevelsModule,
    JobsModule,
    RecordsModule,
    UtilityModule,
    AutomationsModule,
    AgentModule,
    SurfaceModule,
    AssistantModule,
    WelcomeModule,
  ],
  providers: [AuthController, MetaController, GuildsController, LegalController, HealthController, HealthMonitor],
})
export class AppModule {}
