import type { Logger } from '@spraxium/logger';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../database/prisma.service';

/**
 * Sweep anti-conflit des skills, exécuté au boot par SkillService.
 * Collaborateur non injectable : instancié par le service, qui lui fournit
 * Prisma, l'audit et son logger.
 */
export class SkillConflictAuditor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly log: Logger,
  ) {}

  /**
   * Sweep anti-conflit (détéministe, sans LLM) : détecte les triggers qui se
   * recouvrent fortement sur un même serveur et l'archive en audit. AUCUNE
   * suppression automatique (anti-wipe) : le staff tranche via deleteSkill.
   * Complète la garde à la création de createSkill (qui bloque les doublons
   * dès l'insertion) pour les paires créées avant la garde ou inter-origines
   * (bibliothèque vs membre).
   */
  async auditSkillConflicts(): Promise<void> {
    try {
      const skills = await this.prisma.agentSkill.findMany({
        where: { deletedAt: null },
        select: { id: true, guildId: true, trigger: true },
      });
      const normalize = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const byGuild = new Map<string, typeof skills>();
      for (const skill of skills) {
        const list = byGuild.get(skill.guildId) ?? [];
        list.push(skill);
        byGuild.set(skill.guildId, list);
      }
      let conflicts = 0;
      for (const [guildId, list] of byGuild) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const wordsA = new Set(normalize(list[i].trigger).split(' ').filter((w) => w.length > 3));
            const wordsB = new Set(normalize(list[j].trigger).split(' ').filter((w) => w.length > 3));
            if (wordsA.size === 0 || wordsB.size === 0) continue;
            const overlap = [...wordsA].filter((w) => wordsB.has(w)).length;
            if (overlap / Math.min(wordsA.size, wordsB.size) < 0.7) continue;
            conflicts += 1;
            this.audit.record({
              guildId,
              source: 'agent',
              action: 'skill.conflict',
              actorId: 'system',
              metadata: {
                skillA: list[i].id,
                skillB: list[j].id,
                triggerA: list[i].trigger.slice(0, 120),
                triggerB: list[j].trigger.slice(0, 120),
              },
            });
          }
        }
      }
      if (conflicts > 0) this.log.warn(`${conflicts} conflit(s) de skills archivé(s) en audit (action skill.conflict).`);
    } catch (error) {
      this.log.warn(`Sweep conflits ignoré : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
