import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { IntegrationService } from './integration.service';
import { IntegrationOpenModalButtonHandler, IntegrationSaveModalHandler } from './handlers/integration.handlers';

/**
 * Intégrations chiffrées (R2) : catalogue de fournisseurs (LLM, image,
 * musique...) stockés en DB avec clés AES-256-GCM. @Global : consommé par
 * llm.service, imagelab, music, webtools et les modals dynamiques.
 */
@Global()
@Module({
  imports: [AuditModule, DatabaseModule, ToolRegistryModule],
  // handlers (et pas seulement providers) : sans la clé `handlers`, le
  // framework n'enregistre PAS les interactions - le bouton integration:llm:open
  // restait mort (tableau boot "Handlers: 0").
  handlers: [IntegrationOpenModalButtonHandler, IntegrationSaveModalHandler],
  providers: [IntegrationService],
  exports: [IntegrationService],
})
export class IntegrationModule {}
