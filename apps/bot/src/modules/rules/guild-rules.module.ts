import { Module, type SpraxiumOnBoot } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { bindRegistryRuntimeDeps } from '../tool-registry/tool-registry.service';
import { GuildRulesService } from './guild-rules.service';

/** Règles serveur : store + tools agent, consommé par la Gate et le registry. */
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
  }
}
