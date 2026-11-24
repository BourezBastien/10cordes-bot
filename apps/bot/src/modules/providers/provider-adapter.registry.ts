import { Injectable } from '@spraxium/common';
import type { AbstractProviderAdapter } from './provider-adapter';
import { ProviderError, type ProviderProtocol } from './provider.types';

/**
 * Résout l'adaptateur d'un protocole. Les adaptateurs sont SANS ÉTAT : une
 * instance par protocole, enregistrée au démarrage.
 */
@Injectable()
export class ProviderAdapterRegistry {
  private readonly adapters = new Map<ProviderProtocol, AbstractProviderAdapter>();

  register(adapter: AbstractProviderAdapter): void {
    this.adapters.set(adapter.protocol, adapter);
  }

  resolve(protocol: ProviderProtocol): AbstractProviderAdapter {
    const adapter = this.adapters.get(protocol);
    if (!adapter) throw new ProviderError(`Aucun adaptateur pour le protocole ${protocol}.`, 'unsupported');
    return adapter;
  }

  protocols(): ProviderProtocol[] {
    return [...this.adapters.keys()];
  }
}
