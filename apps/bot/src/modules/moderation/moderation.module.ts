import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ModBanHandler, ModKickHandler, ModPurgeHandler, ModUnbanHandler } from './handlers/mod-sanctions.handler';
import { ModCaseHandler, ModCasesHandler, ModBanInfoHandler, ModMuteInfoHandler, ModWarningsHandler } from './handlers/mod-info.handler';
import { ModTimeoutHandler, ModUntimeoutHandler, ModWarnHandler } from './handlers/mod-warn.handler';
import { ModDerankHandler, ModRestoreRolesHandler } from './handlers/mod-roles.handler';
import { ModerationService } from './moderation.service';
import { SetupCommand } from '../setup/setup.schema';

// @Global : ModerationService est utilisé par l'agent admin et le tool-registry.
@Global()
@Module({
  imports: [AuditModule, GuildConfigModule],
  commands: [SetupCommand],
  handlers: [
    ModWarnHandler,
    ModWarningsHandler,
    ModTimeoutHandler,
    ModUntimeoutHandler,
    ModKickHandler,
    ModBanHandler,
    ModUnbanHandler,
    ModPurgeHandler,
    ModCaseHandler,
    ModCasesHandler,
    ModBanInfoHandler,
    ModMuteInfoHandler,
    ModDerankHandler,
    ModRestoreRolesHandler,
  ],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
