import { Injectable } from '@spraxium/common';
import type { BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { ModuleManagerService } from '../module-manager/module-manager.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { fileLog } from '../logging/file-log.service';
import { permissionNamesPolicy } from '../../core/security/permission-names.policy';
import { redactToolInput } from './tool-input.redaction';
import { buildBuiltinTools } from './tool-registry.builtin';
import { DestructiveConfirmationGate } from './tool-registry.confirm';
import {
  bindRegistryInstance,
  bindRegistryRuntimeDeps,
  getToolRegistry,
  registryRuntimeDeps,
  registryRuntimeDepsReady,
} from './tool-registry.runtime';
import { ToolNodePolicy } from './tool-node.policy';

export { bindRegistryRuntimeDeps, getToolRegistry };

/**
 * Registry central des tools (0.10), contrat `BotTool` dans @10cordes/shared.
 * Chaque module enregistre ses tools ici (`register()`) ; les frontends
 * (assistant chat, vocal, dashboard, MCP over HTTP) consomment ce même registry.
 *
 * `run` applique les gates DANS L'ORDRE : modules requis actifs → nœud deny
 * du staff → permissions Discord (sauf nœud allow) → validation Zod →
 * confirmation destructive (règle serveur) → handler → audit. Un tool qui
 * échoue devient un refus explicite `{ ok: false, summary }` que le modèle
 * reformule : il ne lève JAMAIS dans la boucle LLM.
 */

/** Options d'exécution d'un tool : décidées par le serveur, jamais par le modèle. */
export interface RunOptions {
  /** Identifiant du plan d'action approuvé dont cette exécution fait partie. */
  approvedBy?: string;
}

@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, BotTool>();
  private readonly nodes: ToolNodePolicy;
  private readonly confirmation: DestructiveConfirmationGate;

  constructor(
    private readonly modules: ModuleManagerService,
    private readonly configService: GuildConfigService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {
    bindRegistryInstance(this);
    this.nodes = new ToolNodePolicy(prisma);
    this.confirmation = new DestructiveConfirmationGate(() => registryRuntimeDeps, audit);
    for (const tool of buildBuiltinTools({ registry: this, modules, configService })) this.register(tool);
  }

  /**
   * Auto-diagnostic : la dépendance runtime de la confirmation destructive
   * (les règles serveur) est-elle liée ? Liée par GuildRulesService.onBoot.
   */
  static runtimeDepsReady(): { rules: boolean } {
    return registryRuntimeDepsReady();
  }

  /** Options d'exécution d'un tool, décidées par le serveur et jamais par le modèle. */
  private static readonly NO_OPTIONS: RunOptions = {};

  register(tool: BotTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): BotTool | undefined {
    return this.tools.get(name);
  }

  list(): BotTool[] {
    return [...this.tools.values()];
  }

  /** Invalide le cache des permission nodes d'un serveur (après node.set/remove). */
  invalidateNodes(guildId: string): void {
    this.nodes.invalidate(guildId);
  }

  /** Tools exécutables sur ce serveur : uniquement ceux dont les modules sont actifs. */
  async listForGuild(guildId: string | null): Promise<BotTool[]> {
    const active = await this.modules.activeModules(guildId);
    return this.list().filter((tool) => tool.requiredModules.every((id) => active.has(id)));
  }

  /**
   * Exécute un tool. `options.approvedBy` désigne un plan d'action approuvé
   * par un clic : ses actions traversent la porte de confirmation, la Policy
   * les ayant revérifiées à l'instant du clic. Seul le serveur le passe.
   */
  async run(name: string, input: unknown, ctx: ToolRunContext, options: RunOptions = ToolRegistryService.NO_OPTIONS): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, summary: `Unknown tool \`${name}\`.` };

    // Traçabilité TOTALE (demande owner) : chaque appel de tool est audité,
    // succès comme refus, c'est ce qui permet de vérifier le comportement
    // de l'agent (rigs, diagnostics) et de reconstituer une action. Les
    // paramètres déclarés sensibles (clé API) y sont masqués.
    const finish = (result: ToolResult, deniedPermission?: string[]): ToolResult => {
      this.audit.record({
        guildId: ctx.guildId,
        source: 'agent',
        action: deniedPermission ? `tool.denied.${name}` : `tool.${name}`,
        actorId: ctx.userId,
        metadata: deniedPermission
          ? { missing: deniedPermission }
          : { ok: result.ok, input: redactToolInput(input, tool.sensitiveInputs), ...(options.approvedBy ? { approvedBy: options.approvedBy } : {}) },
      });
      return result;
    };

    const active = await this.modules.activeModules(ctx.guildId);
    const inactive = tool.requiredModules.filter((id) => !active.has(id));
    if (inactive.length > 0) {
      return finish({
        ok: false,
        summary: `Modules requis inactifs : ${inactive.join(', ')}.`,
      });
    }

    // Permission nodes : un deny explicite prime sur tout (même admin).
    if (await this.nodes.denies(ctx.guildId, name, ctx)) {
      return finish(
        {
          ok: false,
          summary: `Refusé : le staff a explicitement retiré l\u0027accès à cet outil pour toi (ou ton rôle).`,
        },
        ['node-deny'],
      );
    }

    const missing = permissionNamesPolicy.missing(ctx.permissions, tool.permissions ?? []);
    if (missing.length > 0) {
      // Un node allow peut autoriser sans les permissions Discord (couche staff).
      if (!(await this.nodes.allows(ctx.guildId, name, ctx))) {
        return finish(
          {
            ok: false,
            summary: `Permission Discord insuffisante : ${missing.join(' + ')} requise(s). Informe poliment l'utilisateur qu'il n'a pas le niveau d'accès nécessaire pour cette action.`,
          },
          missing,
        );
      }
    }

    const parsed = tool.paramsSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join('.') || 'input';
      return finish({
        ok: false,
        summary: `Paramètres invalides (${path}) : ${issue?.message ?? 'validation failed'}`,
      });
    }

    if (tool.destructive) {
      const refusal = await this.confirmation.refuseUnlessApproved(name, parsed.data as Record<string, unknown>, ctx, options.approvedBy);
      if (refusal) return finish(refusal);
    }

    // R3 : traçabilité fichier (diagnose.mjs consomme ces lignes).
    const startedAt = Date.now();
    const logFinish = (result: ToolResult): void => {
      fileLog()?.event(result.ok ? 'info' : 'warn', 'registry', 'tool.run', {
        tool: name,
        ok: result.ok,
        ms: Date.now() - startedAt,
        guildId: ctx.guildId,
      });
    };

    // Une exception du handler ne remonte JAMAIS à la boucle LLM : elle devient
    // un refus explicite que le modèle reformule pour l'utilisateur (le
    // « Missing Permissions » non rattrapé laissait la demande sans réponse).
    try {
      const result = await tool.handler(parsed.data, ctx);
      logFinish(result);
      return finish(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return finish({
        ok: false,
        summary: `Tool ${name} a échoué : ${message.slice(0, 180)}`,
      });
    }
  }
}
