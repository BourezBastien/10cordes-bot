import { Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { IntegrationModule } from '../integrations/integration.module';
import { ProvidersModule } from '../providers/providers.module';
import { WebToolsService } from './webtools.service';

// Tools de capacités web/fichiers : recherche, PDF, météo, GitHub, RSS.
// Pas @Global : consommés uniquement via le ToolRegistry partagé.
// ProvidersModule : la clé et le modèle de l'image kie.ai viennent de la route du serveur.
@Module({
  imports: [IntegrationModule, ProvidersModule, ToolRegistryModule],
  providers: [WebToolsService],
})
export class WebToolsModule {}
