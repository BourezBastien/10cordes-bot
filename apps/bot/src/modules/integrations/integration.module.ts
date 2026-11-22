import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { IntegrationService } from './integration.service';

/**
 * Intégrations chiffrées (R2) : catalogue de fournisseurs (LLM, image,
 * musique...) stockés en DB avec clés AES-256-GCM. @Global : consommé par
 * llm.service, imagelab, music, webtools et les modals dynamiques.
 */
@Global()
@Module({
  imports: [AuditModule, DatabaseModule, ToolRegistryModule],
  providers: [IntegrationService],
  exports: [IntegrationService],
})
export class IntegrationModule {}
