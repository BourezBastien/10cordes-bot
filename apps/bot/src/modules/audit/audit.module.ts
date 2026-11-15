import { Module } from '@spraxium/common';
import { DatabaseModule } from '../database/database.module';
import { AuditCommand, AuditRecentHandler, AuditStatsHandler } from './audit';
import { AuditService } from './audit.service';

@Module({
  imports: [DatabaseModule],
  commands: [AuditCommand],
  handlers: [AuditRecentHandler, AuditStatsHandler],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
