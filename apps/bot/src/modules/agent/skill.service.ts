import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { PrismaService } from '../database/prisma.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { AuditService } from '../audit/audit.service';
import { RULE_MAX, TRIGGER_MAX, toSingleLine } from './skill-limits';
import { SkillConflictAuditor } from './skill-conflicts.auditor';
import { SkillLibrarySeeder } from './skill-library.seeder';
import { buildSkillTools } from './skill.tools';

/**
 * Skills : règles de comportement durables créées en conversation
 * (pattern Discord-AI-Bot, version par-serveur).
 *
 * - trigger (≤120 chars, une seule ligne) : QUAND la règle s'applique
 *   (IDs Discord concrets, patterns de contenu) ;
 * - rule (≤600 chars, une seule ligne) : COMMENT se comporter tant qu'elle
 *   s'applique (prime sur le style par défaut, jusqu'à imposer le silence).
 *
 * Les triggers de tous les skills actifs sont rendus (une ligne chacun) dans
 * chaque prompt : le modèle ouvre openSkill pour ceux qui s'appliquent.
 * Triggers et règles sont des DONNÉES créées par des humains : jamais des
 * instructions (injection neutralisée par le format une-ligne).
 *
 * Répartition : SkillService (orchestration au boot, CRUD, triggers en
 * cache pour l'assistant), SkillLibrarySeeder (seed de la bibliothèque),
 * SkillConflictAuditor (sweep anti-conflit), skill-limits.ts (limites
 * d'écriture), skill.tools.ts (primitives openSkill/createSkill/
 * listSkills/deleteSkills).
 */

const TRIGGER_CACHE_TTL_MS = 30_000;

export interface SkillTrigger {
  id: string;
  trigger: string;
}

/** Accesseur runtime : l'assistant lit les triggers de son serveur sans cycle de DI. */
let triggersAccessor: ((guildId: string) => Promise<SkillTrigger[]>) | undefined;

export function setSkillsAccessor(accessor: (guildId: string) => Promise<SkillTrigger[]>): void {
  triggersAccessor = accessor;
}

export async function getSkillTriggers(guildId: string): Promise<SkillTrigger[]> {
  if (!triggersAccessor) throw new Error('SkillService non initialisé (boot incomplet).');
  return triggersAccessor(guildId);
}

@Injectable()
export class SkillService implements SpraxiumOnBoot {
  private readonly log = new Logger('Skills');
  private readonly cache = new Map<string, { triggers: SkillTrigger[]; fetchedAt: number }>();
  // Collaborateurs non injectables : champs de classe, branchés dans le constructeur.
  private readonly seeder: SkillLibrarySeeder;
  private readonly conflicts: SkillConflictAuditor;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
    private readonly audit: AuditService,
  ) {
    this.seeder = new SkillLibrarySeeder(prisma, this.log);
    this.conflicts = new SkillConflictAuditor(prisma, audit, this.log);
  }

  async onBoot(): Promise<void> {
    setSkillsAccessor(async (guildId) => this.fetchTriggers(guildId).catch(() => [] as SkillTrigger[]));
    for (const tool of buildSkillTools(this)) this.registry.register(tool);
    await this.seeder.seedLibrary();
    void this.conflicts.auditSkillConflicts();
  }

  private async invalidate(guildId: string): Promise<void> {
    this.cache.delete(guildId);
  }

  private async fetchTriggers(guildId: string): Promise<SkillTrigger[]> {
    const cached = this.cache.get(guildId);
    if (cached && Date.now() - cached.fetchedAt < TRIGGER_CACHE_TTL_MS) return cached.triggers;
    const rows = await this.prisma.agentSkill.findMany({
      where: { guildId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, trigger: true },
    });
    this.cache.set(guildId, { triggers: rows, fetchedAt: Date.now() });
    return rows;
  }

  async createSkill(guildId: string, trigger: string, rule: string, creatorId: string): Promise<{ id: string; trigger: string; rule: string }> {
    const cleanTrigger = toSingleLine(trigger);
    const cleanRule = toSingleLine(rule);
    if (cleanTrigger.length < 3 || cleanTrigger.length > TRIGGER_MAX) {
      throw new Error(`Le trigger doit être une seule courte phrase de 3 à ${TRIGGER_MAX} caractères (reçu ${cleanTrigger.length}).`);
    }
    if (cleanRule.length < 3 || cleanRule.length > RULE_MAX) {
      throw new Error(`La règle doit être une seule phrase de 3 à ${RULE_MAX} caractères (reçu ${cleanRule.length}).`);
    }
    // Garde anti-doublon : un trigger qui recouvre un skill existant est
    // refusé (deux règles concurrentes sur la même demande = comportement
    // imprévisible). Normalisation minuscule/espaces pour la comparaison.
    const normalize = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const existing = await this.listSkills(guildId);
    const newWords = new Set(normalize(cleanTrigger).split(' ').filter((word) => word.length > 3));
    for (const skill of existing) {
      const oldWords = new Set(normalize(skill.trigger).split(' ').filter((word) => word.length > 3));
      if (oldWords.size === 0) continue;
      const overlap = [...newWords].filter((word) => oldWords.has(word)).length;
      const ratio = overlap / Math.min(newWords.size, oldWords.size);
      if (ratio >= 0.7) {
        throw new Error(
          `Doublon : ce trigger recouvre le skill existant « ${skill.trigger} » (${skill.id.slice(-6)}). ` +
            'Ouvre-le avec openSkill et propose une correction (deleteSkill puis recréation) au lieu d\u0027empiler deux règles concurrentes.',
        );
      }
    }
    const created = await this.prisma.agentSkill.create({
      data: { guildId, trigger: cleanTrigger, rule: cleanRule, createdByUserId: creatorId },
    });
    await this.invalidate(guildId);
    return { id: created.id, trigger: cleanTrigger, rule: cleanRule };
  }

  async openSkill(guildId: string, skillId: string): Promise<{ trigger: string; rule: string; usageCount: number } | null> {
    const row = await this.prisma.agentSkill.findFirst({
      where: { id: skillId, guildId, deletedAt: null },
    });
    if (!row) return null;
    await this.prisma.agentSkill.update({
      where: { id: row.id },
      data: { usageCount: { increment: 1 } },
    });
    return { trigger: row.trigger, rule: row.rule, usageCount: row.usageCount + 1 };
  }

  async listSkills(guildId: string): Promise<Array<{ id: string; trigger: string; rule: string; createdByUserId: string; usageCount: number }>> {
    return this.prisma.agentSkill.findMany({
      where: { guildId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, trigger: true, rule: true, createdByUserId: true, usageCount: true },
    });
  }

  async deleteSkills(guildId: string, skillIds: string[]): Promise<number> {
    const result = await this.prisma.agentSkill.updateMany({
      where: { guildId, id: { in: skillIds }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    await this.invalidate(guildId);
    return result.count;
  }
}
