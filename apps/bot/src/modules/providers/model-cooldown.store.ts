import { Injectable } from '@spraxium/common';
import type { CooldownReason } from './model-cooldown.policy';

/*
 * REFROIDISSEMENT PAR MODÈLE, en mémoire. Ce qu'un modèle qui vient d'échouer
 * doit éviter, et jusqu'à quand : la clé est un serveur, un fournisseur de ce
 * serveur et un modèle. Deux serveurs qui partagent une copie d'instance ne
 * partagent pas leur refroidissement : une limite de débit dépend de la clé,
 * et une panne chez l'un ne dit rien de l'autre.
 *
 * Toute l'interface est asynchrone : un magasin distribué (Redis) pourra la
 * reprendre sans toucher les appelants. Tout se perd au redémarrage.
 */

export interface ModelCooldown {
  reason: CooldownReason;
  /** Fin du refroidissement, en millisecondes depuis l'origine des temps. */
  until: number;
  /** Vrai quand la règle du repli autorise la bascule pour cet échec. */
  reroute: boolean;
  /** L'erreur de l'appel réel : c'est elle qu'une demande échouée sans appel rendra. */
  error: unknown;
}

export interface ModelCooldownStore {
  /** Le refroidissement en cours d'un modèle, null s'il n'y en a pas ou qu'il est échu. */
  get(key: string): Promise<ModelCooldown | null>;
  /** Retient un refroidissement ; un refroidissement plus long en cours n'est jamais raccourci. */
  set(key: string, cooldown: ModelCooldown): Promise<void>;
  clear(key: string): Promise<void>;
  /** Oublie tout ce qui refroidit sur un fournisseur (modification, contrôle qui passe). Rend le nombre d'entrées oubliées. */
  clearProvider(guildId: string, providerId: string): Promise<number>;
  /** La fin la plus tardive des refroidissements d'un fournisseur (null quand aucun n'est en cours) : ce qu'en montre la santé. */
  latestUntil(guildId: string, providerId: string): Promise<number | null>;
}

const SEPARATOR = '\u001f';
const SWEEP_EVERY_WRITES = 200;

/** Clé d'un modèle : un serveur, un fournisseur de ce serveur, un modèle. */
export function modelKey(guildId: string, providerId: string, modelId: string): string {
  return `${guildId}${SEPARATOR}${providerId}${SEPARATOR}${modelId}`;
}

/** Préfixe des clés d'un fournisseur d'un serveur. */
export function providerKeyPrefix(guildId: string, providerId: string): string {
  return `${guildId}${SEPARATOR}${providerId}${SEPARATOR}`;
}

@Injectable()
export class InMemoryModelCooldownStore implements ModelCooldownStore {
  private readonly entries = new Map<string, ModelCooldown>();
  private writes = 0;

  async get(key: string): Promise<ModelCooldown | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.until <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  async set(key: string, cooldown: ModelCooldown): Promise<void> {
    const current = this.entries.get(key);
    if (current && current.until > cooldown.until) return;
    this.entries.set(key, cooldown);
    this.writes += 1;
    if (this.writes >= SWEEP_EVERY_WRITES) {
      this.writes = 0;
      const now = Date.now();
      for (const [entryKey, entry] of this.entries) if (entry.until <= now) this.entries.delete(entryKey);
    }
  }

  async clear(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async clearProvider(guildId: string, providerId: string): Promise<number> {
    const prefix = providerKeyPrefix(guildId, providerId);
    let cleared = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        cleared += 1;
      }
    }
    return cleared;
  }

  async latestUntil(guildId: string, providerId: string): Promise<number | null> {
    const prefix = providerKeyPrefix(guildId, providerId);
    const now = Date.now();
    let latest: number | null = null;
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(prefix)) continue;
      if (entry.until <= now) {
        this.entries.delete(key);
        continue;
      }
      latest = Math.max(latest ?? 0, entry.until);
    }
    return latest;
  }
}
