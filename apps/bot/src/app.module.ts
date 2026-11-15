import { Module } from '@spraxium/common';
import { HttpModule, HttpClientModule, LoggerMiddleware } from '@spraxium/http';
import { AuthController } from './auth/auth.controller';
import { SessionGuard } from './auth/guards/session.guard';
import { GuildAccessGuard } from './auth/guards/guild-access.guard';
import { AuditModule } from './modules/audit/audit.module';
import { DatabaseModule } from './modules/database/database.module';
import { GuildConfigModule } from './modules/guild-config/guild-config.module';
import { InfoModule } from './modules/info/info.module';
import { LocaleModule } from './modules/locale/locale.module';
import { LoggingModule } from './modules/logging/logging.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { ModuleManagerModule } from './modules/module-manager/module-manager.module';
import { GuildsController } from './modules/api/guilds.controller';
import { MetaController } from './modules/api/meta.controller';
import { PingModule } from './modules/ping/ping.module';
import { SetupModule } from './modules/setup/setup.module';
import { TagsModule } from './modules/tags/tags.module';
import { ToolRegistryModule } from './modules/tool-registry/tool-registry.module';
import { WelcomeModule } from './modules/welcome/welcome.module';

// Règle framework : @HttpClientModule et @Module sur LA MÊME classe (AppModule) —
// un second module HTTP serait ignoré silencieusement.
@HttpClientModule({
  controllers: [AuthController, MetaController, GuildsController],
  guards: [SessionGuard, GuildAccessGuard],
  middleware: [new LoggerMiddleware()],
})
@Module({
  imports: [AuditModule, DatabaseModule, HttpModule, GuildConfigModule, InfoModule, LocaleModule, LoggingModule, ModerationModule, ModuleManagerModule, PingModule, SetupModule, TagsModule, ToolRegistryModule, WelcomeModule],
  providers: [AuthController, MetaController, GuildsController],
})
export class AppModule {}
