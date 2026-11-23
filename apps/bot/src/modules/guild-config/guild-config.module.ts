import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { GuildConfigService } from './guild-config.service';
import { AgentSettingsService } from './agent-settings.service';
import { ConfigThreadService } from './config-thread.service';

// @Global : GuildConfigService est l'infra de configuration partagée par tous
// les modules ; AgentSettingsService (thinking adaptatif) et ConfigThreadService
// (fil ⚙️┃config-bot + tools de vue) vivent dans la même famille.
// GuildRules/Integrations consommés via accesseurs runtime (ce module se
// charge AVANT eux dans AppModule ; l'import de module crée un cycle TDZ).
@Global()
@Module({
  imports: [AuditModule],
  providers: [GuildConfigService, AgentSettingsService, ConfigThreadService],
  exports: [GuildConfigService, AgentSettingsService],
})
export class GuildConfigModule {}
