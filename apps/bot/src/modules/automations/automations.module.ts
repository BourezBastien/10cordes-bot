import { Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { AutomationsMemberJoinListener, AutomationsMemberLeaveListener, AutomationsMessageListener } from './automations.listeners';
import { AutomationsService } from './automations.service';

// Automatisations créées par l'agent : module TECHNIQUE (listeners + exécution).
// Le comportement métier est décrit par les skills et les tools
// createAutomation/listAutomations/deleteAutomation.
@Module({
  imports: [DatabaseModule, AuditModule],
  listeners: [AutomationsMessageListener, AutomationsMemberJoinListener, AutomationsMemberLeaveListener],
  providers: [AutomationsService],
})
export class AutomationsModule {}
