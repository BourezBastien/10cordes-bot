import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { z } from 'zod';
import { defineTool, type BotTool } from '@10cordes/shared';
import { PrismaService } from '../database/prisma.service';
import type { AuditEntry } from '../audit/audit.service';
import { AuditService } from '../audit/audit.service';
import { getToolRegistry, ToolRegistryService, bindRegistryRuntimeDeps } from '../tool-registry/tool-registry.service';
import { bindGuildRules } from './guild-rules.runtime';

/**
 * Règles Serveur (R0.4) : le système demandé en langage naturel par les
 * admins, appliqué À DEUX NIVEAUX :
 * - EN CODE : la Gate (zone libre vs mention stricte) et le ToolRegistry
 *   (confirmation des actions qui modifient, règle « Confirmer les actions
 *   (hors lecture) ») lisent ce store ;
 * - EN PROMPT : SystemPromptBuilder injecte la section <SERVER_RULES>.
 * Zéro commande : tout passe par l'agent (« la catégorie AGENTS est une
 * zone libre agents, ailleurs mention stricte »).
 */

export interface GuildRules {
  freeCategoryIds: string[];
  freeChannelIds: string[];
  blockedChannelIds: string[];
  strictMentionElsewhere: boolean;
  seriousOnlyElsewhere: boolean;
  /** Règle « Confirmer les actions (hors lecture) » : tout ce que le modèle propose et qui modifie attend le clic du demandeur. */
  confirmDestructiveActions: boolean;
  customInstructions: string[];
}

const DEFAULT_RULES: GuildRules = {
  freeCategoryIds: [],
  freeChannelIds: [],
  blockedChannelIds: [],
  strictMentionElsewhere: true,
  seriousOnlyElsewhere: false,
  // Désactivée par défaut : la confirmation de chaque action qui modifie est un choix du staff.
  confirmDestructiveActions: false,
  customInstructions: [],
};

const CACHE_TTL_MS = 60_000;

/** Origine d'une écriture, pour l'audit : l'agent (outil `rules.set`) par défaut, l'API du dashboard sinon. */
type AuditSource = NonNullable<AuditEntry['source']>;

/**
 * Patch accepté par l'outil `rules.set` et par l'API du dashboard : mêmes
 * champs, mêmes bornes pour les deux (au plus 10 instructions ajoutées ou
 * retirées par patch, de 3 à 300 caractères chacune).
 */
const GUILD_RULES_PATCH_SCHEMA = z.object({
  freeCategoryIds: z.array(z.string().min(15)).max(20).optional(),
  freeChannelIds: z.array(z.string().min(15)).max(50).optional(),
  blockedChannelIds: z.array(z.string().min(15)).max(50).optional().describe('Salons où le bot est TOTALEMENT muet (même mentionné)'),
  strictMentionElsewhere: z.boolean().optional(),
  seriousOnlyElsewhere: z.boolean().optional(),
  confirmDestructiveActions: z.boolean().optional().describe('Règle « Confirmer les actions (hors lecture) » : toute action qui modifie attend le clic du demandeur'),
  addCustomInstructions: z.array(z.string().min(3).max(300)).max(10).optional(),
  removeCustomInstructions: z.array(z.string().min(3).max(300)).max(10).optional(),
});

type GuildRulesPatch = z.output<typeof GUILD_RULES_PATCH_SCHEMA>;

/** Les champs fournis d'un patch : un champ à `undefined` ne change rien et ne doit pas écraser la valeur en place. */
function provided<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/** Ligne du prompt système quand la règle est active : ce que le modèle doit faire, et ne pas faire. */
const CONFIRM_RULE_PROMPT =
  'Confirmer les actions (hors lecture) : sur ce serveur, toute action qui modifie attend le clic du demandeur sur un panneau « Appliquer » / « Annuler », affiché en fin de réponse (géré par le système). ' +
  'Propose chaque action UNE fois, annonce qu\u0027elle attend son approbation, ne la retente pas et n\u0027enchaîne rien qui dépendrait d\u0027elle. Les lectures, et la livraison d\u0027un fichier ou d\u0027un média, ne sont pas concernées.';

@Injectable()
export class GuildRulesService implements SpraxiumOnBoot {
  private readonly log = new Logger('GuildRules');
  private readonly cache = new Map<string, { rules: GuildRules; fetchedAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onBoot(): void {
    getToolRegistry().register(this.rulesSetTool());
    getToolRegistry().register(this.rulesListTool());
    // Liaisons runtime, ICI et non dans GuildRulesModule (que le framework
    // n'instancie pas) : sans elles le registry sautait silencieusement la
    // confirmation des actions, règle serveur activée ou non.
    bindRegistryRuntimeDeps({ rules: this });
    bindGuildRules(this);
    const ready = ToolRegistryService.runtimeDepsReady();
    const missing = (Object.entries(ready) as Array<[string, boolean]>).filter(([, bound]) => !bound).map(([name]) => name);
    if (missing.length > 0) {
      this.log.warn(`Confirmation des actions INOPÉRANTE : dépendances runtime non liées (${missing.join(', ')}).`);
    } else {
      this.log.info('GuildRules ready (rules.set / rules.list) · confirmation des actions opérationnelle (plans d\u0027action).');
    }
  }

  /** Règles effectives d'un serveur (cache 60 s ; défauts si aucune ligne). */
  async get(guildId: string): Promise<GuildRules> {
    const cached = this.cache.get(guildId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.rules;
    const row = await this.prisma.guildRule.findUnique({ where: { guildId } }).catch(() => null);
    const rules = row ? this.parse(row) : DEFAULT_RULES;
    this.cache.set(guildId, { rules, fetchedAt: Date.now() });
    return rules;
  }

  /** Vidage du cache d'un serveur : synchrone, il n'y a rien à attendre. */
  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  private parse(row: { freeCategoryIds: string; freeChannelIds: string; blockedChannelIds: string; customInstructions: string; strictMentionElsewhere: boolean; seriousOnlyElsewhere: boolean; confirmDestructiveActions: boolean }): GuildRules {
    const json = (value: string, fallback: string[]): string[] => {
      try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? (parsed.filter((item): item is string => typeof item === 'string')) : fallback;
      } catch {
        return fallback;
      }
    };
    return {
      freeCategoryIds: json(row.freeCategoryIds, []),
      freeChannelIds: json(row.freeChannelIds, []),
      blockedChannelIds: json(row.blockedChannelIds, []),
      strictMentionElsewhere: row.strictMentionElsewhere,
      seriousOnlyElsewhere: row.seriousOnlyElsewhere,
      confirmDestructiveActions: row.confirmDestructiveActions,
      customInstructions: json(row.customInstructions, []),
    };
  }

  /** Le salon est-il BLOQUÉ (MUET total : le bot ne répond JAMAIS ici, même mentionné) ? */
  async isBlocked(guildId: string, channelId: string): Promise<boolean> {
    const rules = await this.get(guildId);
    return rules.blockedChannelIds.includes(channelId);
  }

  /** Le salon est-il en ZONE LIBRE (catégorie ou salon listé) ? */
  async isFreeZone(guildId: string, channelId: string, parentCategoryId: string | null): Promise<boolean> {
    const rules = await this.get(guildId);
    if (rules.freeChannelIds.includes(channelId)) return true;
    return parentCategoryId !== null && rules.freeCategoryIds.includes(parentCategoryId);
  }

  /**
   * Règles d'un serveur mises à jour par un patch partiel : le même chemin pour
   * l'outil `rules.set` (agent) et pour le dashboard (API). Un champ fourni
   * remplace le sien ; les instructions libres s'ajoutent et se retirent par
   * listes (retrait par texte exact, ajout à la suite), les autres ne bougent
   * pas. Seuls les champs fournis changent.
   */
  async apply(guildId: string, patch: GuildRulesPatch, actorId: string, source: AuditSource = 'agent'): Promise<GuildRules> {
    const { addCustomInstructions, removeCustomInstructions, ...fields } = GUILD_RULES_PATCH_SCHEMA.parse(patch);
    const changes: Partial<GuildRules> = provided(fields);
    if (addCustomInstructions !== undefined || removeCustomInstructions !== undefined) {
      const current = await this.get(guildId);
      const removed = new Set(removeCustomInstructions ?? []);
      changes.customInstructions = [...current.customInstructions.filter((line) => !removed.has(line)), ...(addCustomInstructions ?? [])];
    }
    return this.patch(guildId, changes, actorId, source);
  }

  /** Patch partiel des règles (fusion, upsert, invalidation, audit). */
  private async patch(guildId: string, patch: Partial<GuildRules>, actorId: string, source: AuditSource = 'agent'): Promise<GuildRules> {
    const current = await this.get(guildId);
    const merged: GuildRules = { ...current, ...patch };
    await this.prisma.guildRule.upsert({
      where: { guildId },
      create: {
        guildId,
        freeCategoryIds: JSON.stringify(merged.freeCategoryIds),
        freeChannelIds: JSON.stringify(merged.freeChannelIds),
        blockedChannelIds: JSON.stringify(merged.blockedChannelIds),
        strictMentionElsewhere: merged.strictMentionElsewhere,
        seriousOnlyElsewhere: merged.seriousOnlyElsewhere,
        confirmDestructiveActions: merged.confirmDestructiveActions,
        customInstructions: JSON.stringify(merged.customInstructions),
      },
      update: {
        freeCategoryIds: JSON.stringify(merged.freeCategoryIds),
        freeChannelIds: JSON.stringify(merged.freeChannelIds),
        blockedChannelIds: JSON.stringify(merged.blockedChannelIds),
        strictMentionElsewhere: merged.strictMentionElsewhere,
        seriousOnlyElsewhere: merged.seriousOnlyElsewhere,
        confirmDestructiveActions: merged.confirmDestructiveActions,
        customInstructions: JSON.stringify(merged.customInstructions),
      },
    });
    this.invalidate(guildId);
    this.audit.record({
      guildId,
      source,
      action: 'rules.set',
      actorId,
      metadata: { patch: Object.keys(patch) },
    });
    return merged;
  }

  /** Représentation compacte pour l'injection prompt <SERVER_RULES>. */
  async describeForPrompt(guildId: string): Promise<string[]> {
    const rules = await this.get(guildId);
    if (JSON.stringify(rules) === JSON.stringify(DEFAULT_RULES)) return [];
    const lines: string[] = [];
    if (rules.freeCategoryIds.length > 0 || rules.freeChannelIds.length > 0) {
      const cats = rules.freeCategoryIds.map((id) => `<#${id}>`).join(', ') || 'aucune';
      const chans = rules.freeChannelIds.map((id) => `<#${id}>`).join(', ') || 'aucun';
      lines.push(`Zone libre agents (réponse sans mention, liberté totale) : catégories ${cats}, salons ${chans}.`);
    }
    if (rules.blockedChannelIds.length > 0) {
      lines.push(`Salons où je suis TOTALEMENT muet (ne réponds JAMAIS, même mentionné) : ${rules.blockedChannelIds.map((id) => `<#${id}>`).join(', ')}.`);
    }
    if (rules.strictMentionElsewhere) lines.push('Hors zone libre : le membre doit me mentionner (@) ou me répondre : je ne réagis pas à mon nom en texte brut.');
    if (rules.seriousOnlyElsewhere) lines.push('Hors zone libre : ton sérieux uniquement, pas de blagues ni de bavardage hors-sujet.');
    if (rules.confirmDestructiveActions) lines.push(CONFIRM_RULE_PROMPT);
    for (const instruction of rules.customInstructions) lines.push(`Règle du serveur : ${instruction}`);
    return lines;
  }

  private rulesSetTool(): BotTool {
    const service = this;
    return defineTool({
      name: 'rules.set',
      description:
        "Définit les règles de comportement du serveur (persistées, appliquées automatiquement par le système). Champs : freeCategoryIds/freeChannelIds (zones libres : le bot répond sans mention et agit librement), strictMentionElsewhere (ailleurs, mention @ obligatoire), seriousOnlyElsewhere (ailleurs, ton sérieux uniquement), confirmDestructiveActions (règle « Confirmer les actions (hors lecture) » : tout ce qui modifie attend un clic du demandeur), customInstructions (règles libres). Seuls les champs fournis changent.",
      category: 'rules',
      paramsSchema: GUILD_RULES_PATCH_SCHEMA,
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'Résous TOUJOURS les catégories/salons via getChannels (IDs réels du serveur) avant de les passer. Pour une demande du type « la catégorie AGENTS est une zone libre agents, ailleurs mention stricte et sérieux » : freeCategoryIds=[catégorie], strictMentionElsewhere=true, seriousOnlyElsewhere=true en UN seul appel.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const merged = await service.apply(ctx.guildId, input as GuildRulesPatch, ctx.userId);
        return { ok: true, summary: `Règles mises à jour : ${service.describe(merged)}`, data: { rules: merged } };
      },
    });
  }

  private rulesListTool(): BotTool {
    const service = this;
    return defineTool({
      name: 'rules.list',
      description: 'Liste les règles de comportement actives du serveur (zones libres, mention stricte, confirmer les actions (hors lecture), instructions libres).',
      category: 'rules',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        void input;
        const rules = await service.get(ctx.guildId);
        return { ok: true, summary: `Règles actives : ${service.describe(rules)}`, data: { rules } };
      },
    });
  }

  describe(rules: GuildRules): string {
    const parts: string[] = [];
    if (rules.freeCategoryIds.length > 0) parts.push(`zones libres catégories ${rules.freeCategoryIds.map((id) => `<#${id}>`).join(', ')}`);
    if (rules.freeChannelIds.length > 0) parts.push(`zones libres salons ${rules.freeChannelIds.map((id) => `<#${id}>`).join(', ')}`);
    parts.push(`mention stricte ailleurs : ${rules.strictMentionElsewhere ? 'oui' : 'non'}`);
    parts.push(`ton sérieux ailleurs : ${rules.seriousOnlyElsewhere ? 'oui' : 'non'}`);
    parts.push(`confirmer les actions (hors lecture) : ${rules.confirmDestructiveActions ? 'oui' : 'non'}`);
    if (rules.customInstructions.length > 0) parts.push(`instructions : ${rules.customInstructions.length}`);
    return parts.join(' · ') || 'aucune règle spécifique (défauts)';
  }
}
