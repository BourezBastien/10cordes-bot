import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import type { MemoryCorrection } from '../../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { MemoryCuratorService, type ConsolidationResult } from './memory-curator.service';
import { CorrectionRefusedError } from './memory-correction.errors';
import { buildMemoryCorrectionTool } from './memory-correction.tool';
import { CORRECTIONS_MAX, FACT_MAX, FACT_MIN, carries } from './memory-correction.matcher';

/*
 * CORRECTIONS DE MÉMOIRE QUI TIENNENT. Un membre corrige un fait retenu sur
 * lui ou sur le serveur (« je n'habite plus à Lille »). Un simple ajout
 * laisserait l'ancien fait dans le journal et dans la fiche, et le
 * conservateur pourrait le réintroduire à la fusion suivante. Une correction
 * agit aux trois endroits :
 *
 * - le PROMPT : la correction est injectée telle quelle, et prime ;
 * - le JOURNAL : les entrées qui portent l'ancien fait sont marquées périmées
 *   (`supersededAt`), jamais supprimées : elles ne sont plus lues ;
 * - la FICHE : le conservateur reçoit la correction, et un contrôle en code
 *   réécrit la forme corrigée si sa fusion l'a laissée tomber.
 *
 * Une correction qui remplace une correction plus ancienne la marque périmée
 * à son tour : seul le dernier maillon de la chaîne est actif.
 */

/** Entrées du journal lues à la recherche de l'ancien fait : le journal en garde au plus 200 par fiche. */
const JOURNAL_SCAN_MAX = 200;

export interface CorrectionInput {
  guildId: string;
  /** Membre concerné ; null pour le serveur entier. */
  userId: string | null;
  oldFact: string;
  newFact: string;
  /** Identifiant Discord de qui demande la correction. */
  actorId: string;
}

export interface CorrectionOutcome {
  entry: MemoryCorrection;
  /** Entrées du journal qui portaient l'ancien fait, désormais périmées. */
  supersededEntries: number;
  /** Corrections plus anciennes que celle-ci remplace. */
  supersededCorrections: number;
  consolidation: ConsolidationResult;
}

/** Une correction que le contrat refuse : rien n'a été écrit. */
export { CorrectionRefusedError } from './memory-correction.errors';

@Injectable()
export class MemoryCorrectionService implements SpraxiumOnBoot {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
    private readonly audit: AuditService,
    private readonly curator: MemoryCuratorService,
  ) {}

  onBoot(): void {
    this.registry.register(buildMemoryCorrectionTool({ corrections: this }));
  }

  /** Retient une correction : le journal, la chaîne des corrections et la fiche suivent. */
  async record(input: CorrectionInput): Promise<CorrectionOutcome> {
    const oldFact = input.oldFact.trim();
    const newFact = input.newFact.trim();
    if (oldFact.length < FACT_MIN || newFact.length < FACT_MIN) throw new CorrectionRefusedError(`Un fait fait au moins ${FACT_MIN} caractères.`);
    if (oldFact.length > FACT_MAX.old || newFact.length > FACT_MAX.new) {
      throw new CorrectionRefusedError(`Un fait est trop long : ${FACT_MAX.old} caractères au plus pour l'ancien, ${FACT_MAX.new} pour le nouveau.`);
    }
    if (carries(newFact, oldFact) && carries(oldFact, newFact)) throw new CorrectionRefusedError('La correction répète le fait qu\u0027elle prétend corriger.');
    if (input.userId !== null && (await this.prisma.memoryOptOut.findFirst({ where: { guildId: input.guildId, userId: input.userId } }))) {
      throw new CorrectionRefusedError('Ce membre a demandé à être oublié : rien n\u0027est retenu sur lui.');
    }

    const now = new Date();
    // Chaîne : la correction dont le nouveau fait est l'ancien fait d'aujourd'hui est remplacée.
    const previous = await this.prisma.memoryCorrection.findMany({ where: { guildId: input.guildId, userId: input.userId, supersededAt: null } });
    const replaced = previous.filter((correction) => carries(correction.newFact, oldFact));
    if (replaced.length > 0) {
      await this.prisma.memoryCorrection.updateMany({ where: { id: { in: replaced.map((correction) => correction.id) } }, data: { supersededAt: now } });
    }
    const entry = await this.prisma.memoryCorrection.create({
      data: { guildId: input.guildId, userId: input.userId, oldFact, newFact, createdBy: input.actorId },
    });
    const supersededEntries = await this.supersedeJournal(input.guildId, input.userId, oldFact, now);
    await this.trim(input.guildId, input.userId, entry.id, now);
    const fact = { oldFact, newFact };
    const consolidation =
      input.userId === null
        ? await this.curator.consolidateGuild(input.guildId, input.actorId, newFact, fact)
        : await this.curator.consolidateMember(input.guildId, input.userId, input.actorId, newFact, fact);
    this.audit.record({
      guildId: input.guildId,
      source: 'agent',
      action: 'memory.corrected',
      actorId: input.actorId,
      ...(input.userId === null ? {} : { targetId: input.userId }),
      metadata: { correctionId: entry.id, scope: input.userId === null ? 'guild' : 'member', supersededEntries, supersededCorrections: replaced.length },
    });
    return { entry, supersededEntries, supersededCorrections: replaced.length, consolidation };
  }

  /** Les corrections actives d'une fiche, la plus récente d'abord (à date égale, la dernière écrite). */
  async activeOf(guildId: string, userId: string | null): Promise<MemoryCorrection[]> {
    return this.prisma.memoryCorrection.findMany({ where: { guildId, userId, supersededAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: CORRECTIONS_MAX });
  }

  /** Marque périmées les entrées du journal qui portent l'ancien fait. Rend leur nombre. */
  private async supersedeJournal(guildId: string, userId: string | null, oldFact: string, now: Date): Promise<number> {
    const scope = { guildId, supersededAt: null };
    const rows =
      userId === null
        ? await this.prisma.guildMemory.findMany({ where: scope, orderBy: { createdAt: 'desc' }, take: JOURNAL_SCAN_MAX, select: { id: true, content: true } })
        : await this.prisma.memberMemory.findMany({ where: { ...scope, userId }, orderBy: { createdAt: 'desc' }, take: JOURNAL_SCAN_MAX, select: { id: true, content: true } });
    const ids = rows.filter((row) => carries(row.content, oldFact)).map((row) => row.id);
    if (ids.length === 0) return 0;
    const written = await (userId === null
      ? this.prisma.guildMemory.updateMany({ where: { id: { in: ids } }, data: { supersededAt: now } })
      : this.prisma.memberMemory.updateMany({ where: { id: { in: ids } }, data: { supersededAt: now } }));
    return written.count;
  }

  /** Au-delà de la garde, les corrections actives les plus anciennes cèdent la place (jamais celle qu'on vient d'écrire). */
  private async trim(guildId: string, userId: string | null, keptId: string, now: Date): Promise<void> {
    const active = await this.activeOf(guildId, userId);
    const extra = active.filter((correction) => correction.id !== keptId).slice(CORRECTIONS_MAX - 1);
    if (extra.length === 0) return;
    await this.prisma.memoryCorrection.updateMany({ where: { id: { in: extra.map((correction) => correction.id) } }, data: { supersededAt: now } });
  }
}
