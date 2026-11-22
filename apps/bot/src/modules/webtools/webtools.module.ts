import { Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { IntegrationModule } from '../integrations/integration.module';
import { WebToolsService } from './webtools.service';

// Tools de capacités web/fichiers : recherche, PDF, météo, GitHub, RSS.
// Pas @Global : consommés uniquement via le ToolRegistry partagé.
@Module({
  imports: [IntegrationModule, ToolRegistryModule],
  providers: [WebToolsService],
})
export class WebToolsModule {}
