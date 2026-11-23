import { Global, Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { IntegrationModule } from '../integrations/integration.module';
import { ImagelabService } from './imagelab.service';

// @Global : ImagelabService (clé PixelLab runtime) est consommé par la modale
// de configuration IA du module assistant. IntegrationModule importé pour
// l'ordre de chargement (l'intégration pixellab est résolue au boot).
@Global()
@Module({
  imports: [IntegrationModule, ToolRegistryModule],
  providers: [ImagelabService],
  exports: [ImagelabService],
})
export class ImagelabModule {}
