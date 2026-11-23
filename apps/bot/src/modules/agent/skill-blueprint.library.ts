import { z } from 'zod';
import type { SkillBlueprint, SkillDomain } from '@10cordes/shared';
import { defineTool, type BotTool } from '@10cordes/shared';
import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { PrismaService } from '../database/prisma.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { BLUEPRINT_LIBRARY } from './skills.blueprints';

/**
 * SkillBlueprintLibrary (P3.1) — remplace skills.library + seedLibrary :
 * les recettes officielles sont des SkillBlueprint typés (params
 * configurables, requiredTools vérifiés à la compilation, workflow
 * déclaratif composé de primitives (surface, records, triggers).
 *
 * - Injection : top 12 par scoring tags+trigger (jamais les N en bloc) ;
 * - search_skills : index à la demande (même pattern que search_tools) ;
 * - Purge au boot : UNIQUEMENT les skills officiels (createdByUserId =
 *   'library' ET trigger dans la bibliothèque), JAMAIS les skills
 *   créés par les membres ou générés par la Learning Loop.
 */

export interface BlueprintMatch {
  blueprint: SkillBlueprint;
  score: number;
}

const MAX_INJECTED = 12;

@Injectable()
export class SkillBlueprintLibrary implements SpraxiumOnBoot {
  private readonly log = new Logger('SkillBlueprints');

  constructor(private readonly prisma: PrismaService) {}

  onBoot(): void {
    getToolRegistry().register(this.searchSkillsTool());
    getToolRegistry().register(this.listBlueprintsTool());
    void this.seed();
    this.log.info(`SkillBlueprints ready (${BLUEPRINT_LIBRARY.length} recettes au catalogue, search_skills + top ${MAX_INJECTED}).`);
  }

  /** Seed idempotent : upsert par slug, purge des anciens officiels obsolètes. */
  private async seed(): Promise<void> {
    try {
      const guilds = await this.prisma.guild.findMany({ select: { id: true } });
      const currentSlugs = new Set(BLUEPRINT_LIBRARY.map((bp) => bp.slug));
      for (const guild of guilds) {
        // Un seul findMany par guild : INCLUT les soft-deleted (jamais
        // ressusciter un skill supprimé par le staff).
        const rows = await this.prisma.agentSkill.findMany({
          where: { guildId: guild.id, trigger: { in: BLUEPRINT_LIBRARY.map((bp) => bp.trigger) } },
          select: { id: true, trigger: true, createdByUserId: true, rule: true, deletedAt: true },
        });
        const byTrigger = new Map(rows.map((row) => [row.trigger, row]));
        for (const bp of BLUEPRINT_LIBRARY) {
          let existing = byTrigger.get(bp.trigger);
          if (existing?.deletedAt) {
            // Une ligne soft-supprimée n'est pas forcément un choix du staff.
            // Le staff supprime par le tool deleteSkills, que le registry audite
            // avec les identifiants. Sans cette trace, la suppression vient de
            // la purge ci-dessous (trigger devenu obsolète) : si le trigger est
            // de retour au catalogue, la recette redevient active. Sans cette
            // distinction, reformuler l'orthographe d'un trigger faisait
            // disparaître la recette (cas vécu : la recette AFK, le 23/11).
            const staffDeletion = await this.prisma.auditLog.count({
              where: {
                guildId: guild.id,
                action: { in: ['assistant.tool.deleteSkills', 'tool.deleteSkills'] },
                metadata: { contains: existing.id },
              },
            });
            if (staffDeletion > 0) continue;
            await this.prisma.agentSkill.update({ where: { id: existing.id }, data: { deletedAt: null } });
            existing = { ...existing, deletedAt: null };
          }
          if (existing?.createdByUserId === 'library') {
            // Mise à jour de la règle si elle a évolué
            const newRule = this.blueprintToRule(bp);
            if (existing.rule !== newRule) {
              await this.prisma.agentSkill.update({ where: { id: existing.id }, data: { rule: newRule } });
            }
            continue;
          }
          if (existing) continue;
          await this.prisma.agentSkill.create({
            data: {
              guildId: guild.id,
              trigger: bp.trigger,
              rule: this.blueprintToRule(bp),
              createdByUserId: 'library',
            },
          });
        }
        // Purge : les skills library dont le trigger n'est PLUS au catalogue
        // (recette retirée) — uniquement createdByUserId = 'library'.
        const librarySkills = await this.prisma.agentSkill.findMany({
          where: { guildId: guild.id, createdByUserId: 'library', deletedAt: null },
          select: { id: true, trigger: true },
        });
        for (const skill of librarySkills) {
          if (!currentSlugs.has(this.triggerToSlug(skill.trigger))) {
            // Le trigger ne correspond plus à aucune recette active : soft-delete
            if (!BLUEPRINT_LIBRARY.some((bp) => bp.trigger === skill.trigger)) {
              await this.prisma.agentSkill.update({ where: { id: skill.id }, data: { deletedAt: new Date() } }).catch(() => {});
            }
          }
        }
      }
    } catch (error) {
      this.log.warn(`Seed blueprints ignoré : ${(error as Error).message.slice(0, 100)}`);
    }
  }

  /** Convertit un blueprint en règle lisible par le LLM. */
  private blueprintToRule(bp: SkillBlueprint): string {
    const params = Object.entries(bp.params)
      .map(([key, spec]) => `${key} (${spec.type}${spec.required ? '' : ', optionnel'}) : ${spec.description} [défaut: ${spec.defaultValue}]`)
      .join('; ');
    return [
      `RECETTE ${bp.slug} [${bp.domain}]`,
      `Workflow : ${bp.workflow}`,
      `Params configurables : ${params || 'aucun'}`,
      `Tools requis : ${bp.requiredTools.join(', ')}`,
      `IMPORTANT : extrais les préférences de l'utilisateur (emoji, horaire, délai, seuil, langue, salons/rôles) pour surcharger les defaults. Génère les textes dans sa langue.`,
    ].join('\n');
  }

  private triggerToSlug(trigger: string): string {
    return trigger.toLowerCase().replace(/[^a-z0-9]+/gu, '-').slice(0, 60);
  }

  /** Scoring : recettes dont tags/trigger/domaine matchent la demande. */
  score(content: string): BlueprintMatch[] {
    const words = new Set(
      content
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(' ')
        .filter((word) => word.length > 2),
    );
    return BLUEPRINT_LIBRARY.map((blueprint) => {
      let score = 0;
      const haystack = `${blueprint.trigger} ${blueprint.tags.join(' ')} ${blueprint.domain}`.toLowerCase();
      for (const word of words) {
        if (haystack.includes(word)) score += 1;
      }
      return { blueprint, score };
    })
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  /** Top N pour l'injection prompt (score > 0 seulement). */
  top(content: string, limit = MAX_INJECTED): SkillBlueprint[] {
    return this.score(content)
      .slice(0, limit)
      .map((match) => match.blueprint);
  }

  private searchSkillsTool(): BotTool {
    const library = this;
    return defineTool({
      name: 'search_skills',
      description:
        'Search the skill blueprint catalog by keywords or domain: returns matching recipes (trigger, workflow summary, configurable params). Call this when the user asks for a system/feature that might have a pre-built recipe.',
      category: 'skills',
      paramsSchema: z.object({
        query: z.string().min(2).max(120).describe('Keywords (ex: "ticket", "temp voice", "giveaway", "captcha")'),
        domain: z.string().max(30).optional().describe('Filter by domain: tickets, voice, moderation, onboarding, forms, engagement, events, monitoring, automation, community'),
      }),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt:
        'Skill routing : si une recette correspond, suis son workflow (ouvre le skill via openSkill pour la règle complète). Les recettes listent les tools et les params configurables.',
      handler: async (input) => {
        const { query, domain } = input as { query: string; domain?: string };
        let matches = library.score(query);
        if (domain) {
          matches = matches.filter((m) => m.blueprint.domain === (domain as SkillDomain));
        }
        if (matches.length === 0) {
          return { ok: true, summary: `Aucune recette pour « ${query} » : construis le système librement avec les primitives (surface.create, records, triggers).`, data: { skills: [] } };
        }
        const cards = matches.slice(0, 8).map(({ blueprint, score }) => ({
          slug: blueprint.slug,
          domain: blueprint.domain,
          trigger: blueprint.trigger,
          workflow: blueprint.workflow.slice(0, 200),
          params: Object.keys(blueprint.params),
          requiredTools: blueprint.requiredTools,
          score,
        }));
        const lines = cards.map((card) => `- **${card.slug}** [${card.domain}] : ${card.trigger} · tools: ${card.requiredTools.slice(0, 5).join(', ')}${card.requiredTools.length > 5 ? '...' : ''}`);
        return {
          ok: true,
          summary: `${cards.length} recette(s) trouvée(s) :\n${lines.join('\n')}\nOuvre le skill correspondant (openSkill) pour le workflow complet.`,
          data: { skills: cards },
        };
      },
    });
  }

  private listBlueprintsTool(): BotTool {
    const library = this;
    return defineTool({
      name: 'blueprints.list',
      description: 'Liste les domaines et recettes disponibles au catalogue de skills officiels.',
      category: 'skills',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt: 'Read-only. Pour découvrir ce qui existe avant de construire.',
      handler: async () => {
        const byDomain = new Map<string, number>();
        for (const bp of BLUEPRINT_LIBRARY) {
          byDomain.set(bp.domain, (byDomain.get(bp.domain) ?? 0) + 1);
        }
        const lines = [...byDomain.entries()].map(([domain, count]) => `**${domain}** : ${count} recette(s)`);
        return { ok: true, summary: `${BLUEPRINT_LIBRARY.length} recettes au catalogue : ${lines.join(' · ')}` };
      },
    });
  }
}
