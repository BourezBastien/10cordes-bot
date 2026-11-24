import { Injectable } from '@spraxium/common';
import { PrismaService } from '../database/prisma.service';
import type { ActionPlan } from './action-plan.types';

/**
 * Persistance des plans d'action (table InteractiveSurface). Le statut du
 * plan est porté par le `kind` de la ligne : c'est ce qui rend la prise du
 * plan atomique (`lock`), donc un plan impossible à appliquer deux fois.
 */

const KIND_PENDING = 'action-plan';
const KIND_LOCKED = 'action-plan:locked';
const KIND_CLOSED = 'action-plan:closed';

/** Définition minimale et valide : le panneau d'un plan est dessiné par son presenter, pas par le moteur de surfaces. */
const DEFINITION = JSON.stringify({ title: 'Plan d\u0027action', rows: [] });

/** Ce qu'une ligne garde de l'état du plan (le reste vit dans les colonnes). */
type PlanState = Pick<ActionPlan, 'requesterId' | 'actions' | 'status' | 'createdAt' | 'expiresAt' | 'report'>;

const stateOf = (plan: ActionPlan): PlanState => ({
  requesterId: plan.requesterId,
  actions: plan.actions,
  status: plan.status,
  createdAt: plan.createdAt,
  expiresAt: plan.expiresAt,
  report: plan.report,
});

const kindOf = (status: ActionPlan['status']): string => (status === 'pending' ? KIND_PENDING : status === 'executing' ? KIND_LOCKED : KIND_CLOSED);

type Row = { id: string; guildId: string; channelId: string; messageId: string | null; state: string };

/** Plan complet depuis une ligne ; null si l'état est illisible. */
function toPlan(row: Row): ActionPlan | null {
  try {
    const state = JSON.parse(row.state) as Partial<PlanState>;
    if (typeof state.requesterId !== 'string' || !Array.isArray(state.actions) || typeof state.expiresAt !== 'number') return null;
    return {
      id: row.id,
      guildId: row.guildId,
      channelId: row.channelId,
      messageId: row.messageId,
      requesterId: state.requesterId,
      actions: state.actions,
      status: state.status ?? 'pending',
      createdAt: state.createdAt ?? Date.now(),
      expiresAt: state.expiresAt,
      report: state.report ?? null,
    };
  } catch {
    return null;
  }
}

const COLUMNS = { id: true, guildId: true, channelId: true, messageId: true, state: true } as const;

@Injectable()
export class ActionPlanStore {
  constructor(private readonly prisma: PrismaService) {}

  /** Crée le plan et rend son identifiant. */
  async create(plan: Omit<ActionPlan, 'id'>): Promise<string> {
    const row = await this.prisma.interactiveSurface.create({
      data: {
        guildId: plan.guildId,
        channelId: plan.channelId,
        kind: kindOf(plan.status),
        definition: DEFINITION,
        state: JSON.stringify(stateOf(plan as ActionPlan)),
        createdBy: plan.requesterId,
      },
      select: { id: true },
    });
    return row.id;
  }

  /** Enregistre l'état du plan (et le message du panneau dès qu'il est affiché). */
  async save(plan: ActionPlan): Promise<void> {
    await this.prisma.interactiveSurface.update({
      where: { id: plan.id },
      data: { kind: kindOf(plan.status), state: JSON.stringify(stateOf(plan)), ...(plan.messageId ? { messageId: plan.messageId } : {}) },
      select: { id: true },
    });
  }

  async get(planId: string): Promise<ActionPlan | null> {
    const row = await this.prisma.interactiveSurface.findUnique({ where: { id: planId }, select: COLUMNS });
    return row ? toPlan(row) : null;
  }

  /**
   * Prend le plan pour l'exécuter : une seule prise réussit. Le `kind` passe
   * de « en attente » à « en cours » ; un deuxième clic, une annulation
   * concurrente ou une reprise après redémarrage le trouvent déjà pris.
   */
  async lock(planId: string): Promise<boolean> {
    const result = await this.prisma.interactiveSurface.updateMany({ where: { id: planId, kind: KIND_PENDING }, data: { kind: KIND_LOCKED } });
    return result.count === 1;
  }

  /** Supprime les plans en attente dont le délai d'approbation est dépassé. */
  async purgeExpired(guildId: string, now: number): Promise<number> {
    const rows = await this.prisma.interactiveSurface.findMany({ where: { guildId, kind: KIND_PENDING }, select: COLUMNS });
    let purged = 0;
    for (const row of rows) {
      const plan = toPlan(row);
      if (plan && plan.expiresAt <= now && (await this.prisma.interactiveSurface.delete({ where: { id: row.id } }).then(() => true).catch(() => false))) {
        purged += 1;
      }
    }
    return purged;
  }
}
