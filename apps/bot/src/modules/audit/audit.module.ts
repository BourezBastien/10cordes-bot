import { Global, Module } from '@spraxium/common';
import { DatabaseModule } from '../database/database.module';
import { AuditService } from './audit.service';

// @Global : AuditService est consommé par presque tous les modules.
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
