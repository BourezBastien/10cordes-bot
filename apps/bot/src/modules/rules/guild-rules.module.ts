import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { GuildRulesService } from './guild-rules.service';

/**
 * Règles serveur : store + tools agent, consommé par la Gate (listener
 * assistant), le registry (confirmation destructive) et les deux canaux
 * de prompt (SERVER_RULES). @Global : le service doit être résoluble depuis
 * AssistantModule SANS import (gotcha Spraxium : les exports d'un module
 * partagé n'atterrissent que dans le conteneur du premier importateur).
 *
 * Rien dans la classe : le framework n'instancie PAS les modules. Les liaisons
 * runtime (registry, accesseur getGuildRules) sont faites dans
 * GuildRulesService.onBoot. L'ancien onBoot de module ne s'est JAMAIS exécuté.
 */
@Global()
@Module({
  imports: [AuditModule, DatabaseModule, ToolRegistryModule],
  providers: [GuildRulesService],
  exports: [GuildRulesService],
})
export class GuildRulesModule {}
