import { Global, Module } from '@spraxium/common';
import { ShutdownService } from './shutdown.service';

/*
 * MODULE GLOBAL DE L'EXTINCTION. `ShutdownService` est injecté par la sonde
 * (`HealthController`), et le serveur HTTP construit tous les contrôleurs dans
 * le conteneur RACINE : un fournisseur du module racine n'y est jamais visible
 * (la sonde répondait 500, « reading 'isDraining' », le 25/11/2026). Il est
 * donc fourni par un module global, et exporté.
 *
 * Chargé APRÈS le module de l'assistant dans AppModule : il injecte sa file.
 */
@Global()
@Module({
  providers: [ShutdownService],
  exports: [ShutdownService],
})
export class HealthModule {}
