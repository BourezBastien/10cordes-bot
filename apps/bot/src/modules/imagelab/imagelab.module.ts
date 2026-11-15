import { Global, Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { ImagelabService } from './imagelab.service';

// @Global : ImagelabService (clé PixelLab runtime) est consommé par la modale
// de configuration IA du module assistant.
@Global()
@Module({
  imports: [ToolRegistryModule],
  providers: [ImagelabService],
  exports: [ImagelabService],
})
export class ImagelabModule {}
