import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { PrismaService } from '../database/prisma.service';
import { AgentDecisionRecorder, type DecisionRow, type DecisionStart } from './agent-decision.recorder';

/*
 * JOURNAL DES DÉCISIONS DE L'AGENT (table agent_decisions). Une ligne par
 * demande traitée par le modèle, sur Discord comme depuis le dashboard.
 *
 * Le journal ne doit jamais casser une demande : une écriture qui échoue se
 * dit, et la demande suit son cours. Les lignes de plus de 14 jours sont
 * purgées au démarrage, puis au plus une fois par heure après une écriture.
 */

export const DECISION_RETENTION_MS = 14 * 24 * 60 * 60_000;
const PURGE_INTERVAL_MS = 60 * 60_000;

@Injectable()
export class AgentDecisionJournal implements SpraxiumOnBoot {
  private readonly log = new Logger('AgentDecision');
  private lastPurgeAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onBoot(): Promise<void> {
    await this.purge();
  }

  /** Commence l'enregistrement d'une décision : la demande vient d'être acceptée. */
  begin(start: DecisionStart): AgentDecisionRecorder {
    return new AgentDecisionRecorder(start);
  }

  /** Écrit la ligne d'une décision. N'échoue jamais une demande. */
  async record(guildId: string, row: DecisionRow): Promise<void> {
    try {
      await this.prisma.agentDecision.create({ data: { guildId, ...row } });
      if (Date.now() - this.lastPurgeAt >= PURGE_INTERVAL_MS) await this.purge();
    } catch (error) {
      this.log.warn(`Décision non journalisée : ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Supprime les décisions de plus de 14 jours. Rend le nombre de lignes supprimées ; une purge qui échoue se dit, c'est tout. */
  async purge(now: number = Date.now()): Promise<number> {
    this.lastPurgeAt = now;
    try {
      const deleted = await this.prisma.agentDecision.deleteMany({ where: { createdAt: { lt: new Date(now - DECISION_RETENTION_MS) } } });
      if (deleted.count > 0) this.log.info(`Journal des décisions : ${deleted.count} ligne(s) de plus de 14 jours supprimée(s).`);
      return deleted.count;
    } catch (error) {
      this.log.warn(`Journal des décisions : purge impossible (${error instanceof Error ? error.message : String(error)})`);
      return 0;
    }
  }
}
