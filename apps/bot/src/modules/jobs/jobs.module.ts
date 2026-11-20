import { Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { JobsService } from './jobs.service';

// Jobs planifiés génériques : once/cron/interval, tick 30s + sweep boot,
// actions = schéma automatisations, templates vocabulaire unifié.
@Module({
  imports: [ToolRegistryModule],
  providers: [JobsService],
})
export class JobsModule {}
