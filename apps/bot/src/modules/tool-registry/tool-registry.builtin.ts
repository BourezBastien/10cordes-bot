import type { BotTool, ToolRunContext } from '@10cordes/shared';
import { z } from 'zod';
import type { GuildConfigService } from '../guild-config/guild-config.service';
import type { ModuleManagerService } from '../module-manager/module-manager.service';
import { permissionNamesPolicy } from '../../core/security/permission-names.policy';
import { setPath } from '../../shared/utils/object';

/** Ce que les tools système demandent au registry : le catalogue seul. */
export interface ToolCatalog {
  list(): BotTool[];
}

export interface BuiltinToolsDeps {
  readonly registry: ToolCatalog;
  readonly modules: ModuleManagerService;
  readonly configService: GuildConfigService;
}

const guildOnly = (ctx: ToolRunContext): ctx is ToolRunContext & { guildId: string } => ctx.guildId !== null;

const GUILD_REQUIRED = 'Guild context required.';

/** Tool search_tools : élargit le toolset actif (routage façon Anthropic). */
function searchToolsTool(registry: ToolCatalog): BotTool {
  return {
    name: 'search_tools',
    description:
      'Search the tool catalog by keywords: returns the matching tools (name, description, usage guidance). The tools found become CALLABLE in your next steps; call this whenever the current request needs a tool that is not in your active toolset.',
    category: 'tool-registry',
    paramsSchema: z.object({
      query: z.string().min(2).max(120).describe('Keywords of the capability you need (ex: "transcript html", "vocal move member")'),
      limit: z.number().int().min(1).max(15).default(8).optional(),
    }),
    requiredModules: [],
    permissions: [],
    destructive: false,
    systemPrompt:
      'Tool routing (Anthropic pattern): your active toolset is intentionally SMALL. When a request needs a capability you do not have, search_tools FIRST, read the guidance of the tools found, then call the right one directly.',
    handler: async (input) => {
      const { query, limit } = input as { query: string; limit?: number };
      const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
      const scored = registry
        .list()
        .map((tool) => {
          const haystack = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
          const score = words.reduce((sum, word) => sum + (haystack.includes(word) ? 1 : 0), 0);
          return { tool, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit ?? 8);
      if (scored.length === 0) {
        return { ok: true, summary: `Aucun tool ne correspond à « ${query} » : cette capacité n'existe pas. Dis-le honnêtement à l'utilisateur.`, data: { tools: [] } };
      }
      const cards = scored.map(({ tool }) => ({
        name: tool.name,
        description: tool.description.slice(0, 220),
        category: tool.category,
        guidance: tool.systemPrompt?.slice(0, 400) ?? null,
        destructive: tool.destructive ?? false,
      }));
      const lines = cards.map((card) => `- **${card.name}** (${card.category})${card.destructive ? ' [destructif]' : ''} : ${card.description}${card.guidance ? ` | Consigne : ${card.guidance}` : ''}`);
      return {
        ok: true,
        summary: `${cards.length} tool(s) trouvé(s), désormais appelables :\n${lines.join('\n')}`,
        data: { tools: cards },
      };
    },
  };
}

/** Tool getAvailableTools : ce que l'APPELANT peut utiliser maintenant. */
function availableToolsTool(deps: BuiltinToolsDeps): BotTool {
  return {
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
      const active = await deps.modules.activeModules(ctx.guildId);
      const usable = deps.registry
        .list()
        .filter((tool) => tool.requiredModules.every((id) => active.has(id)))
        .filter((tool) => permissionNamesPolicy.hasAll(ctx.permissions, tool.permissions ?? []));
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
  };
}

/** Tools de gestion des modules (lecture, activation, désactivation avec cascade). */
function moduleTools(modules: ModuleManagerService): BotTool[] {
  return [
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
        if (!guildOnly(ctx)) return { ok: false, summary: GUILD_REQUIRED };
        const { moduleId } = input as { moduleId: string };
        const enabled = await modules.enableModule(ctx.guildId, moduleId);
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
        if (!guildOnly(ctx)) return { ok: false, summary: GUILD_REQUIRED };
        const { moduleId, confirm } = input as { moduleId: string; confirm: boolean };
        const result = await modules.disableModule(ctx.guildId, moduleId, confirm);
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
  ];
}

/** Tools de configuration serveur (lecture, écriture par chemin pointé). */
function configTools(configService: GuildConfigService): BotTool[] {
  return [
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
        if (!guildOnly(ctx)) return { ok: false, summary: GUILD_REQUIRED };
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
        if (!guildOnly(ctx)) return { ok: false, summary: GUILD_REQUIRED };
        const { path, value } = input as { path: string; value: unknown };
        const config = await configService.patch(ctx.guildId, setPath(path, value));
        return { ok: true, summary: `Config \`${path}\` updated.`, data: { config } };
      },
    },
  ];
}

/** Tools système builtin : les modules en ajoutent d'autres via `register()`. */
export function buildBuiltinTools(deps: BuiltinToolsDeps): BotTool[] {
  return [searchToolsTool(deps.registry), availableToolsTool(deps), ...moduleTools(deps.modules), ...configTools(deps.configService)];
}
