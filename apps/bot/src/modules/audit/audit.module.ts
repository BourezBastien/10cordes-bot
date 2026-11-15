import { Global, Module } from '@spraxium/common';
import { DatabaseModule } from '../database/database.module';
import { AuditCommand, AuditRecentHandler, AuditStatsHandler } from './audit';
import { AuditService } from './audit.service';

// @Global : AuditService est consommé par presque tous les modules.
@Global()
@Module({
  imports: [DatabaseModule],
  commands: [AuditCommand],
  handlers: [AuditRecentHandler, AuditStatsHandler],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
