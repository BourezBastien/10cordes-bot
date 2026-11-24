import { CAPABILITY_KINDS, ProviderError, type ModelKind, type ProviderModel } from '../provider.types';

/**
 * `extraConfig` d'un fournisseur `generic-http` : ce que l'administrateur a
 * saisi pour décrire son API. Lu sans jeter : une entrée mal formée est
 * signalée au moment de son emploi, avec le champ à corriger.
 */

export interface GenericOperation {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Ajouté à la base URL du fournisseur (`/v2/create-image`) ; accepte {{param}}. */
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  /** Gabarit JSON ; {{param}} dans les chaînes. */
  body?: unknown;
  /** Chemin pointé dans la réponse (« data.resultUrls.0 », « image.base64 »). */
  responsePath?: string;
}

export interface GenericHttpConfig {
  /** Clé : nom de la capacité native (`image.generate`), ou nom après `custom.` */
  operations: Record<string, GenericOperation>;
  /** Catalogue saisi. */
  models: ProviderModel[];
  /** Contrôle de connexion facultatif. */
  test: GenericOperation | null;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readGenericConfig(extraConfig: Record<string, unknown>): GenericHttpConfig {
  const models = Array.isArray(extraConfig.models) ? (extraConfig.models as unknown[]).map(enteredModel).filter(isModel) : [];
  return {
    operations: isRecord(extraConfig.operations) ? (extraConfig.operations as unknown as Record<string, GenericOperation>) : {},
    models,
    test: isRecord(extraConfig.test) ? (extraConfig.test as unknown as GenericOperation) : null,
  };
}

/** L'opération d'une capacité. Clé courte pour `custom.*` (`custom.translate` : `translate`) ; la clé complète est tolérée. */
export function findOperation(operations: Record<string, GenericOperation>, capability: string): GenericOperation | null {
  const shortName = capability.startsWith('custom.') ? capability.slice('custom.'.length) : capability;
  if (Object.hasOwn(operations, shortName)) return operations[shortName];
  return Object.hasOwn(operations, capability) ? operations[capability] : null;
}

/** Opération contrôlée à l'emploi. */
export function validatedOperation(value: unknown, label: string): GenericOperation {
  if (!isRecord(value)) throw new ProviderError(`Opération « ${label} » mal formée : un objet { method, path } est attendu.`, 'invalid');
  const method = typeof value.method === 'string' ? value.method.toUpperCase() : '';
  if (!(METHODS as readonly string[]).includes(method)) {
    throw new ProviderError(`Opération « ${label} » invalide : method doit valoir GET, POST, PUT, PATCH ou DELETE.`, 'invalid');
  }
  if (typeof value.path !== 'string' || !value.path.startsWith('/')) {
    throw new ProviderError(`Opération « ${label} » invalide : path est requis et commence par / (accepte {{param}}).`, 'invalid');
  }
  for (const field of ['headers', 'query'] as const) {
    if (value[field] !== undefined && !isRecord(value[field])) {
      throw new ProviderError(`Opération « ${label} » invalide : ${field} doit être un objet de chaînes.`, 'invalid');
    }
  }
  if (value.responsePath !== undefined && (typeof value.responsePath !== 'string' || value.responsePath.length === 0)) {
    throw new ProviderError(`Opération « ${label} » invalide : responsePath doit être un chemin non vide.`, 'invalid');
  }
  return {
    method: method as GenericOperation['method'],
    path: value.path,
    ...(isRecord(value.headers) ? { headers: stringRecord(value.headers) } : {}),
    ...(isRecord(value.query) ? { query: stringRecord(value.query) } : {}),
    ...(value.body === undefined ? {} : { body: value.body }),
    ...(typeof value.responsePath === 'string' ? { responsePath: value.responsePath } : {}),
  };
}

function stringRecord(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value)]));
}

function isModel(model: ProviderModel | null): model is ProviderModel {
  return model !== null;
}

/** Modèle saisi : identifiant requis, famille gardée seulement si elle est connue. */
function enteredModel(value: unknown): ProviderModel | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0) return null;
  const kind = typeof value.kind === 'string' ? value.kind.toLowerCase() : '';
  const knownKind = kind === 'other' || (CAPABILITY_KINDS as readonly string[]).includes(kind) ? (kind as ModelKind) : null;
  return { id: value.id, name: typeof value.name === 'string' && value.name.length > 0 ? value.name : value.id, ...(knownKind ? { kind: knownKind } : {}) };
}
