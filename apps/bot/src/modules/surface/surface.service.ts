import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { ButtonService } from '@spraxium/components';
import { Client, type GuildMember } from 'discord.js';
import { SurfaceDefinitionSchema, type InteractionBinding, type PipelineStep, type SurfaceDefinition } from '@10cordes/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { SurfaceRenderer } from './surface.renderer';
import { bindSurfaceRuntime } from './surface.runtime';
import { applyBindingPatches, findBinding, isBindingPatch } from './surface-definition';
import { SurfaceMessagePresenter } from './surface.presenter';
import { SurfaceStore, type SurfaceRow } from './surface.store';
import { buildSurfaceTools } from './surface.tools';
import { buildTriggerTools, type TriggerToolsDeps } from './surface-trigger.tools';
import { SurfacePipelineService, type PipelineContext, type PipelineVars, type ToolRunner } from './surface.pipeline';

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
  showModal: (
    title: string,
    inputs: ReadonlyArray<{ id: string; label: string; style: 'short' | 'paragraph'; placeholder?: string; required: boolean; minLength?: number; maxLength?: number }>,
  ) => Promise<void>;
  /** Origine de l'exécution des tools : le CLIQUEUR (permissions réelles). */
  runToolAsActor: ToolRunner;
}

/**
 * MOTEUR GÉNÉRIQUE : primitives surface.* consommées par l'agent (et par les
 * SkillBlueprint). Toute interface interactive est une InteractiveSurface
 * (definition + state) rendue en Components V2, dont les interactions passent
 * par LE trio de handlers génériques. Les délais passent par ScheduledTrigger
 * (rattrapage garanti après reboot, cancelByKey).
 *
 * Répartition : SurfaceStore (persistance), SurfaceMessagePresenter (payload
 * Discord), surface-definition.ts (bindings), surface.tools.ts et
 * surface-trigger.tools.ts (primitives agent), SurfacePipelineService (exécution).
 */
@Injectable()
export class SurfaceService implements SpraxiumOnBoot {
  private readonly log = new Logger('Surface');
  private renderer: SurfaceRenderer | null = null;
  // Presenter pur et store : champs de classe, jamais des paramètres de constructeur DI.
  private readonly presenter = new SurfaceMessagePresenter();
  private readonly store: SurfaceStore;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pipeline: SurfacePipelineService,
    private readonly buttons: ButtonService,
    private readonly client: Client,
  ) {
    this.store = new SurfaceStore(prisma);
  }

  onBoot(): void {
    this.renderer = new SurfaceRenderer(this.buttons);
    // Runtime de rendu consommé par le registry (surfaces de confirmation) :
    // lié ICI et non dans SurfaceModule, que le framework n'instancie pas.
    bindSurfaceRuntime({ render: (surfaceId: string) => this.renderSurface(surfaceId) });
    const toolDeps: TriggerToolsDeps = {
      prisma: this.prisma,
      audit: this.audit,
      store: this.store,
      render: (surfaceId) => this.renderSurface(surfaceId),
      nextCron: (expression) => this.pipeline.nextCron(expression),
    };
    const registry = getToolRegistry();
    for (const tool of [...buildSurfaceTools(toolDeps), ...buildTriggerTools(toolDeps)]) registry.register(tool);
    this.log.info('Surface engine ready (surface.create/patchState/updateComponent + trigger.schedule/cancel + surface.get).');
  }

  // ── Rendu ───────────────────────────────────────────────────────

  /** Rend (ou re-rend en place) le message Discord d'une surface. */
  async renderSurface(surfaceId: string): Promise<void> {
    const row = await this.store.findRow(surfaceId);
    if (!row || !this.renderer) return;
    const definition = SurfaceDefinitionSchema.parse(JSON.parse(row.definition));
    const channel = await this.client.channels.fetch(row.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) return;
    const container = await this.renderer.render(definition, JSON.parse(row.state || '{}') as Record<string, unknown>);
    const payload = this.presenter.payload(container);
    if (row.messageId) {
      const edited = await channel.messages.edit(row.messageId, payload).then(() => true).catch(() => false);
      if (edited) return;
    }
    const sent = await channel.send(payload).catch(() => null);
    if (sent) {
      await this.store.attachMessage(surfaceId, sent.id);
    }
  }

  async loadSurface(surfaceId: string): Promise<SurfaceRow | null> {
    return this.store.load(surfaceId);
  }

  async saveState(surfaceId: string, state: Record<string, unknown>): Promise<void> {
    await this.store.saveState(surfaceId, state);
  }

  async saveDefinition(surfaceId: string, definition: SurfaceDefinition): Promise<void> {
    await this.store.saveDefinition(surfaceId, definition);
  }

  // ── Exécution d'une interaction (appelée par les handlers) ───────

  async runInteraction(args: RunSurfaceInteractionArgs): Promise<{ ok: boolean; message: string }> {
    const row = await this.store.findRow(args.surfaceId);
    if (!row) return { ok: false, message: 'Surface introuvable (supprimée ?).' };
    const surface = await this.loadSurface(args.surfaceId);
    if (!surface) return { ok: false, message: 'Surface illisible.' };
    const binding = findBinding(surface.definition, args.bindingKey);
    if (!binding) return { ok: false, message: `Bouton « ${args.bindingKey} » inconnu sur cette surface.` };

    const ctx: PipelineContext = {
      vars: {
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
      },
      member: args.member,
      runTool: args.runToolAsActor,
    };

    // AccessPolicy AVANT toute exécution (deny → éphémère, aucune mutation).
    const access = await this.pipeline.checkAccess(binding, ctx);
    if (!access.allowed) {
      await args.replyEphemeral(access.deny ?? 'Action non autorisée.');
      return { ok: false, message: 'Refusé par la politique d\u0027accès.' };
    }

    // Règle des 3 s (API v10) : openModal DOIT être la première réponse. Le
    // handler n'a RIEN defer avant ce point ; le pipeline l'exécute en 1re
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
    if (result.stateChanged) await this.saveState(args.surfaceId, ctx.vars.state);
    if (result.definitionChanged) await this.applyTriggerPatches(args.surfaceId, ctx.vars.steps);
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
    return findBinding(definition, key);
  }

  /** Applique les patches updateComponent accumulés dans steps[] (binding + patch). */
  async applyTriggerPatches(surfaceId: string, steps: ReadonlyArray<Record<string, unknown>>): Promise<void> {
    if (!steps.some(isBindingPatch)) return;
    const row = await this.store.findRow(surfaceId);
    if (!row) return;
    const definition = SurfaceDefinitionSchema.parse(JSON.parse(row.definition));
    if (applyBindingPatches(definition, steps)) await this.saveDefinition(surfaceId, definition);
  }
}
