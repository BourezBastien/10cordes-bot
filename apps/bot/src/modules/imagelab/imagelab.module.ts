import { Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { ImagelabService } from './imagelab.service';

@Module({
  imports: [ToolRegistryModule],
  providers: [ImagelabService],
})
export class ImagelabModule {}
