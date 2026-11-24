import type { Capability, ChatResult, ChatTurnInput, ConnectionCheckResult, ProviderConfig, ProviderModel, ProviderExecutionResult, ProviderProtocol, ProviderRequest } from './provider.types';

/**
 * Contrat unique d'un fournisseur (pattern Strategy). Chaque protocole est un
 * adaptateur SANS ÉTAT : la configuration (URL, clé déchiffrée, options)
 * arrive à chaque appel dans `ProviderConfig`. Un adaptateur ne garde rien
 * et ne laisse jamais ressortir la clé (résultat, erreur, journal).
 */
export abstract class AbstractProviderAdapter {
  abstract readonly protocol: ProviderProtocol;

  /** Capacités natives que ce protocole sert. */
  abstract readonly capabilities: readonly Capability[];

  /** La capacité est-elle servie pour CE fournisseur ? Les capacités déclarées par le protocole le sont toujours ; un adaptateur peut en servir d'autres selon la configuration du fournisseur (opérations sur mesure). */
  supports(capability: Capability, config: ProviderConfig): boolean {
    if ((this.capabilities as readonly string[]).includes(capability)) return true;
    return this.supportsCustom(capability, config);
  }

  /** Capacité servie seulement si la configuration du fournisseur la décrit (surcharge dans l'adaptateur concerné). */
  protected supportsCustom(_capability: string, _config: ProviderConfig): boolean {
    return false;
  }

  /** Contrôle la clé et l'accès (un appel réel, léger). */
  abstract testConnection(config: ProviderConfig): Promise<ConnectionCheckResult>;

  /** Modèles que le fournisseur propose (catalogue distant, ou saisi). */
  abstract discoverModels(config: ProviderConfig): Promise<ProviderModel[]>;

  /** Exécute une capacité et rend un résultat normalisé. */
  abstract execute(config: ProviderConfig, request: ProviderRequest, signal?: AbortSignal): Promise<ProviderExecutionResult>;

  /** Tour de conversation au format interne du bot (bloquant ou streamé selon le protocole). */
  abstract chat(config: ProviderConfig, turn: ChatTurnInput): Promise<ChatResult>;
}
