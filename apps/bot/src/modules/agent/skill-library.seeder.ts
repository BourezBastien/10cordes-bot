import type { Logger } from '@spraxium/logger';
import type { PrismaService } from '../database/prisma.service';
// P3.1 : le seed passe par SkillBlueprintLibrary (blueprints typés).
// L'ancien SKILL_LIBRARY plat n'est plus la source de vérité.
import { BLUEPRINT_LIBRARY } from './skills.blueprints';

/**
 * Seed de la bibliothèque de skills, exécuté au boot par SkillService.
 * Collaborateur non injectable : instancié par le service, qui lui fournit
 * Prisma et son logger.
 */
export class SkillLibrarySeeder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly log: Logger,
  ) {}

  /**
   * Bibliothèque : upsert des skills officiels manquants pour chaque serveur
   * connu (idempotent par trigger exact). Tous actifs ; supprimables.
   */
  async seedLibrary(): Promise<void> {
    try {
      const guilds = await this.prisma.guild.findMany({ select: { id: true } });
      let seeded = 0;
      for (const guild of guilds) {
        // Un seul findMany par guild (l'ancien findFirst par skill était un
        // N+1 séquentiel) ; INCLUT les soft-deleted : une skill supprimée
        // par le staff ne doit PAS être ressuscitée au boot suivant.
        const rows = await this.prisma.agentSkill.findMany({
          where: { guildId: guild.id, trigger: { in: BLUEPRINT_LIBRARY.map((bp) => bp.trigger) } },
          select: { id: true, trigger: true, createdByUserId: true, rule: true, deletedAt: true },
        });
        const byTrigger = new Map(rows.map((row) => [row.trigger, row]));
        for (const skill of BLUEPRINT_LIBRARY) {
          const existing = byTrigger.get(skill.trigger);
          // Soft-deleted (par le staff ou un membre) : on ne re-seed JAMAIS.
          if (existing?.deletedAt) continue;
          // Les skills de bibliothèque suivent le code : la règle est mise à
          // jour à chaque boot si elle évolue (les skills de membres non).
          if (existing?.createdByUserId === 'library') {
            if (existing.rule !== this.blueprintRule(skill)) {
              await this.prisma.agentSkill.update({ where: { id: existing.id }, data: { rule: this.blueprintRule(skill) } });
            }
            continue;
          }
          if (existing) continue;
          await this.prisma.agentSkill.create({
            data: {
              guildId: guild.id,
              trigger: skill.trigger,
              rule: this.blueprintRule(skill),
              createdByUserId: 'library',
            },
          });
          seeded++;
        }
      }
      if (seeded > 0) this.log.info(`${seeded} skill(s) de bibliothèque seedés.`);
    } catch (error) {
      this.log.warn(`Seed bibliothèque ignoré : ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Convertit un SkillBlueprint en règle lisible par le LLM. */
  private blueprintRule(bp: import('@10cordes/shared').SkillBlueprint): string {
    const params = Object.entries(bp.params)
      .map(([key, spec]) => `${key} (${spec.type}) : ${spec.description} [défaut: ${spec.defaultValue}]`)
      .join('; ');
    return `RECETTE ${bp.slug} [${bp.domain}] ; Workflow : ${bp.workflow} | Params : ${params || 'aucun'} | IMPORTANT : extrais les préférences de l'utilisateur pour surcharger les defaults.`;
  }
}
