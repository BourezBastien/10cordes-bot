/**
 * Politique de quota du store générique (collections dynamiques).
 *
 * Le store accepte, en plus des 7 collections natives à schéma strict, des
 * collections créées à la demande par l'agent (casino_balance,
 * giveaway_entries...). Elles sont bornées ici, en code, pour qu'une boucle
 * de l'agent ou un serveur hostile ne puissent pas remplir la base :
 * - nom : lettres minuscules, chiffres, `_` ou `-`, 2 à 48 caractères,
 *   premier caractère alphanumérique ;
 * - nombre de collections distinctes par serveur ;
 * - nombre d'enregistrements par serveur.
 *
 * Même contrat que les policies d'accès : `can*` (booléen silencieux) et
 * `assert*` (lève une erreur domaine typée, au message actionnable).
 */

/** Nom d'une collection dynamique. */
export const DYNAMIC_COLLECTION_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,47}$/u;

export const DYNAMIC_COLLECTION_NAME_RULE = 'lettres minuscules, chiffres, _ ou - ; 2 à 48 caractères ; premier caractère lettre ou chiffre';

export interface CollectionQuotaLimits {
  readonly maxCollectionsPerGuild: number;
  readonly maxRecordsPerGuild: number;
}

export const DEFAULT_COLLECTION_QUOTA: CollectionQuotaLimits = {
  maxCollectionsPerGuild: 50,
  maxRecordsPerGuild: 10_000,
};

/** Erreur domaine : nom de collection dynamique qui ne respecte pas le format. */
export class CollectionNameRejectedError extends Error {
  constructor(public readonly collectionName: string) {
    super(`Nom de collection refusé : « ${collectionName} » doit respecter ${DYNAMIC_COLLECTION_NAME_RULE}.`);
    this.name = 'CollectionNameRejectedError';
  }
}

/** Erreur domaine : quota de collections ou d'enregistrements atteint. */
export class CollectionQuotaExceededError extends Error {
  constructor(
    public readonly limit: 'collections' | 'records',
    public readonly used: number,
    public readonly max: number,
  ) {
    super(
      limit === 'collections'
        ? `Quota de collections atteint sur ce serveur (${used} sur ${max}). Supprime les enregistrements d\u0027une collection devenue inutile avant d\u0027en ouvrir une autre.`
        : `Quota d\u0027enregistrements atteint sur ce serveur (${used} sur ${max}). Supprime des enregistrements avant d\u0027en créer d\u0027autres.`,
    );
    this.name = 'CollectionQuotaExceededError';
  }
}

export class CollectionQuotaPolicy {
  readonly policyName = 'CollectionQuota';

  constructor(private readonly limits: CollectionQuotaLimits = DEFAULT_COLLECTION_QUOTA) {}

  get maxCollectionsPerGuild(): number {
    return this.limits.maxCollectionsPerGuild;
  }

  get maxRecordsPerGuild(): number {
    return this.limits.maxRecordsPerGuild;
  }

  /** Le nom respecte le format des collections dynamiques. */
  isWellFormedName(name: string): boolean {
    return DYNAMIC_COLLECTION_NAME_PATTERN.test(name);
  }

  assertWellFormedName(name: string): void {
    if (!this.isWellFormedName(name)) throw new CollectionNameRejectedError(name);
  }

  /** Une collection de plus peut être ouverte sur ce serveur. */
  canOpenCollection(collectionsInGuild: number): boolean {
    return collectionsInGuild < this.limits.maxCollectionsPerGuild;
  }

  assertCanOpenCollection(collectionsInGuild: number): void {
    if (!this.canOpenCollection(collectionsInGuild)) {
      throw new CollectionQuotaExceededError('collections', collectionsInGuild, this.limits.maxCollectionsPerGuild);
    }
  }

  /** Un enregistrement de plus peut être écrit sur ce serveur. */
  canWriteRecord(recordsInGuild: number): boolean {
    return recordsInGuild < this.limits.maxRecordsPerGuild;
  }

  assertCanWriteRecord(recordsInGuild: number): void {
    if (!this.canWriteRecord(recordsInGuild)) {
      throw new CollectionQuotaExceededError('records', recordsInGuild, this.limits.maxRecordsPerGuild);
    }
  }

  /** Résumage lisible pour les tools et la documentation. */
  describe(): string {
    return `${this.limits.maxCollectionsPerGuild} collections et ${this.limits.maxRecordsPerGuild} enregistrements par serveur au maximum`;
  }
}

/** Instance singleton (la policy est sans état). */
export const collectionQuotaPolicy = new CollectionQuotaPolicy();
