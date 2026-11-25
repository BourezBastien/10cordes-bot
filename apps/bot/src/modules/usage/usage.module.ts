import { Global, Module } from '@spraxium/common';
import { DatabaseModule } from '../database/database.module';
import { UsageLogService } from './usage-log.service';
import { UsageReaderService } from './usage-reader.service';

// @Global : UsageLogService est écrit par la boucle de l'agent et par les
// plans d'action, UsageReaderService est lu par l'API du dashboard.
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [UsageLogService, UsageReaderService],
  exports: [UsageLogService, UsageReaderService],
})
export class UsageModule {}
