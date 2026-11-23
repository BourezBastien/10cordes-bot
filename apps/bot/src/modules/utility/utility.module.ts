import { Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { UtilityService } from './utility.service';

// Utilities roundup : exports, recherche d'historique, événements natifs,
// forum/fils, pins, annonces webhook, réactions.
@Module({
  imports: [ToolRegistryModule],
  providers: [UtilityService],
})
export class UtilityModule {}
