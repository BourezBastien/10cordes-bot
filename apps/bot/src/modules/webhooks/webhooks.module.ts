import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { WebhookEndpointService } from './webhook-endpoint.service';
import { WebhooksService } from './webhooks.service';

/**
 * Connecteurs HTTP sortants : un endpoint REST d'un service externe, par
 * serveur, qu'un déclencheur, une recette ou le modèle (outil `webhook.call`)
 * appelle. URL validée, en-têtes secrets chiffrés, statut consigné.
 *
 * - WebhookEndpointService : lignes, chiffrement, exécution ; exporté, car le
 *   contrôleur HTTP (`webhooks.controller.ts`) et les déclencheurs l'injectent ;
 * - WebhooksService (provider, `onBoot`) : enregistre l'outil au registry.
 *
 * @Global, exprès : le serveur HTTP du framework construit les contrôleurs
 * en résolvant leurs dépendances dans le conteneur RACINE seulement. Un module
 * non global exporte dans le conteneur de son premier importateur : là, le
 * contrôleur serait construit sans son service.
 *
 * Rien ici dans la classe : le framework n'instancie PAS les modules (seuls
 * providers/listeners/handlers ont un cycle de vie).
 */
@Global()
@Module({
  imports: [AuditModule, DatabaseModule, ToolRegistryModule],
  providers: [WebhookEndpointService, WebhooksService],
  exports: [WebhookEndpointService],
})
export class WebhooksModule {}
