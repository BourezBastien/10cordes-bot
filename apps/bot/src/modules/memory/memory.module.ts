import { Global, Module } from '@spraxium/common';
import { DatabaseModule } from '../database/database.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { GuildHistoryIngestionListener } from './guild-history-ingestion.listeners';
import { GuildHistoryIngestionService } from './guild-history-ingestion.service';
import { MemoryCuratorService } from './memory-curator.service';
import { MemoryCorrectionService } from './memory-correction.service';
import { MemoryService } from './memory.service';

// @Global : MemoryService + MemoryCuratorService + ingestion sont consommés
// par l'assistant (injection de mémoire dans le prompt) et exposent leurs
// tools via le registry partagé. MemoryCorrectionService enregistre l'outil
// memory.correct et garde les corrections (elles priment sur la mémoire).
@Global()
@Module({
  imports: [DatabaseModule, ToolRegistryModule],
  providers: [MemoryService, MemoryCuratorService, MemoryCorrectionService, GuildHistoryIngestionService],
  listeners: [GuildHistoryIngestionListener],
  exports: [MemoryService, MemoryCuratorService, MemoryCorrectionService, GuildHistoryIngestionService],
})
export class MemoryModule {}
