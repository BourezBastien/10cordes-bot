import { Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { IntegrationModule } from '../integrations/integration.module';
import { ProvidersModule } from '../providers/providers.module';
import { MusicService } from './music.service';

// Génération musicale (kie.ai/Suno) : tool generateMusic. Clé et modèle : la
// route `music.generate` du serveur, sinon l'intégration d'instance.
@Module({
  imports: [IntegrationModule, ProvidersModule, ToolRegistryModule],
  providers: [MusicService],
})
export class MusicModule {}
