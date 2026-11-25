import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { BotTool, ToolRunContext } from '@10cordes/shared';
import { ActionPlanService } from '../action-plan/action-plan.service';
import { bindActionPlans } from '../action-plan/action-plan.runtime';
import { PLAN_LIMITS } from '../action-plan/action-plan.types';
import { ToolRegistryService, bindRegistryRuntimeDeps } from './tool-registry.service';

/**
 * Porte de confirmation des actions (règle serveur « Confirmer les actions
 * (hors lecture) »), transposée de discord-agent : sous la règle, le modèle
 * ne fait que proposer ce qui modifie, l'action rejoint un plan, et seul le
 * plan approuvé par un clic (donc `approvedBy`, passé par le serveur)
 * traverse la porte. Lectures et outils directs ne la franchissent jamais.
 *
 * Le premier test court AVANT toute liaison du module de plans : il fixe le
 * comportement quand ce module n'est pas chargé.
 */

const GUILD = '1550000000000000001';
const CHANNEL = '1550000000000000002';
const USER = '1550000000000000003';

// Clés calculées : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';
/** Outil de test, absent de la classification : il compte pour une écriture (porte fermée). */
const UNKNOWN_TOOL = 'test.deleteThing';
/** Noms réels du registry, pour lire la classification comme en production. */
const READ_TOOL = 'getServerInfo';
const DIRECT_TOOL = 'translate';
/** Modifie, sans être signalé destructif : c'est la classification, pas le drapeau, qui décide. */
const WRITE_TOOL = 'renameChannel';

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
    [NAME]: UNKNOWN_TOOL,
    description: 'outil de test, non classé',
    category: 'test',
    paramsSchema: z.object({ target: z.string() }),
    requiredModules: [],
    permissions: [],
    destructive: true,
    handler,
  } as unknown as BotTool);
  const plans = new ActionPlanService(planPrisma as never, audit as never, { guilds: { cache: new Map() }, channels: { cache: new Map() } } as never, registry, { record: vi.fn() } as never);
  if (withPlans) bindActionPlans(plans);
  return { registry, handler, audit, rules, plans };
}

/** Inscrit un outil de test sous un nom réel du registry, avec son drapeau destructif. */
function registerAs(registry: ToolRegistryService, toolName: string, run: () => Promise<{ ok: boolean; summary: string }>, destructive = false): void {
  registry.register({
    [NAME]: toolName,
    description: `sonde ${toolName}`,
    category: 'test',
    paramsSchema: z.object({}),
    requiredModules: [],
    permissions: [],
    destructive,
    handler: run,
  } as unknown as BotTool);
}

const auditRows = (audit: { record: ReturnType<typeof vi.fn> }) => audit.record.mock.calls.map(([row]) => row as { action: string; metadata: Record<string, unknown> });

afterEach(() => {
  vi.clearAllMocks();
});

describe('ToolRegistryService · porte de confirmation des actions', () => {
  it('module de plans non chargé : règle active, l\u0027action reste bloquée, sans promesse de panneau', async () => {
    const { registry, handler, audit } = makeRegistry({ withPlans: false });
    const result = await registry.run(UNKNOWN_TOOL, { target: 'salon-a' }, ctxOf());
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('bloquée par la règle du serveur');
    expect(result.summary).toContain('impossible à afficher ici');
    expect(handler).not.toHaveBeenCalled();
    expect(auditRows(audit).find((row) => row.action === 'rule.confirm.shown')).toMatchObject({ metadata: { tool: UNKNOWN_TOOL, staged: false } });
  });

  it('règle active : chaque action qui modifie rejoint le plan de la demande, le handler ne tourne jamais', async () => {
    const { registry, handler, audit, plans } = makeRegistry();
    const first = await registry.run(UNKNOWN_TOOL, { target: 'salon-a' }, ctxOf());
    const second = await registry.run(UNKNOWN_TOOL, { target: 'salon-b' }, ctxOf());
    expect(first.summary).toContain(`Action (${UNKNOWN_TOOL}) bloquée par la règle du serveur`);
    expect(first.summary).toContain('1 action(s) en attente');
    expect(second.summary).toContain('2 action(s) en attente');
    expect(first.summary).toContain('toute action qui modifie attend l\u0027approbation');
    expect(second.summary).toContain('NE RETENTE PAS');
    expect(handler).not.toHaveBeenCalled();
    // Le plan en attente porte les deux actions, dans l'ordre, avec leurs paramètres.
    expect(await plans.flush(GUILD, USER)).toMatchObject({
      guildId: GUILD,
      requesterId: USER,
      actions: [
        { tool: UNKNOWN_TOOL, input: { target: 'salon-a' } },
        { tool: UNKNOWN_TOOL, input: { target: 'salon-b' } },
      ],
    });
    expect(auditRows(audit).filter((row) => row.action === 'rule.confirm.shown')).toEqual([
      expect.objectContaining({ metadata: { tool: UNKNOWN_TOOL, staged: true } }),
      expect.objectContaining({ metadata: { tool: UNKNOWN_TOOL, staged: true } }),
    ]);
  });

  it('seule une exécution venant d\u0027un plan approuvé traverse : jamais le modèle seul', async () => {
    const { registry, handler, audit } = makeRegistry();
    const alone = await registry.run(UNKNOWN_TOOL, { target: 'salon-a' }, ctxOf());
    expect(alone.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    const approved = await registry.run(UNKNOWN_TOOL, { target: 'salon-a' }, ctxOf(), { approvedBy: 'plan-1' });
    expect(approved).toEqual({ ok: true, summary: 'fait' });
    expect(handler).toHaveBeenCalledTimes(1);
    const audited = auditRows(audit).filter((row) => row.action === `tool.${UNKNOWN_TOOL}`);
    expect(audited.map((row) => row.metadata.approvedBy)).toEqual([undefined, 'plan-1']);
  });

  it('ce qu\u0027une exécution approuvée déclenche elle-même reste autorisé', async () => {
    const { registry, plans } = makeRegistry();
    const inner = vi.fn(async () => ({ ok: true, summary: 'planifié' }));
    registerAs(registry, WRITE_TOOL, inner);
    const outer = vi.fn(async (_input: unknown, ctx: ToolRunContext) => registry.run(WRITE_TOOL, {}, ctx));
    registerAs(registry, UNKNOWN_TOOL, outer as never, true);
    const result = await registry.run(UNKNOWN_TOOL, {}, ctxOf(), { approvedBy: 'plan-1' });
    expect(result.ok).toBe(true);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(await plans.flush(GUILD, USER)).toBeNull();
  });

  it('règle désactivée : exécution directe, rien de mis en attente', async () => {
    const { registry, handler, plans } = makeRegistry({ confirm: false });
    expect(await registry.run(UNKNOWN_TOOL, { target: 'salon-a' }, ctxOf())).toEqual({ ok: true, summary: 'fait' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await plans.flush(GUILD, USER)).toBeNull();
  });

  it('règles du serveur illisibles (dépendance non liée) : la porte reste fermée', async () => {
    const { registry, handler } = makeRegistry();
    bindRegistryRuntimeDeps({ rules: undefined });
    const result = await registry.run(UNKNOWN_TOOL, { target: 'salon-a' }, ctxOf());
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('bloquée par la règle du serveur');
    expect(handler).not.toHaveBeenCalled();
  });

  it('hors salon (demande sans canal) : refusé, sans promettre un panneau', async () => {
    const { registry, handler, plans } = makeRegistry();
    const result = await registry.run(UNKNOWN_TOOL, { target: 'salon-a' }, ctxOf({ channelId: null }));
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('impossible à afficher ici');
    expect(handler).not.toHaveBeenCalled();
    expect(await plans.flush(GUILD, USER)).toBeNull();
  });

  it('le plan est plein au-delà de 10 actions : la suivante est refusée et rien n\u0027est ajouté', async () => {
    const { registry, plans } = makeRegistry();
    for (let index = 0; index < PLAN_LIMITS.maxActions; index += 1) await registry.run(UNKNOWN_TOOL, { target: `salon-${index}` }, ctxOf());
    const overflow = await registry.run(UNKNOWN_TOOL, { target: 'salon-de-trop' }, ctxOf());
    expect(overflow.summary).toContain('plein (10 actions)');
    expect((await plans.flush(GUILD, USER))?.actions).toHaveLength(PLAN_LIMITS.maxActions);
  });
});

describe('ToolRegistryService · la classification décide, pas le drapeau destructif', () => {
  it('règle active : une lecture et un outil direct s\u0027exécutent sans attendre, un outil qui modifie (non signalé destructif) attend', async () => {
    const { registry, plans } = makeRegistry();
    const read = vi.fn(async () => ({ ok: true, summary: 'lu' }));
    const direct = vi.fn(async () => ({ ok: true, summary: 'traduit' }));
    const write = vi.fn(async () => ({ ok: true, summary: 'renommé' }));
    registerAs(registry, READ_TOOL, read);
    registerAs(registry, DIRECT_TOOL, direct);
    registerAs(registry, WRITE_TOOL, write);

    expect(await registry.run(READ_TOOL, {}, ctxOf())).toEqual({ ok: true, summary: 'lu' });
    expect(await registry.run(DIRECT_TOOL, {}, ctxOf())).toEqual({ ok: true, summary: 'traduit' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(direct).toHaveBeenCalledTimes(1);

    const held = await registry.run(WRITE_TOOL, {}, ctxOf());
    expect(held.ok).toBe(false);
    expect(held.summary).toContain(`Action (${WRITE_TOOL}) bloquée par la règle du serveur`);
    expect(write).not.toHaveBeenCalled();
    expect(await plans.flush(GUILD, USER)).toMatchObject({ actions: [{ tool: WRITE_TOOL, input: {} }] });
  });

  it('règle désactivée : ce même outil s\u0027exécute directement', async () => {
    const { registry, plans } = makeRegistry({ confirm: false });
    const write = vi.fn(async () => ({ ok: true, summary: 'renommé' }));
    registerAs(registry, WRITE_TOOL, write);
    expect(await registry.run(WRITE_TOOL, {}, ctxOf())).toEqual({ ok: true, summary: 'renommé' });
    expect(await plans.flush(GUILD, USER)).toBeNull();
  });

  it('l\u0027autorisation portée par le contexte (clic sur une surface, tâche du système) traverse la porte, et l\u0027audit la garde', async () => {
    const { registry, plans, audit } = makeRegistry();
    const run = vi.fn(async () => ({ ok: true, summary: 'renommé' }));
    registerAs(registry, WRITE_TOOL, run);
    for (const origin of ['surface', 'system']) {
      expect(await registry.run(WRITE_TOOL, {}, ctxOf({ approvedBy: origin }))).toEqual({ ok: true, summary: 'renommé' });
    }
    expect(run).toHaveBeenCalledTimes(2);
    expect(await plans.flush(GUILD, USER)).toBeNull();
    expect(auditRows(audit).filter((row) => row.action === `tool.${WRITE_TOOL}`).map((row) => row.metadata.approvedBy)).toEqual(['surface', 'system']);
  });

  it('un outil signalé destructif que la classification ne dit pas « écriture » est refusé à l\u0027enregistrement', () => {
    const { registry } = makeRegistry();
    const register = (toolName: string): void => registerAs(registry, toolName, async () => ({ ok: true, summary: 'x' }), true);
    expect(() => register(READ_TOOL)).toThrow(`Outil « ${READ_TOOL} » signalé destructif mais classé « read »`);
    expect(() => register(DIRECT_TOOL)).toThrow('classé « direct »');
    expect(() => register(WRITE_TOOL)).not.toThrow();
    expect(() => register(UNKNOWN_TOOL)).not.toThrow();
  });
});
