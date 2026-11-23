import { Global, Module } from '@spraxium/common';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { SurfaceService } from './surface.service';
import { SurfacePipelineService } from './surface.pipeline';
import { SurfaceTriggersService } from './surface.triggers.service';
import { EventRouterService } from './surface.event-router';
import { CacheModule } from '../../shared/cache/cache.module';
import {
  SurfaceActHandler,
  SurfaceSelectHandler,
  SurfaceModalHandler,
} from './surface.handlers';
import {
  SurfaceEventMessageListener,
  SurfaceEventMessageDeleteListener,
  SurfaceEventReactionAddListener,
  SurfaceEventReactionRemoveListener,
  SurfaceEventMemberJoinListener,
  SurfaceEventMemberLeaveListener,
  SurfaceEventMemberUpdateListener,
  SurfaceEventVoiceListener,
  SurfaceEventChannelCreateListener,
  SurfaceEventChannelDeleteListener,
} from './surface.event-router';

/**
 * MOTEUR GÉNÉRIQUE : surfaces interactives persistantes + triggers planifiés
 * (rattrapage garanti) + routeur d'événements. @Global : les primitives
 * surface.* sont consommées par l'agent partout (assistant/web) et les
 * triggers par tous les modules à venir.
 *
 * Rien ici dans la classe : le framework n'instancie PAS les modules (seuls
 * providers/listeners/handlers ont un cycle de vie). Le runtime de rendu est
 * lié par SurfaceService.onBoot (voir surface.runtime.ts).
 */
@Global()
@Module({
  imports: [CacheModule, DatabaseModule, AuditModule, ToolRegistryModule],
  providers: [
    SurfacePipelineService,
    SurfaceService,
    SurfaceTriggersService,
    EventRouterService,
  ],
  handlers: [SurfaceActHandler, SurfaceSelectHandler, SurfaceModalHandler],
  listeners: [
    SurfaceEventMessageListener,
    SurfaceEventMessageDeleteListener,
    SurfaceEventReactionAddListener,
    SurfaceEventReactionRemoveListener,
    SurfaceEventMemberJoinListener,
    SurfaceEventMemberLeaveListener,
    SurfaceEventMemberUpdateListener,
    SurfaceEventVoiceListener,
    SurfaceEventChannelCreateListener,
    SurfaceEventChannelDeleteListener,
  ],
  exports: [SurfaceService, SurfacePipelineService],
})
export class SurfaceModule {}
