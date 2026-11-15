import { Module } from '@spraxium/common';
import { AuditCommand, AuditRecentHandler, AuditStatsHandler } from './audit';
import { AuditService } from './audit.service';

@Module({
  commands: [AuditCommand],
  handlers: [AuditRecentHandler, AuditStatsHandler],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
