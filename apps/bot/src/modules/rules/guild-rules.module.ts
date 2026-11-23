import { Global, Module, type SpraxiumOnBoot } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { bindRegistryRuntimeDeps } from '../tool-registry/tool-registry.service';
import { bindGuildRules } from './guild-rules.runtime';
import { GuildRulesService } from './guild-rules.service';

/**
 * Règles serveur : store + tools agent, consommé par la Gate (listener
 * assistant), le registry (confirmation destructive) et les deux canaux
 * de prompt (SERVER_RULES). @Global : le service doit être résoluble depuis
 * AssistantModule SANS import (gotcha Spraxium : les exports d'un module
 * partagé n'atterrissent que dans le conteneur du premier importateur).
 */
@Global()
@Module({
  imports: [AuditModule, DatabaseModule, ToolRegistryModule],
  providers: [GuildRulesService],
  exports: [GuildRulesService],
})
export class GuildRulesModule implements SpraxiumOnBoot {
  constructor(private readonly rules: GuildRulesService) {}

  onBoot(): void {
    // Le registry lit les règles (confirmation destructive) via cet accesseur
    // runtime : ToolRegistryModule se charge AVANT ce module (ordre AppModule).
    bindRegistryRuntimeDeps({ rules: this.rules });
    // Idem pour ConfigThreadService (GuildConfigModule se charge avant nous).
    bindGuildRules(this.rules);
  }
}
