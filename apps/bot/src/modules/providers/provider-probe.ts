import type { AbstractProviderAdapter } from './provider-adapter';
import type { ProviderAdapterRegistry } from './provider-adapter.registry';
import type { ModelCooldownStore } from './model-cooldown.store';
import type { GuildProviderService } from './provider-store.service';
import type { ProviderConfig, ProviderModel } from './provider.types';

/** Ce qu'un contrôle de connexion a besoin du moteur : le catalogue, les adaptateurs de protocoles, et les refroidissements qu'il peut lever. */
export interface ProviderProbeDeps {
  readonly store: Pick<GuildProviderService, 'saveModels'>;
  readonly registry: Pick<ProviderAdapterRegistry, 'resolve'>;
  /** Facultatif : quand un contrôle passe, plus rien ne refroidit sur le fournisseur. */
  readonly cooldowns?: Pick<ModelCooldownStore, 'clearProvider'>;
}

/**
 * Issue d'un contrôle de connexion. Un contrôle qui échoue est un résultat :
 * `error` est alors l'erreur qui en rend compte (typée quand l'adaptateur
 * l'a levée), pour la santé du fournisseur.
 */
export type ConnectionProbe =
  | { ok: true; summary: string; modelsFound: number }
  | { ok: false; summary: string; modelsFound: 0; error: unknown };

/**
 * Contrôle la connexion d'un fournisseur, puis rafraîchit son catalogue
 * découvert quand elle passe (les slugs saisis à la main restent). Une erreur
 * que lève l'adaptateur remonte telle quelle : c'est à l'appelant d'en
 * décider. Le même chemin sert les tools `provider.*` et le dashboard.
 *
 * Un contrôle qui passe est la preuve que le fournisseur répond : ce qui
 * refroidissait sur ses modèles est levé (un crédit rechargé, une limite
 * de débit repartie).
 */
export async function probeConnection(deps: ProviderProbeDeps, provider: ProviderConfig): Promise<ConnectionProbe> {
  const adapter: AbstractProviderAdapter = deps.registry.resolve(provider.protocol);
  const check = await adapter.testConnection(provider);
  if (!check.ok) return { ok: false, summary: check.summary, modelsFound: 0, error: new Error(check.summary) };
  const models: ProviderModel[] = await adapter.discoverModels(provider).catch(() => []);
  if (models.length > 0) await deps.store.saveModels(provider.guildId, provider.id, models);
  await deps.cooldowns?.clearProvider(provider.guildId, provider.id);
  return { ok: true, summary: check.summary, modelsFound: models.length };
}
