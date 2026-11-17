import { Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { MusicService } from './music.service';

// Génération musicale (kie.ai/Suno) : tool generateMusic, clé KIE_API_KEY.
@Module({
  imports: [ToolRegistryModule],
  providers: [MusicService],
})
export class MusicModule {}
