import { Global, Module } from '@spraxium/common';
import { DatabaseModule } from '../database/database.module';
import { AuditRecentHandler, AuditStatsHandler } from './audit';
import { AuditService } from './audit.service';
import { SetupCommand } from '../setup/setup.schema';

// @Global : AuditService est consommé par presque tous les modules.
@Global()
@Module({
  imports: [DatabaseModule],
  commands: [SetupCommand],
  handlers: [AuditRecentHandler, AuditStatsHandler],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
