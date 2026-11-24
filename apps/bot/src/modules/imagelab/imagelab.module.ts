import { Global, Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { IntegrationModule } from '../integrations/integration.module';
import { ProvidersModule } from '../providers/providers.module';
import { ImagelabService } from './imagelab.service';

// @Global : ImagelabService (clé PixelLab runtime) est consommé par la modale
// de configuration IA du module assistant. IntegrationModule importé pour
// l'ordre de chargement (l'intégration pixellab est résolue au boot).
// ProvidersModule : un serveur peut router `image.generate` vers son propre fournisseur.
@Global()
@Module({
  imports: [IntegrationModule, ProvidersModule, ToolRegistryModule],
  providers: [ImagelabService],
  exports: [ImagelabService],
})
export class ImagelabModule {}
