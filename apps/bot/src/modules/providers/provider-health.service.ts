import { Injectable } from '@spraxium/common';
import type { ProviderStatus } from '@10cordes/shared';
import { redactSecret } from './adapters/generic-http.errors';
import { ProviderError, type ProviderErrorKind } from './provider.types';

/**
 * Santé des fournisseurs, en mémoire : l'état que le panel montre sur la
 * carte d'un fournisseur. Rien n'est simulé : un état ne vient que d'un appel
 * RÉEL (un tour de conversation, une capacité exécutée, un contrôle de
 * connexion demandé depuis le dashboard). Le registre ne fait aucun appel.
 *
 * Trois états de fond, et un refroidissement par-dessus :
 * - `unknown` : aucun appel retenu depuis le démarrage ;
 * - `active` : le dernier appel a réussi ;
 * - `error` : clé refusée, crédit épuisé, requête refusée. Ça ne se répare
 *   pas tout seul : seul un succès (un appel, un contrôle) l'efface ;
 * - `cooldown` : limite de débit, panne, délai, réseau. Au bout du
 *   refroidissement l'état de fond reprend, sans nouvel appel.
 *
 * Le refroidissement montré est celui des MODÈLES du fournisseur
 * (model-cooldown.policy : il décide si un modèle est appelé) ; quand
 * l'appelant n'en dit rien, la fin par défaut. Un fournisseur reste en
 * refroidissement tant qu'un de ses modèles y est.
 * Tout se perd au redémarrage.
 */

/** Durée par défaut d'un refroidissement montré quand l'appelant n'en dit pas (limite de débit, panne, délai, réseau). */
export const COOLDOWN_MS = 60_000;
/** Longueur gardée d'un message d'erreur : la borne du contrat du panel. */
const ERROR_MAX = 300;

/** Sortes d'une erreur typée qui signalent une panne passagère. */
const PASSING_KINDS: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>(['rate-limit', 'unavailable', 'timeout']);

/**
 * Issue d'un appel sur un fournisseur, telle que sa santé la retient.
 *
 * - `error` : l'erreur typée du moteur (`ProviderError`) se lit sur sa sorte ;
 *   une autre erreur se lit sur `transient`, ce qu'en sait l'appelant (le
 *   client LLM sait si elle invite la bascule sur le repli) ;
 * - `secret` : la clé du fournisseur. Un message d'erreur qui la recopie est
 *   masqué avant d'être retenu ;
 * - `cooldownUntil` : la fin du refroidissement du fournisseur (ms), quand
 *   l'appelant la connaît. Sur un succès : celle des modèles qui refroidissent
 *   encore, rien s'il n'y en a pas. Sur une panne passagère sans cette
 *   indication, la fin par défaut.
 */
export type ProviderOutcome =
  | { ok: true; cooldownUntil?: number | null }
  | { ok: false; error: unknown; transient?: boolean; secret?: string | null; cooldownUntil?: number };

type Base = 'unknown' | 'active' | 'error';

interface HealthEntry {
  base: Base;
  /** Fin du refroidissement (ms), null hors refroidissement. */
  cooldownUntil: number | null;
  lastError: string | null;
  lastHttpStatus: number | null;
  lastCheckedAt: string;
}

const UNKNOWN_STATUS: ProviderStatus = { state: 'unknown', cooldownUntil: null, lastError: null, lastHttpStatus: null, lastCheckedAt: null };

/**
 * L'échec est-il passager (refroidissement) ou durable (erreur) ? `null` : il
 * ne dit rien du fournisseur. Une erreur typée se lit sur sa sorte ; une
 * erreur `http` SANS statut est un refus de la demande elle-même (annulation,
 * tâche en échec, réponse refusée parce qu'elle recopiait la clé) : le
 * fournisseur a répondu, sa santé n'en dit rien. Sans erreur typée et sans
 * indication de l'appelant, c'est une panne de réseau : passagère.
 */
function passingOf(error: unknown, transient: boolean | undefined): boolean | null {
  if (error instanceof ProviderError) {
    if (PASSING_KINDS.has(error.kind)) return true;
    if (error.kind === 'http' && error.status === undefined) return null;
    return false;
  }
  return transient !== false;
}

/** Message d'une erreur quelconque : jamais une exception (un objet lancé sans `toString`). */
function messageOf(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return 'Échec sans détail.';
  }
}

/** Statut HTTP d'une erreur typée du moteur, ou du client LLM (même champ `status`). */
function httpStatusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

@Injectable()
export class ProviderHealthService {
  /** Par serveur, puis par fournisseur. */
  private readonly entries = new Map<string, Map<string, HealthEntry>>();

  /** Retient l'issue d'un appel sur un fournisseur. Sans fournisseur, ou pour un refus qui n'en dit rien : rien ne change. */
  record(guildId: string, providerId: string | null | undefined, outcome: ProviderOutcome): void {
    if (!providerId) return;
    const now = Date.now();
    const checkedAt = new Date(now).toISOString();
    const guild = this.entries.get(guildId) ?? new Map<string, HealthEntry>();
    this.entries.set(guildId, guild);
    if (outcome.ok) {
      guild.set(providerId, { base: 'active', cooldownUntil: outcome.cooldownUntil ?? null, lastError: null, lastHttpStatus: null, lastCheckedAt: checkedAt });
      return;
    }
    const passing = passingOf(outcome.error, outcome.transient);
    if (passing === null) return;
    // Masqué AVANT la troncature : une coupe au milieu de la clé en laisserait un morceau.
    const lastError = redactSecret(messageOf(outcome.error), outcome.secret ?? null).slice(0, ERROR_MAX) || null;
    const lastHttpStatus = httpStatusOf(outcome.error);
    const running = guild.get(providerId)?.cooldownUntil ?? null;
    guild.set(
      providerId,
      passing
        ? {
            base: guild.get(providerId)?.base ?? 'unknown',
            // Un second modèle qui échoue n'allonge pas ce qui est déjà annoncé, et ne le raccourcit pas non plus.
            cooldownUntil: Math.max(outcome.cooldownUntil ?? now + COOLDOWN_MS, running !== null && running > now ? running : 0),
            lastError,
            lastHttpStatus,
            lastCheckedAt: checkedAt,
          }
        : { base: 'error', cooldownUntil: null, lastError, lastHttpStatus, lastCheckedAt: checkedAt },
    );
  }

  /** État montré pour un fournisseur. Un fournisseur ou un serveur sans appel retenu : `unknown`. */
  statusOf(guildId: string, providerId: string): ProviderStatus {
    const entry = this.entries.get(guildId)?.get(providerId);
    if (!entry) return { ...UNKNOWN_STATUS };
    const { cooldownUntil } = entry;
    const cooling = cooldownUntil !== null && cooldownUntil > Date.now();
    return {
      state: cooling ? 'cooldown' : entry.base,
      cooldownUntil: cooling && cooldownUntil !== null ? new Date(cooldownUntil).toISOString() : null,
      lastError: entry.lastError,
      lastHttpStatus: entry.lastHttpStatus,
      lastCheckedAt: entry.lastCheckedAt,
    };
  }
}
