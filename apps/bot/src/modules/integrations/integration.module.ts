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
  providers: [
    IntegrationService,
    IntegrationOpenModalButtonHandler,
    IntegrationSaveModalHandler,
  ],
  exports: [IntegrationService],
})
export class IntegrationModule {}
