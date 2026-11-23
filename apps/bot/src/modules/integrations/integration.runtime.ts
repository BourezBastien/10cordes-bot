import type { IntegrationService } from './integration.service';

/**
 * Accès runtime à IntegrationService (pattern getLlm) : consommé par des
 * modules chargés AVANT IntegrationModule dans l'ordre d'AppModule.
 */
let instance: IntegrationService | null = null;

export function bindIntegrations(service: IntegrationService): void {
  instance = service;
}

export function getIntegrations(): IntegrationService {
  if (!instance) throw new Error('IntegrationService non initialisé (module non chargé)');
  return instance;
}
