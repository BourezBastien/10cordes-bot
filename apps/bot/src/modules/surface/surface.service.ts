import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client, MessageFlags, type GuildMember } from 'discord.js';
import { z } from 'zod';
import { ButtonService } from '@spraxium/components';
import type { BotTool, ToolResult } from '@10cordes/shared';
import {
  InteractionBindingSchema,
  PipelineStepSchema,
  SurfaceDefinitionSchema,
  validateSurfaceDefinition,
  type InteractionBinding,
  type PipelineStep,
  type SurfaceDefinition,
} from '@10cordes/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { defineTool } from '@10cordes/shared';
import { deepMerge } from '../../shared/utils/object';
import { SurfaceRenderer } from './surface.renderer';
import { CacheStoreService } from '../../shared/cache/cache-store.service';
import { SurfacePipelineService, type PipelineContext, type PipelineVars, type ToolRunner } from './surface.pipeline';

/**
 * MOTEUR GÉNÉRIQUE — primitives surface.* consommées par l'agent (et par les
 * SkillBlueprint en Phase 3). Toute interface interactive est une
 * InteractiveSurface (definition + state) rendue en Components V2, dont les
 * interactions passent par LE trio de handlers génériques. Les délais passent
 * par ScheduledTrigger (rattrapage garanti après reboot, cancelByKey).
 */

interface SurfaceRow {
  kind: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  kindLabel: string;
  definition: SurfaceDefinition;
  state: Record<string, unknown>;
}

export interface RunSurfaceInteractionArgs {
  surfaceId: string;
  bindingKey: string;
  member: GuildMember | null;
  userId: string;
  /** Valeurs du modal (surface:modal) ou options sélectionnées (select). */
  inputs?: Record<string, string>;
  selectedValues?: string[];
  /** Répond à l'interaction (éphémère/refus, ouverture modal). */
  replyEphemeral: (content: string) => Promise<void>;
  showModal: (title: string, inputs: ReadonlyArray<{ id: string; label: string; style: 'short' | 'paragraph'; placeholder?: string; required: boolean; minLength?: number; maxLength?: number }>) => Promise<void>;
  /** Origine de l'exécution des tools : le CLIQUEUR (permissions réelles). */
  runToolAsActor: ToolRunner;
}

@Injectable()
export class SurfaceService implements SpraxiumOnBoot {
  private readonly log = new Logger('Surface');
  private renderer: SurfaceRenderer | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pipeline: SurfacePipelineService,
    private readonly buttons: ButtonService,
    private readonly client: Client,
    private readonly cache: CacheStoreService,
  ) {}

  onBoot(): void {
    this.renderer = new SurfaceRenderer(this.buttons);
    getToolRegistry().register(this.surfaceCreateTool());
    getToolRegistry().register(this.surfacePatchStateTool());
    getToolRegistry().register(this.surfaceUpdateComponentTool());
    getToolRegistry().register(this.triggerScheduleTool());
    getToolRegistry().register(this.triggerCancelTool());
    getToolRegistry().register(this.surfaceGetTool());
    this.log.info('Surface engine ready (surface.create/patchState/updateComponent + trigger.schedule/cancel + surface.get).');
  }

  // ── Rendu / persistance ──────────────────────────────────────────

  async renderSurface(surfaceId: string): Promise<void> {
    const row = await this.prisma.interactiveSurface.findUnique({ where: { id: surfaceId } });
    if (!row || !this.renderer) return;
    const definition = SurfaceDefinitionSchema.parse(JSON.parse(row.definition));
    const channel = await this.client.channels.fetch(row.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) return;
    const container = await this.renderer.render(definition);
    const payload = { flags: MessageFlags.IsComponentsV2, components: [container] } as const;
    if (row.messageId) {
      const edited = await channel.messages.edit(row.messageId, payload).then(() => true).catch(() => false);
      if (edited) return;
    }
    const sent = await channel.send(payload).catch(() => null);
    if (sent) {
      await this.prisma.interactiveSurface.update({ where: { id: surfaceId }, data: { messageId: sent.id } }).catch(() => {});
    }
  }

  async loadSurface(surfaceId: string): Promise<SurfaceRow | null> {
    const row = await this.prisma.interactiveSurface.findUnique({ where: { id: surfaceId } });
    if (!row) return null;
    try {
      return {
        kind: 'surface',
        guildId: row.guildId,
        channelId: row.channelId,
        messageId: row.messageId,
        kindLabel: row.kind,
        definition: SurfaceDefinitionSchema.parse(JSON.parse(row.definition)),
        state: JSON.parse(row.state || '{}') as Record<string, unknown>,
      };
    } catch {
      return null;
    }
  }

  async saveState(surfaceId: string, state: Record<string, unknown>): Promise<void> {
    await this.prisma.interactiveSurface.update({ where: { id: surfaceId }, data: { state: JSON.stringify(state) } }).catch(() => {});
  }

  async saveDefinition(surfaceId: string, definition: SurfaceDefinition): Promise<void> {
    await this.prisma.interactiveSurface.update({
      where: { id: surfaceId },
      data: { definition: JSON.stringify(definition) },
    }).catch(() => {});
  }

  // ── Exécution d'une interaction (appelée par les handlers) ───────

  async runInteraction(args: RunSurfaceInteractionArgs): Promise<{ ok: boolean; message: string }> {
    const row = await this.prisma.interactiveSurface.findUnique({ where: { id: args.surfaceId } });
    if (!row) return { ok: false, message: 'Surface introuvable (supprimée ?).' };
    const surface = await this.loadSurface(args.surfaceId);
    if (!surface) return { ok: false, message: 'Surface illisible.' };
    const binding = this.findBinding(surface.definition, args.bindingKey);
    if (!binding) return { ok: false, message: `Bouton « ${args.bindingKey} » inconnu sur cette surface.` };

    // R0.4c — confirmation destructive : le clic ✅ sur une surface kind=confirm
    // pose la clé ICacheStore (TTL 5 min) que le registry vérifie au re-run.
    if (row.kind === 'confirm' && args.bindingKey === 'confirmer') {
      const state = JSON.parse(row.state || '{}') as { confirmKey?: string };
      if (state.confirmKey) {
        await this.cache.active.set(state.confirmKey, 'ok', 300);
        this.pipeline.auditRun(row.guildId, 'rule.confirm.accepted', args.userId, { confirmKey: state.confirmKey });
      }
    }
    if (row.kind === 'confirm' && args.bindingKey === 'annuler') {
      const state = JSON.parse(row.state || '{}') as { confirmKey?: string };
      if (state.confirmKey) {
        this.pipeline.auditRun(row.guildId, 'rule.confirm.denied', args.userId, { confirmKey: state.confirmKey });
      }
    }

    const vars: PipelineVars = {
      guildId: surface.guildId,
      channelId: surface.channelId,
      actorId: args.userId,
      actorName: args.member?.displayName ?? args.userId,
      surfaceId: args.surfaceId,
      messageId: surface.messageId,
      state: surface.state,
      steps: [],
      values: {},
      ...(args.inputs ? { modalValues: args.inputs } : {}),
      ...(args.selectedValues ? { selectedValues: args.selectedValues } : {}),
    };
    const ctx: PipelineContext = { vars, member: args.member, runTool: args.runToolAsActor };

    // AccessPolicy AVANT toute exécution (deny → éphémère, aucune mutation).
    const access = await this.pipeline.checkAccess(binding, ctx);
    if (!access.allowed) {
      await args.replyEphemeral(access.deny ?? 'Action non autorisée.');
      return { ok: false, message: 'Refusé par la politique d\u0027accès.' };
    }

    // Règle des 3 s (API v10) : openModal DOIT être la première réponse —
    // le handler n'a RIEN defer avant ce point ; le pipeline l'exécute en 1re
    // étape et on sort immédiatement pour showModal.
    if ((binding.pipeline[0] as PipelineStep | undefined)?.type === 'openModal') {
      const result = await this.pipeline.executePipeline(binding.pipeline.slice(0, 1), ctx);
      if (result.openModal) {
        await args.showModal(result.openModal.title, result.openModal.inputs);
        this.pipeline.auditRun(surface.guildId, 'surface.modal.opened', args.userId, { surfaceId: args.surfaceId, binding: args.bindingKey });
        return { ok: true, message: 'Modal ouvert.' };
      }
    }

    const result = await this.pipeline.executePipeline(binding.pipeline, ctx);

    // Persistance de l'état + patches de composants avant re-render.
    if (result.stateChanged) await this.saveState(args.surfaceId, vars.state);
    if (result.definitionChanged) await this.applyTriggerPatches(args.surfaceId, vars.steps);
    if (result.stateChanged || result.definitionChanged) await this.renderSurface(args.surfaceId);

    if (result.replyEphemeral) await args.replyEphemeral(result.replyEphemeral);
    this.pipeline.auditRun(surface.guildId, 'surface.interaction', args.userId, {
      surfaceId: args.surfaceId,
      binding: args.bindingKey,
      ok: result.ok,
      error: result.error,
    });
    return { ok: result.ok, message: result.error ?? 'Exécuté.' };
  }

  /** Soumission d'un modal : exécute le pipeline avec les valeurs saisies. */
  async runModalSubmit(args: Omit<RunSurfaceInteractionArgs, 'showModal'> & { bindingKey: string }): Promise<{ ok: boolean; message: string }> {
    return this.runInteraction({ ...args, showModal: async () => {} });
  }

  /** Recherche publique d'un binding par clé (utilisée par les handlers). */
  async findBindingFor(definition: SurfaceDefinition, key: string): Promise<InteractionBinding | null> {
    return this.findBinding(definition, key);
  }

  private findBinding(definition: SurfaceDefinition, key: string): InteractionBinding | null {
    for (const row of definition.rows) {
      const bindings = row.kind === 'buttons' ? row.buttons : row.select.options;
      const found = bindings.find((binding) => binding.key === key);
      if (found) return found;
    }
    return null;
  }

  /** Applique les patches updateComponent accumulés dans steps[] (binding + patch). */
  async applyTriggerPatches(surfaceId: string, steps: ReadonlyArray<Record<string, unknown>>): Promise<void> {
    const patches = steps.filter((step) => typeof step.binding === 'string' && step.patch && typeof step.patch === 'object');
    if (patches.length === 0) return;
    const row = await this.prisma.interactiveSurface.findUnique({ where: { id: surfaceId } });
    if (!row) return;
    const definition = SurfaceDefinitionSchema.parse(JSON.parse(row.definition));
    let changed = false;
    for (const step of patches) {
      for (const defRow of definition.rows) {
        const bindings = defRow.kind === 'buttons' ? defRow.buttons : defRow.select.options;
        const target = bindings.find((binding) => binding.key === step.binding);
        if (target) {
          Object.assign(target, step.patch as Record<string, unknown>);
          changed = true;
        }
      }
    }
    if (changed) await this.saveDefinition(surfaceId, definition);
  }

  // ── Tools (primitives agent) ─────────────────────────────────────

  private surfaceCreateTool(): BotTool {
    const service = this;
    return defineTool({
      name: 'surface.create',
      description:
        'Le constructeur UNIVERSEL d\u0027interface interactive : une surface Components V2 (titre, description, N rangées de boutons/menus à BINDINGS typés) avec état JSON persistant. Chaque binding = {key, label, style, access (permissions/rôles/cooldown par utilisateur/condition), pipeline (steps runTool/setState/updateComponent/sendMessage/replyEphemeral/openModal/record.write/trigger.schedule/trigger.cancelByKey/random/llm/if/forEach/claimOnce)}. Survit aux redémarrages, re-rendu automatique à chaque mutation. C\u0027est avec CETTE primitive que tu construis tickets, sondages, captcha, vocaux temporaires...',
      category: 'surface',
      paramsSchema: z.object({
        channelId: z.string().min(1),
        kind: z.string().min(1).max(40).default('custom'),
        definition: z.string().min(10).max(20_000).describe('JSON SurfaceDefinition complet'),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'Passe une definition JSON valide (schéma SurfaceDefinition) avec le VRAI contenu demandé : titre explicite, description utile, boutons réels (labels métier, pipelines complets). JAMAIS de coquille vide ni de placeholders (probe/test/ping). Clés de bindings kebab-case uniques. openModal uniquement en PREMIÈRE étape. Structure type : {"title":"...","description":"...","rows":[{"kind":"buttons","buttons":[{"key":"mon-action","label":"Mon action","pipeline":[...]}]}],"initialState":{...}}. Réponds en UNE phrase après création.',
      handler: async (input, ctx): Promise<ToolResult> => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { channelId, kind, definition: raw } = input as { channelId: string; kind?: string; definition: string };
        let definition: SurfaceDefinition;
        try {
          definition = SurfaceDefinitionSchema.parse(JSON.parse(raw));
        } catch (error) {
          return { ok: false, summary: `Définition invalide : ${error instanceof z.ZodError ? error.issues[0]?.message : 'JSON illisible'}` };
        }
        // R0.3 — STRICT : pas de surface « coquille vide » (bug Probe/ping).
        if (!definition.title || definition.title.trim().length < 3) {
          return { ok: false, summary: "Titre requis (min 3 caractères réels) : donne le VRAI titre du panneau, pas un placeholder." };
        }
        if (definition.rows.length === 0) {
          return { ok: false, summary: 'Au moins une rangée de composants est requise : fournis les VRAIS boutons/menus avec leurs labels et pipelines, pas une coquille vide.' };
        }
        if (definition.rows.every((row) => (row.kind === 'buttons' ? row.buttons.every((b) => /^(probe|test|ping|placeholder|todo)$/iu.test(b.label)) : row.select.options.every((o) => /^(probe|test|ping|placeholder|todo)$/iu.test(o.label))))) {
          return { ok: false, summary: 'Labels placeholder détectés (probe/test/ping) : fournis le VRAI contenu demandé par l\u0027utilisateur.' };
        }
        const errors = validateSurfaceDefinition(definition);
        if (errors.length > 0) return { ok: false, summary: `Définition rejetée : ${errors.join(' | ')}` };
        const created = await service.prisma.interactiveSurface.create({
          data: {
            guildId: ctx.guildId,
            channelId,
            kind: kind ?? 'custom',
            definition: JSON.stringify(definition),
            state: JSON.stringify(definition.initialState ?? {}),
            createdBy: ctx.userId,
          },
        });
        await service.renderSurface(created.id);
        const row = await service.prisma.interactiveSurface.findUnique({ where: { id: created.id } });
        service.audit.record({ guildId: ctx.guildId, source: 'agent', action: 'surface.created', actorId: ctx.userId, metadata: { surfaceId: created.id, kind: row?.kind } });
        return { ok: true, summary: `Surface « ${definition.title ?? row?.kind ?? ''} » créée dans <#${channelId}> (surfaceId ${created.id}).`, data: { surfaceId: created.id, messageId: row?.messageId } };
      },
    });
  }

  private surfacePatchStateTool(): BotTool {
    const service = this;
    return defineTool({
      name: 'surface.patchState',
      description: 'Modifie l\u0027état JSON persistant d\u0027une surface (fusion profonde) puis la RE-REND automatiquement. Identifie la surface par surfaceId OU par messageId (l\u0027id du message Discord qui l\u0027affiche).',
      category: 'surface',
      paramsSchema: z.object({
        surfaceId: z.string().min(1).optional().describe('ID de la surface (renvoyé par surface.create)'),
        messageId: z.string().min(1).optional().describe('ID du message Discord qui affiche la surface (alternative à surfaceId)'),
        state: z.record(z.string(), z.unknown()).describe('Patch profond à fusionner'),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Pour initialiser/compléter l\u0029état (owner, compteurs, grilles, résultats de vote). Le re-rendu est automatique.',
      handler: async (input, ctx): Promise<ToolResult> => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { surfaceId, messageId, state } = input as { surfaceId?: string; messageId?: string; state: Record<string, unknown> };
        const surface = await service.findSurface(ctx.guildId, surfaceId, messageId);
        if (!surface) return { ok: false, summary: 'Surface introuvable (surfaceId ou messageId requis).' };
        const merged = deepMerge(JSON.parse(surface.state || '{}') as Record<string, unknown>, state) as Record<string, unknown>;
        await service.saveState(surface.id, merged);
        await service.renderSurface(surface.id);
        return { ok: true, summary: `État de la surface ${surface.id.slice(-6)} mis à jour et re-rendu.` };
      },
    });
  }

  private surfaceUpdateComponentTool(): BotTool {
    const service = this;
    return defineTool({
      name: 'surface.updateComponent',
      description:
        'Patche une surface puis re-rend le message : SOIT un composant par sa clé de binding (label, style, emoji, disabled), SOIT l\u0027en-tête (title, description) — ex : afficher les résultats d\u0029un vote dans la description. Identifie la surface par surfaceId OU par messageId.',
      category: 'surface',
      paramsSchema: z.object({
        surfaceId: z.string().min(1).optional().describe('ID de la surface (renvoyé par surface.create)'),
        messageId: z.string().min(1).optional().describe('ID du message Discord qui affiche la surface'),
        binding: z.string().min(1).max(30).optional().describe('Clé du bouton/option à patcher'),
        title: z.string().max(120).optional().describe('Nouveau titre de la surface'),
        description: z.string().max(3500).optional().describe('Nouvelle description (supporte ## titres) — ex : résultats, pourcentages'),
        label: z.string().max(80).optional(),
        style: z.enum(['primary', 'secondary', 'success', 'danger']).optional(),
        emoji: z.string().max(16).optional(),
        disabled: z.boolean().optional(),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'La primitive « bouton rouge qui passe vert » ET « publier les résultats » : patch disabled/style/label d\u0027un binding, ou title/description de l\u0027en-tête (sans binding). Re-rendu immédiat. Pour clôturer un vote : patchState (résultats dans l\u0029état) + description avec les chiffres + disabled sur chaque bouton.',
      handler: async (input, ctx): Promise<ToolResult> => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { surfaceId, messageId, binding, title, description, ...patch } = input as {
          surfaceId?: string;
          messageId?: string;
          binding?: string;
          title?: string;
          description?: string;
          label?: string;
          style?: 'primary' | 'secondary' | 'success' | 'danger';
          emoji?: string;
          disabled?: boolean;
        };
        const surface = await service.findSurface(ctx.guildId, surfaceId, messageId);
        if (!surface) return { ok: false, summary: 'Surface introuvable (surfaceId ou messageId requis).' };
        const definition = SurfaceDefinitionSchema.parse(JSON.parse(surface.definition));
        const touched: string[] = [];
        if (title !== undefined || description !== undefined) {
          if (title !== undefined) definition.title = title;
          if (description !== undefined) definition.description = description;
          touched.push('en-tête');
        }
        if (binding !== undefined) {
          const target = this.findBinding(definition, binding);
          if (!target) return { ok: false, summary: `Binding « ${binding} » introuvable.` };
          Object.assign(target, { ...patch, ...(patch.label !== undefined ? { label: patch.label } : {}) });
          touched.push(`binding « ${binding} »`);
        }
        if (touched.length === 0) return { ok: false, summary: 'Rien à patcher : fournis binding, title ou description.' };
        await service.saveDefinition(surface.id, definition);
        await service.renderSurface(surface.id);
        return { ok: true, summary: `Surface re-rendue (${touched.join(' + ')}).` };
      },
    });
  }

  private triggerScheduleTool(): BotTool {
    const service = this;
    return defineTool({
      name: 'trigger.schedule',
      description:
        'Planifie un pipeline sur une surface : once (délai en secondes) ou cron. RATTRAPAGE GARANTI après reboot (plus de fenêtre de grâce : un once manqué s\u0029exécute au boot). cancelKey optionnel pour annulation (trigger.cancelByKey).',
      category: 'surface',
      paramsSchema: z.object({
        surfaceId: z.string().min(1).optional(),
        cancelKey: z.string().min(1).max(80).optional(),
        delaySec: z.number().int().min(1).max(86_400 * 90).optional(),
        cron: z.string().min(5).max(60).optional(),
        condition: z.unknown().optional().describe('JSON ConditionSpec évaluée À L\u0027ÉCHÉANCE (ex : state.claimedBy == null)'),
        steps: z.string().min(5).max(8000).describe('JSON ActionPipeline (steps)'),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'TOUS les délais des systèmes passent par ici (jamais setTimeout). Utilise cancelKey prévisible (ex : ticket-esc-{{surfaceId}}) pour permettre l\u0027annulation. La condition est ré-évaluée à l\u0027échéance.',
      handler: async (input, ctx): Promise<ToolResult> => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { surfaceId, cancelKey, delaySec, cron, condition, steps: rawSteps } = input as {
          surfaceId?: string;
          cancelKey?: string;
          delaySec?: number;
          cron?: string;
          condition?: unknown;
          steps: string;
        };
        const parsedSteps = z.array(PipelineStepSchema).min(1).max(10).safeParse(JSON.parse(rawSteps));
        if (!parsedSteps.success) return { ok: false, summary: `Steps invalides : ${parsedSteps.error.issues[0]?.message}` };
        if (!delaySec && !cron) return { ok: false, summary: 'delaySec ou cron requis.' };
        if (cancelKey) {
          await service.prisma.scheduledTrigger.updateMany({ where: { guildId: ctx.guildId, cancelKey, status: 'armed' }, data: { status: 'cancelled' } });
        }
        const runAt = cron ? service.pipeline.nextCron(cron) : new Date(Date.now() + (delaySec ?? 60) * 1000);
        // Le LLM passe souvent la condition/steps déjà en STRING JSON : on
        // normalise avant stockage (sinon double sérialisation → spec illisible).
        const conditionValue = typeof condition === 'string' ? JSON.parse(condition) : condition;
        const created = await service.prisma.scheduledTrigger
          .create({
            data: {
              guildId: ctx.guildId,
              surfaceId: surfaceId ?? null,
              cancelKey: cancelKey ?? null,
              kind: cron ? 'cron' : 'once',
              runAt,
              cron: cron ?? null,
              condition: conditionValue ? JSON.stringify(conditionValue) : null,
              steps: JSON.stringify(parsedSteps.data),
            },
          })
          .catch(() => null);
        if (!created) return { ok: false, summary: 'Création du trigger impossible (cancelKey dupliqué ?).' };
        service.audit.record({ guildId: ctx.guildId, source: 'agent', action: 'trigger.scheduled', actorId: ctx.userId, metadata: { triggerId: created.id, cancelKey: cancelKey ?? null, kind: cron ? 'cron' : 'once' } });
        return { ok: true, summary: `Trigger ${cron ? `cron « ${cron} »` : `dans ${delaySec}s`} armé${cancelKey ? ` (clé ${cancelKey})` : ''}.`, data: { triggerId: created.id } };
      },
    });
  }

  private triggerCancelTool(): BotTool {
    const service = this;
    return defineTool({
      name: 'trigger.cancelByKey',
      description: 'Annule les triggers armés portant cette clé d\u0027annulation (ex : ne pas supprimer un vocal rejoint pendant le délai).',
      category: 'surface',
      paramsSchema: z.object({ cancelKey: z.string().min(1).max(80) }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Réversible : les triggers cancelés restent en DB (status cancelled).',
      handler: async (input, ctx): Promise<ToolResult> => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { cancelKey } = input as { cancelKey: string };
        const cancelled = await service.prisma.scheduledTrigger.updateMany({ where: { guildId: ctx.guildId, cancelKey, status: 'armed' }, data: { status: 'cancelled' } });
        return { ok: true, summary: `${cancelled.count} trigger(s) « ${cancelKey} » annulé(s).` };
      },
    });
  }

  private surfaceGetTool(): BotTool {
    const service = this;
    return defineTool({
      name: 'surface.get',
      description: 'Lit une surface (définition + état actuel) — diagnostic et édition ultérieure. Identifie la surface par surfaceId OU par messageId (l\u0027id du message Discord qui l\u0027affiche).',
      category: 'surface',
      paramsSchema: z.object({
        surfaceId: z.string().min(1).optional(),
        messageId: z.string().min(1).optional().describe('ID du message Discord qui affiche la surface'),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (input, ctx): Promise<ToolResult> => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { surfaceId, messageId } = input as { surfaceId?: string; messageId?: string };
        const row = await service.findSurface(ctx.guildId, surfaceId, messageId);
        if (!row) return { ok: false, summary: 'Surface introuvable (surfaceId ou messageId requis).' };
        return { ok: true, summary: `Surface ${row.kind} : state=${row.state.slice(0, 400)}`, data: { surfaceId: row.id, definition: JSON.parse(row.definition), state: JSON.parse(row.state || '{}'), messageId: row.messageId } };
      },
    });
  }

  /** Résolution tolérante : par surfaceId exact, sinon par messageId affiché. */
  private async findSurface(
    guildId: string,
    surfaceId: string | undefined,
    messageId: string | undefined,
  ): Promise<{ id: string; kind: string; definition: string; state: string; messageId: string | null } | null> {
    if (surfaceId) {
      const byId = await this.prisma.interactiveSurface.findFirst({ where: { id: surfaceId, guildId } });
      if (byId) return byId;
    }
    if (messageId) {
      const byMessage = await this.prisma.interactiveSurface.findFirst({ where: { messageId, guildId }, orderBy: { createdAt: 'desc' } });
      if (byMessage) return byMessage;
    }
    return null;
  }
}

/** Validation exportée pour les handlers (binding par clé). */
export function parseBinding(raw: unknown): InteractionBinding | null {
  const parsed = InteractionBindingSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
