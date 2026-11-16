import { Injectable } from '@spraxium/common';
import type { BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import { z } from 'zod';
import { setPath } from '../../shared/utils/object';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { ModuleManagerService } from '../module-manager/module-manager.service';
import { AuditService } from '../audit/audit.service';

let registryInstance: ToolRegistryService | undefined;

/** Accès runtime au registry pour les contextes sans DI (guards, layouts, calls externes). */
export function getToolRegistry(): ToolRegistryService {
  if (!registryInstance) throw new Error('ToolRegistryService is not initialized yet.');
  return registryInstance;
}

/**
 * Registry central des tools (0.10) — contrat `BotTool` dans @10cordes/shared.
 * Chaque module enregistre ses tools ici (`register()`) ; les frontends
 * (assistant chat, vocal, dashboard, MCP over HTTP) consomment ce même registry.
 */
@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, BotTool>();

  constructor(
    private readonly modules: ModuleManagerService,
    private readonly configService: GuildConfigService,
    private readonly audit: AuditService,
  ) {
    registryInstance = this;
    for (const tool of builtinTools(this, modules, configService, audit)) this.register(tool);
  }

  register(tool: BotTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): BotTool | undefined {
    return this.tools.get(name);
  }

  list(): BotTool[] {
    return [...this.tools.values()];
  }

  /** Tools exécutables sur ce serveur : uniquement ceux dont les modules sont actifs. */
  async listForGuild(guildId: string | null): Promise<BotTool[]> {
    const active = await this.modules.activeModules(guildId);
    return this.list().filter((tool) => tool.requiredModules.every((id) => active.has(id)));
  }

  /** Vérifie les permissions Discord de l'appelant contre un tool ("Administrator" bypass). */
  private missingPermissions(tool: BotTool, ctx: ToolRunContext): string[] {
    const required = tool.permissions ?? [];
    if (required.length === 0 || ctx.permissions.includes('Administrator')) return [];
    return required.filter((permission) => !ctx.permissions.includes(permission));
  }

  /** Exécution : gates de modules + permissions → validation Zod → handler → audit. */
  async run(name: string, input: unknown, ctx: ToolRunContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, summary: `Unknown tool \`${name}\`.` };

    const audited = tool.destructive || tool.name.startsWith('config.');
    const finish = (result: ToolResult, deniedPermission?: string[]): ToolResult => {
      if (audited) {
        this.audit.record({
          guildId: ctx.guildId,
          source: 'agent',
          action: deniedPermission ? `tool.denied.${name}` : `tool.${name}`,
          actorId: ctx.userId,
          metadata: deniedPermission
            ? { missing: deniedPermission }
            : { ok: result.ok, input: (input as Record<string, unknown>) ?? {} },
        });
      }
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

    const missing = this.missingPermissions(tool, ctx);
    if (missing.length > 0) {
      return finish(
        {
          ok: false,
          summary: `Permission Discord insuffisante : ${missing.join(' + ')} requise(s). Informe poliment l'utilisateur qu'il n'a pas le niveau d'accès nécessaire pour cette action.`,
        },
        missing,
      );
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

    const result = await tool.handler(parsed.data, ctx);
    return finish(result);
  }
}

/** Tools système builtin — les modules en ajoutent d'autres via `register()`. */
function builtinTools(
  registry: ToolRegistryService,
  modules: ModuleManagerService,
  configService: GuildConfigService,
  audit: AuditService,
): BotTool[] {
  void audit;
  const guildOnly = (ctx: ToolRunContext): ctx is ToolRunContext & { guildId: string } =>
    ctx.guildId !== null;

  return [
    {
      name: 'getAvailableTools',
      description: 'List the tools the CALLER can use right now, filtered by their Discord permissions and active modules.',
      category: 'tool-registry',
      paramsSchema: z.object({}).loose(),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt:
        'Call when the user asks what you can do. Summarize by category; the registry already excluded what the user cannot use.',
      handler: async (_input, ctx) => {
        const active = await modules.activeModules(ctx.guildId);
        const isAdmin = ctx.permissions.includes('Administrator');
        const usable = registry
          .list()
          .filter((tool) => tool.requiredModules.every((id) => active.has(id)))
          .filter(
            (tool) => isAdmin || (tool.permissions ?? []).every((permission) => ctx.permissions.includes(permission)),
          );
        const byCategory = new Map<string, string[]>();
        for (const tool of usable) {
          const names = byCategory.get(tool.category) ?? [];
          names.push(`\`${tool.name}\``);
          byCategory.set(tool.category, names);
        }
        const lines = [...byCategory.entries()].map(([category, names]) => `**${category}** : ${names.join(' ')}`);
        const cards = usable.map((tool) => ({
          name: tool.name,
          description: tool.description.slice(0, 90),
          category: tool.category,
        }));
        return {
          ok: true,
          summary: `${usable.length} tools accessibles à cet utilisateur. ${lines.join(' · ')}`,
          data: { count: usable.length, byCategory: Object.fromEntries(byCategory), tools: cards },
        };
      },
    },
    {
      name: 'getModules',
      description: 'List modules and their enabled state (global + per-server).',
      category: 'module-manager',
      paramsSchema: z.object({}).loose(),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Read-only. Call before any module toggle to know current states.',
      handler: async (_input, ctx) => {
        const list = await modules.listModules(ctx.guildId);
        const summary =
          list.map((m) => `${m.id}=${m.guildEnabled === false || !m.globalEnabled ? 'off' : 'on'}`).join(', ') || 'none';
        return { ok: true, summary, data: { modules: list } };
      },
    },
    {
      name: 'enableModule',
      description: 'Enable a module (dependencies auto-enabled).',
      category: 'module-manager',
      paramsSchema: z.object({ moduleId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Mutating but reversible. Check modules.list first; dependencies are enabled automatically.',
      handler: async (input, ctx) => {
        if (!guildOnly(ctx)) return { ok: false, summary: 'Guild context required.' };
        const { moduleId } = input as { moduleId: string };
        const enabled = await modules.enableModule('guild', ctx.guildId, moduleId);
        return { ok: true, summary: `Enabled: ${enabled.join(', ')}.` };
      },
    },
    {
      name: 'disableModule',
      description: 'Disable a module, returns the dependency cascade to confirm.',
      category: 'module-manager',
      paramsSchema: z.object({ moduleId: z.string().min(1), confirm: z.boolean().default(false) }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: true,
      systemPrompt:
        'Destructive. First call with confirm=false returns the cascade; show it to the user, then re-run with confirm=true only after explicit approval.',
      handler: async (input, ctx) => {
        if (!guildOnly(ctx)) return { ok: false, summary: 'Guild context required.' };
        const { moduleId, confirm } = input as { moduleId: string; confirm: boolean };
        const result = await modules.disableModule('guild', ctx.guildId, moduleId, confirm);
        if (!result.applied && result.cascade) {
          return {
            ok: false,
            summary: `Cascade required, would also disable: ${result.cascade.toDisable.join(', ') || 'none'}${result.cascade.kept.length > 0 ? `; kept: ${result.cascade.kept.join(', ')}` : ''}. Ask the user to confirm.`,
            data: { cascade: result.cascade },
          };
        }
        return { ok: result.applied, summary: result.applied ? `Disabled: ${result.disabled.join(', ')}.` : 'Already disabled.' };
      },
    },
    {
      name: 'getConfig',
      description: 'Read the full guild configuration document.',
      category: 'guild-config',
      paramsSchema: z.object({}).loose(),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Read-only. Use before any config mutation.',
      handler: async (_input, ctx) => {
        if (!guildOnly(ctx)) return { ok: false, summary: 'Guild context required.' };
        const config = await configService.get(ctx.guildId);
        return { ok: true, summary: 'Configuration retrieved.', data: { config } };
      },
    },
    {
      name: 'setConfigValue',
      description: 'Set a config value by dotted path (see CONFIG_KEYS registry).',
      category: 'guild-config',
      paramsSchema: z.object({ path: z.string().min(1), value: z.unknown() }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'Mutating but reversible. Only dotted paths from the CONFIG_KEYS registry are valid; booleans are true/false, numbers plain digits.',
      handler: async (input, ctx) => {
        if (!guildOnly(ctx)) return { ok: false, summary: 'Guild context required.' };
        const { path, value } = input as { path: string; value: unknown };
        const config = await configService.patch(ctx.guildId, setPath(path, value));
        return { ok: true, summary: `Config \`${path}\` updated.`, data: { config } };
      },
    },
  ];
}
