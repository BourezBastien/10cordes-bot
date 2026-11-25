import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { ProviderAdapterRegistry } from './provider-adapter.registry';
import { CapabilityRouterService } from './capability-router.service';
import { ProviderSelectHandler, ProviderCapabilityHandler, ProviderEditModalHandler, ProviderModelHandler } from './handlers/provider-hub.handlers';
import {
  ProviderAddButtonHandler,
  ProviderDeleteButtonHandler,
  ProviderEditButtonHandler,
  ProviderPageButtonHandler,
  ProviderRefreshButtonHandler,
  ProviderTestButtonHandler,
} from './handlers/provider-hub.buttons.handlers';
import { ProviderLegacyMigration } from './provider-legacy.migration';
import { GuildProviderService } from './provider-store.service';
import { ProviderHealthService } from './provider-health.service';
import { ProvidersBoot } from './providers.boot';

/**
 * Moteur générique de fournisseurs IA : fournisseurs par serveur (clé
 * chiffrée), catalogue de modèles, et route de chaque capacité vers un modèle
 * (avec repli automatique). @Global : le routeur et le store sont consommés
 * par le client LLM, la musique, les images et le panneau de configuration.
 *
 * - ProvidersBoot (provider, `onBoot`) enregistre les adaptateurs de
 *   protocole et les tools `provider.*`, `capability.*`, `providers.panel` ;
 * - ProviderLegacyMigration migre, une fois par serveur, les intégrations
 *   d'instance (llm, pixellab, kie, env) et garde leurs copies alignées
 *   (IntegrationService via accesseur runtime : son module se charge après) ;
 * - `handlers` : les trois menus, la modale et les boutons du panneau
 *   « Fournisseurs et modèles ». Sans cette clé, le framework n'enregistre
 *   AUCUNE interaction : le panneau serait muet.
 *
 * Rien ici dans la classe : le framework n'instancie PAS les modules (seuls
 * providers/listeners/handlers ont un cycle de vie).
 */
@Global()
@Module({
  imports: [AuditModule, DatabaseModule, GuildConfigModule, ToolRegistryModule],
  handlers: [
    ProviderSelectHandler,
    ProviderCapabilityHandler,
    ProviderModelHandler,
    ProviderEditModalHandler,
    ProviderAddButtonHandler,
    ProviderEditButtonHandler,
    ProviderTestButtonHandler,
    ProviderRefreshButtonHandler,
    ProviderDeleteButtonHandler,
    ProviderPageButtonHandler,
  ],
  providers: [ProviderAdapterRegistry, GuildProviderService, ProviderLegacyMigration, CapabilityRouterService, ProviderHealthService, ProvidersBoot],
  exports: [ProviderAdapterRegistry, GuildProviderService, CapabilityRouterService, ProviderHealthService],
})
export class ProvidersModule {}
