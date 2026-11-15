import { Global, Module } from '@spraxium/common';
import { DatabaseModule } from '../database/database.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { MemoryService } from './memory.service';

// @Global : MemoryService est consommé par l'assistant (injection de mémoire
// dans le prompt) et expose ses tools via le registry partagé.
@Global()
@Module({
  imports: [DatabaseModule, ToolRegistryModule],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
