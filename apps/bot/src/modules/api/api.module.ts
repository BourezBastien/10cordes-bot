import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { DashboardEventsService } from './dashboard-events.service';

// @Global : le temps réel du panel est lu par le contrôleur des événements et par les diagnostics.
@Global()
@Module({
  imports: [AuditModule],
  providers: [DashboardEventsService],
  exports: [DashboardEventsService],
})
export class ApiModule {}
