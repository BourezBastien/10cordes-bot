import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { ActionPlanApplyHandler, ActionPlanCancelHandler } from './action-plan.handlers';
import { ActionPlanService } from './action-plan.service';

/**
 * Plans d'action : une approbation pour toutes les actions destructives
 * d'une demande, exécutées par le clic après revalidation déterministe.
 *
 * - `handlers` (et pas seulement `providers`) : sans cette clé, le framework
 *   n'enregistre AUCUNE interaction, et les boutons ✅ / ❌ seraient muets ;
 * - la porte de confirmation du registry atteint le service par l'accesseur
 *   runtime `getActionPlans` (le service injecte le registry : pas d'import
 *   dans l'autre sens) ;
 * - `AssistantService` appelle `flush` en fin de demande : c'est là que les
 *   actions en attente deviennent un plan affiché.
 *
 * Rien ici dans la classe : le framework n'instancie PAS les modules (seuls
 * providers/listeners/handlers ont un cycle de vie).
 */
@Global()
@Module({
  imports: [AuditModule, DatabaseModule, ToolRegistryModule],
  handlers: [ActionPlanApplyHandler, ActionPlanCancelHandler],
  providers: [ActionPlanService],
  exports: [ActionPlanService],
})
export class ActionPlanModule {}
