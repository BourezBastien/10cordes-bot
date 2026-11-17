import { Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { AutomationsMemberListener, AutomationsMessageListener } from './automations.listeners';
import { AutomationsService } from './automations.service';

// Automatisations créées par l'agent : module TECHNIQUE (listeners + exécution).
// Le comportement métier est décrit par les skills et les tools
// createAutomation/listAutomations/deleteAutomation.
@Module({
  imports: [DatabaseModule, AuditModule],
  listeners: [AutomationsMessageListener, AutomationsMemberListener],
  providers: [AutomationsService],
})
export class AutomationsModule {}
