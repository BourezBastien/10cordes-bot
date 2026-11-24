import { Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { WebToolsService } from './webtools.service';

// Tools de capacités web/fichiers : recherche, PDF, météo, GitHub, RSS.
// Pas @Global : consommés uniquement via le ToolRegistry partagé.
// Aucune clé : l'image générée (generateImage) et son modèle routé vivent dans le module imagelab.
@Module({
  imports: [ToolRegistryModule],
  providers: [WebToolsService],
})
export class WebToolsModule {}
