import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { BotTool, ToolRunContext } from '@10cordes/shared';
import { ToolRegistryService, bindRegistryRuntimeDeps } from './tool-registry.service';

/**
 * Porte de confirmation des actions destructives (règle serveur
 * confirmDestructiveActions). Ces liaisons runtime vivaient dans des classes
 * de MODULE, que le framework n'instancie jamais : la porte n'a donc été
 * franchie (côté blocage) par aucun appel réel depuis l'origine.
 */

const GUILD = '1550000000000000001';
const CHANNEL = '1550000000000000002';
const USER = '1550000000000000003';

// Noms via constantes : sync-tool-names.mjs scanne les littéraux de nom de tool
// (clé name suivie d'une chaîne) pour générer le registre. Un tool factice de
// test ne doit pas s'y retrouver.
const DESTRUCTIVE_TOOL = 'test.deleteThing';
const CALM_TOOL = 'test.readThing';

function makeRegistry({ confirm = true } = {}) {
  /** Clés d'accord posées par le clic ✅ (SurfaceService les écrit dans le cache). */
  const approved = new Map<string, string>();
  const handler = vi.fn(async () => ({ ok: true, summary: 'fait' }));
  const audit = { record: vi.fn() };
  const prisma = {
    toolNode: { findMany: vi.fn().mockResolvedValue([]) },
    interactiveSurface: { create: vi.fn().mockResolvedValue({ id: 'surface-confirm' }) },
  };
  const cache = {
    active: {
      get: vi.fn(async (key: string) => approved.get(key) ?? null),
      set: vi.fn(async () => undefined),
    },
  };
  const rules = { get: vi.fn(async () => ({ confirmDestructiveActions: confirm })) };
  const renderSurface = vi.fn(async () => undefined);

  const registry = new ToolRegistryService(
    { activeModules: async () => new Set<string>() } as never,
    {} as never,
    audit as never,
    prisma as never,
    {} as never,
    cache as never,
  );
  // onBoot lie cache/prisma/rendu ; les règles arrivent par GuildRulesService.onBoot.
  registry.onBoot();
  bindRegistryRuntimeDeps({ rules: rules as never, renderSurface });

  const destructiveTool: BotTool = {
    name: DESTRUCTIVE_TOOL,
    description: 'tool destructif de test',
    category: 'test',
    paramsSchema: z.object({ target: z.string() }),
    requiredModules: [],
    permissions: [],
    destructive: true,
    handler,
  };
  registry.register(destructiveTool);

  const ctx: ToolRunContext = { guildId: GUILD, channelId: CHANNEL, userId: USER, locale: 'fr', permissions: [], reply: async () => undefined };
  return { registry, handler, audit, prisma, rules, renderSurface, approved, ctx, destructiveTool };
}

const createdSurfaces = (prisma: { interactiveSurface: { create: ReturnType<typeof vi.fn> } }) =>
  prisma.interactiveSurface.create.mock.calls.map(([args]) => args.data as { kind: string; channelId: string; state: string });

describe('ToolRegistryService · dépendances runtime', () => {
  it('onBoot lie cache, prisma et rendu ; les règles arrivent séparément', () => {
    const { registry } = makeRegistry();
    // État juste après le boot du registry, AVANT GuildRulesService.onBoot.
    bindRegistryRuntimeDeps({ rules: undefined });
    expect(ToolRegistryService.runtimeDepsReady()).toEqual({ cache: true, prisma: true, renderSurface: true, rules: false });
    registry.onBoot();
    bindRegistryRuntimeDeps({ rules: { get: async () => ({ confirmDestructiveActions: false }) } as never });
    expect(ToolRegistryService.runtimeDepsReady()).toEqual({ cache: true, prisma: true, renderSurface: true, rules: true });
  });
});

describe('ToolRegistryService · confirmation destructive', () => {
  it('règle activée, sans accord : bloque l\u0027action et poste une surface de confirmation', async () => {
    const { registry, handler, audit, prisma, renderSurface, ctx } = makeRegistry();

    const result = await registry.run('test.deleteThing', { target: 'salon-a' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('Action destructive (test.deleteThing) bloquée');
    expect(handler).not.toHaveBeenCalled();
    expect(renderSurface).toHaveBeenCalledWith('surface-confirm');
    const [surface] = createdSurfaces(prisma);
    expect(surface.kind).toBe('confirm');
    expect(surface.channelId).toBe(CHANNEL);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'rule.confirm.shown', metadata: { tool: 'test.deleteThing', posted: true } }));
  });

  it('après le clic ✅ (clé d\u0027accord posée), la même action passe', async () => {
    const { registry, handler, prisma, approved, ctx } = makeRegistry();
    await registry.run('test.deleteThing', { target: 'salon-a' }, ctx);

    // Le clic ✅ lit la clé dans l\u0027état de la surface et la pose dans le cache.
    const { confirmKey } = JSON.parse(createdSurfaces(prisma)[0].state) as { confirmKey: string };
    approved.set(confirmKey, 'ok');

    const result = await registry.run('test.deleteThing', { target: 'salon-a' }, ctx);
    expect(result).toEqual({ ok: true, summary: 'fait' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(createdSurfaces(prisma)).toHaveLength(1);
  });

  it('l\u0027accord est lié à l\u0027action exacte : une autre cible reste bloquée', async () => {
    const { registry, handler, prisma, approved, ctx } = makeRegistry();
    await registry.run('test.deleteThing', { target: 'salon-a' }, ctx);
    const { confirmKey } = JSON.parse(createdSurfaces(prisma)[0].state) as { confirmKey: string };
    approved.set(confirmKey, 'ok');

    const result = await registry.run('test.deleteThing', { target: 'salon-b' }, ctx);

    expect(result.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(createdSurfaces(prisma)).toHaveLength(2);
  });

  it('règle désactivée sur le serveur : exécution directe, aucune surface', async () => {
    const { registry, handler, prisma, ctx } = makeRegistry({ confirm: false });

    const result = await registry.run('test.deleteThing', { target: 'salon-a' }, ctx);

    expect(result).toEqual({ ok: true, summary: 'fait' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(createdSurfaces(prisma)).toHaveLength(0);
  });

  it('échec d\u0027affichage de la surface : l\u0027action reste bloquée (fail-closed)', async () => {
    const { registry, handler, prisma, renderSurface, ctx } = makeRegistry();
    renderSurface.mockRejectedValueOnce(new Error('salon supprimé'));

    const result = await registry.run('test.deleteThing', { target: 'salon-a' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('impossible à afficher');
    expect(handler).not.toHaveBeenCalled();
  });

  it('un tool non destructif ne demande jamais confirmation', async () => {
    const { registry, prisma, ctx } = makeRegistry();
    const calm = vi.fn(async () => ({ ok: true, summary: 'lu' }));
    registry.register({
      name: CALM_TOOL,
      description: 'tool lecture',
      category: 'test',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: [],
      destructive: false,
      handler: calm,
    });

    const result = await registry.run('test.readThing', {}, ctx);

    expect(result).toEqual({ ok: true, summary: 'lu' });
    expect(calm).toHaveBeenCalledTimes(1);
    expect(createdSurfaces(prisma)).toHaveLength(0);
  });
});
