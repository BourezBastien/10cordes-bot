import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { BotTool, ToolRunContext } from '@10cordes/shared';
import { ActionPlanService } from '../action-plan/action-plan.service';
import { bindActionPlans } from '../action-plan/action-plan.runtime';
import { PLAN_LIMITS } from '../action-plan/action-plan.types';
import { ToolRegistryService, bindRegistryRuntimeDeps } from './tool-registry.service';

/**
 * Porte de confirmation des actions destructives (règle serveur
 * confirmDestructiveActions), transposée de discord-agent : le modèle ne
 * fait que proposer, l'action rejoint un plan, et seul le plan approuvé par
 * un clic (donc `approvedBy`, passé par le serveur) traverse la porte.
 *
 * Le premier test court AVANT toute liaison du module de plans : il fixe le
 * comportement quand ce module n'est pas chargé.
 */

const GUILD = '1550000000000000001';
const CHANNEL = '1550000000000000002';
const USER = '1550000000000000003';

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';
const DESTRUCTIVE_TOOL = 'test.deleteThing';
const CALM_TOOL = 'test.readThing';

const ctxOf = (overrides: Partial<ToolRunContext> = {}): ToolRunContext => ({
  guildId: GUILD,
  channelId: CHANNEL,
  userId: USER,
  locale: 'fr',
  permissions: [],
  reply: async () => undefined,
  ...overrides,
});

function makeRegistry({ confirm = true, withPlans = true }: { confirm?: boolean; withPlans?: boolean } = {}) {
  const handler = vi.fn(async () => ({ ok: true, summary: 'fait' }));
  const audit = { record: vi.fn() };
  const prisma = { toolNode: { findMany: vi.fn().mockResolvedValue([]) } };
  const rules = { get: vi.fn(async () => ({ confirmDestructiveActions: confirm })) };
  /** Plans en mémoire : ce que le module de plans garde entre deux appels. */
  const plansStored = new Map<string, { id: string; guildId: string; channelId: string; messageId: string | null; state: string }>();
  const planPrisma = {
    interactiveSurface: {
      create: vi.fn(async ({ data }: { data: { state: string } }) => {
        const id = `plan-${plansStored.size + 1}`;
        plansStored.set(id, { id, guildId: GUILD, channelId: CHANNEL, messageId: null, state: data.state });
        return { id };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => plansStored.get(where.id) ?? null),
      update: vi.fn(async () => ({ id: 'plan' })),
      findMany: vi.fn(async () => []),
    },
  };
  const registry = new ToolRegistryService(
    { activeModules: async () => new Set<string>() } as never,
    {} as never,
    audit as never,
    prisma as never,
  );
  bindRegistryRuntimeDeps({ rules: rules as never });
  registry.register({
    [NAME]: DESTRUCTIVE_TOOL,
    description: 'tool destructif de test',
    category: 'test',
    paramsSchema: z.object({ target: z.string() }),
    requiredModules: [],
    permissions: [],
    destructive: true,
    handler,
  } as unknown as BotTool);
  const plans = new ActionPlanService(planPrisma as never, audit as never, {} as never, registry);
  if (withPlans) bindActionPlans(plans);
  return { registry, handler, audit, rules, plans };
}

const auditRows = (audit: { record: ReturnType<typeof vi.fn> }) => audit.record.mock.calls.map(([row]) => row as { action: string; metadata: Record<string, unknown> });

afterEach(() => {
  vi.clearAllMocks();
});

describe('ToolRegistryService · porte de confirmation destructive', () => {
  it('module de plans non chargé : règle active, l\u0027action reste bloquée, sans promesse de panneau', async () => {
    const { registry, handler, audit } = makeRegistry({ withPlans: false });
    const result = await registry.run(DESTRUCTIVE_TOOL, { target: 'salon-a' }, ctxOf());
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('bloquée par la règle du serveur');
    expect(result.summary).toContain('impossible à afficher ici');
    expect(handler).not.toHaveBeenCalled();
    expect(auditRows(audit).find((row) => row.action === 'rule.confirm.shown')).toMatchObject({ metadata: { tool: DESTRUCTIVE_TOOL, staged: false } });
  });

  it('règle active : chaque action destructive rejoint le plan de la demande, le handler ne tourne jamais', async () => {
    const { registry, handler, audit, plans } = makeRegistry();
    const first = await registry.run(DESTRUCTIVE_TOOL, { target: 'salon-a' }, ctxOf());
    const second = await registry.run(DESTRUCTIVE_TOOL, { target: 'salon-b' }, ctxOf());
    expect(first.summary).toContain(`${DESTRUCTIVE_TOOL}) bloquée par la règle du serveur`);
    expect(first.summary).toContain('1 action(s) en attente');
    expect(second.summary).toContain('2 action(s) en attente');
    expect(second.summary).toContain('NE RETENTE PAS');
    expect(handler).not.toHaveBeenCalled();
    // Le plan en attente porte les deux actions, dans l'ordre, avec leurs paramètres.
    expect(await plans.flush(GUILD, USER)).toMatchObject({
      guildId: GUILD,
      requesterId: USER,
      actions: [
        { tool: DESTRUCTIVE_TOOL, input: { target: 'salon-a' } },
        { tool: DESTRUCTIVE_TOOL, input: { target: 'salon-b' } },
      ],
    });
    expect(auditRows(audit).filter((row) => row.action === 'rule.confirm.shown')).toEqual([
      expect.objectContaining({ metadata: { tool: DESTRUCTIVE_TOOL, staged: true } }),
      expect.objectContaining({ metadata: { tool: DESTRUCTIVE_TOOL, staged: true } }),
    ]);
  });

  it('seule une exécution venant d\u0027un plan approuvé traverse : jamais le modèle seul', async () => {
    const { registry, handler, audit } = makeRegistry();
    const alone = await registry.run(DESTRUCTIVE_TOOL, { target: 'salon-a' }, ctxOf());
    expect(alone.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    const approved = await registry.run(DESTRUCTIVE_TOOL, { target: 'salon-a' }, ctxOf(), { approvedBy: 'plan-1' });
    expect(approved).toEqual({ ok: true, summary: 'fait' });
    expect(handler).toHaveBeenCalledTimes(1);
    const audited = auditRows(audit).filter((row) => row.action === `tool.${DESTRUCTIVE_TOOL}`);
    expect(audited.map((row) => row.metadata.approvedBy)).toEqual([undefined, 'plan-1']);
  });

  it('règle désactivée : exécution directe, rien de mis en attente', async () => {
    const { registry, handler, plans } = makeRegistry({ confirm: false });
    expect(await registry.run(DESTRUCTIVE_TOOL, { target: 'salon-a' }, ctxOf())).toEqual({ ok: true, summary: 'fait' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await plans.flush(GUILD, USER)).toBeNull();
  });

  it('règles du serveur illisibles (dépendance non liée) : la porte reste fermée', async () => {
    const { registry, handler } = makeRegistry();
    bindRegistryRuntimeDeps({ rules: undefined });
    const result = await registry.run(DESTRUCTIVE_TOOL, { target: 'salon-a' }, ctxOf());
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('bloquée par la règle du serveur');
    expect(handler).not.toHaveBeenCalled();
  });

  it('hors salon (demande sans canal) : refusé, sans promettre un panneau', async () => {
    const { registry, handler, plans } = makeRegistry();
    const result = await registry.run(DESTRUCTIVE_TOOL, { target: 'salon-a' }, ctxOf({ channelId: null }));
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('impossible à afficher ici');
    expect(handler).not.toHaveBeenCalled();
    expect(await plans.flush(GUILD, USER)).toBeNull();
  });

  it('le plan est plein au-delà de 10 actions : la suivante est refusée et rien n\u0027est ajouté', async () => {
    const { registry, plans } = makeRegistry();
    for (let index = 0; index < PLAN_LIMITS.maxActions; index += 1) await registry.run(DESTRUCTIVE_TOOL, { target: `salon-${index}` }, ctxOf());
    const overflow = await registry.run(DESTRUCTIVE_TOOL, { target: 'salon-de-trop' }, ctxOf());
    expect(overflow.summary).toContain('plein (10 actions)');
    expect((await plans.flush(GUILD, USER))?.actions).toHaveLength(PLAN_LIMITS.maxActions);
  });

  it('un tool non destructif ne demande jamais confirmation', async () => {
    const { registry, plans } = makeRegistry();
    const calm = vi.fn(async () => ({ ok: true, summary: 'lu' }));
    registry.register({
      [NAME]: CALM_TOOL,
      description: 'tool lecture',
      category: 'test',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: [],
      destructive: false,
      handler: calm,
    } as unknown as BotTool);
    expect(await registry.run(CALM_TOOL, {}, ctxOf())).toEqual({ ok: true, summary: 'lu' });
    expect(calm).toHaveBeenCalledTimes(1);
    expect(await plans.flush(GUILD, USER)).toBeNull();
  });
});
