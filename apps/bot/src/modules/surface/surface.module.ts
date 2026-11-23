import { Global, Module, type SpraxiumOnBoot } from '@spraxium/common';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { SurfaceService } from './surface.service';

let runtimeSurface: { render: (surfaceId: string) => Promise<void> } | null = null;

/** Accès runtime au rendu de surface (registry, triggers hors DI). */
export function getSurfaceRuntime(): { render: (surfaceId: string) => Promise<void> } | null {
  return runtimeSurface;
}
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
export class SurfaceModule implements SpraxiumOnBoot {
  constructor(private readonly surfaces: SurfaceService) {}

  onBoot(): void {
    runtimeSurface = { render: (surfaceId: string) => this.surfaces.renderSurface(surfaceId) };
  }
}
