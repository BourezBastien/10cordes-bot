import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';

/**
 * SkillPatternDetector (Phase 2.3) — détection de demandes répétitives pour
 * la Skill Learning Loop.
 *
 * À chaque demande EXÉCUTÉE AVEC SUCCÈS comportant au moins une MUTATION
 * (tool d'action, pas une lecture), on enregistre une empreinte d'intention
 * normalisée (catégories de tools + arité) par (guildId, userId) dans une
 * fenêtre glissante 14 jours (ICacheStore : Redis, fallback mémoire).
 *
 * ≥ 3 occurrences de la même empreinte SANS skill dédié → le pattern est
 * signalé au contexte de réponse : l'IA propose alors la mini-surface
 * « Créer ce Skill / Plus tard ». Un clic « Plus tard » pose une clé de
 * silence 30 jours sur l'empreinte (pas de re-proposition).
 *
 * La phase CRÉATION (proposition, surface, createSkill) arrive avec la
 * librairie V2 en Phase 3 — ce service fournit déjà la détection.
 */

export interface IntentFootprint {
  /** Catégories des tools exécutés, triées + dédupliquées. */
  categories: readonly string[];
  /** Nombre de tools exécutés (arité de l'enchaînement). */
  toolCount: number;
}

export interface PatternVerdict {
  /** L'empreinte a atteint le seuil de répétition. */
  recurring: boolean;
  /** Occurrences dans la fenêtre (y compris celle-ci). */
  occurrences: number;
  /** Empreinte sérialisée (clé de silence, debug). */
  key: string;
}

const WINDOW_DAYS = 14;
const SILENCE_DAYS = 30;
const THRESHOLD = 3;

/** Les catégories de LECTURE pure n'alimentent jamais la détection. */
const READ_ONLY_CATEGORIES = new Set(['webtools', 'utility:read']);

@Injectable()
export class SkillPatternDetector {
  private readonly log = new Logger('SkillPatterns');

  constructor() {}

  /**
   * Enregistre une exécution réussie et retourne le verdict de répétition.
   * `mutations` = au moins un tool d'action : sans mutation on ignore
   * (les lectures répétées — « donne les stats » x3 — ne créent pas de skill).
   */
  async record(args: {
    store: {
      windowIncr(key: string, windowSec: number): Promise<number>;
      get(key: string): Promise<string | null>;
      set(key: string, value: string, ttlSec: number): Promise<void>;
    };
    guildId: string;
    userId: string;
    categories: readonly string[];
    toolNames: readonly string[];
    hadMutation: boolean;
  }): Promise<PatternVerdict> {
    const actionable = args.categories.filter((category) => !READ_ONLY_CATEGORIES.has(category));
    const footprint: IntentFootprint = {
      categories: [...new Set(actionable)].sort(),
      toolCount: args.toolNames.length,
    };
    const key = this.key(args.guildId, args.userId, footprint);

    // Silence posé par un « Plus tard » : on compte quand même (l'habitude
    // persiste) mais on ne REPROPOSE pas tant que la clé vit.
    const silenced = await args.store.get(`skillsilence:${key}`);
    if (silenced) {
      const occurrences = await args.store.windowIncr(key, WINDOW_DAYS * 86_400);
      return { recurring: false, occurrences, key };
    }

    const occurrences = await args.store.windowIncr(key, WINDOW_DAYS * 86_400);
    const recurring = args.hadMutation && occurrences >= THRESHOLD;
    if (recurring) {
      this.log.info(`Pattern récurrent détecté (${occurrences}x) : ${key}`);
    }
    return { recurring, occurrences, key };
  }

  /** Pose le silence 30 jours après un clic « Plus tard ». */
  async silence(store: { set(key: string, value: string, ttlSec: number): Promise<void> }, key: string): Promise<void> {
    await store.set(`skillsilence:${key}`, new Date().toISOString(), SILENCE_DAYS * 86_400);
  }

  private key(guildId: string, userId: string, footprint: IntentFootprint): string {
    return `skillpat:${guildId}:${userId}:${footprint.categories.join('+') || 'none'}:${footprint.toolCount}`;
  }
}
