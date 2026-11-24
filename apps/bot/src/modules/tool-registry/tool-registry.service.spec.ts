import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { BotTool, ToolRunContext } from '@10cordes/shared';
import { setFileLog, type FileLogService } from '../logging/file-log.service';
import { bindRegistryRuntimeDeps, ToolRegistryService } from './tool-registry.service';

/**
 * Traçabilité du registry : chaque appel est audité avec la référence de la
 * demande quand l'appelant en a posé une, et une exception du handler laisse
 * dans le journal la nature de l'erreur et sa pile, tronquée (le modèle, lui,
 * ne reçoit qu'un refus explicite).
 */

const GUILD = '1550000000000000001';
const USER = '1550000000000000002';

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';
const PROBE = 'probe.trace';

function harness() {
  const audit = { record: vi.fn() };
  const events: Array<{ level: string; event: string; data: Record<string, unknown> | undefined }> = [];
  const log: Pick<FileLogService, 'event' | 'llm'> = {
    event: (level, _ctx, event, data) => {
      events.push({ level, event, data });
    },
    llm: vi.fn(),
  };
  setFileLog(log as FileLogService);
  // Règle de confirmation désactivée, comme sur un serveur qui ne l'a pas activée (sinon la porte reste fermée).
  bindRegistryRuntimeDeps({ rules: { get: async () => ({ confirmDestructiveActions: false }) } as never });
  const service = new ToolRegistryService({ activeModules: async () => new Set<string>() } as never, {} as never, audit as never, {
    toolNode: { findMany: async () => [] },
  } as never);
  const register = (handler: BotTool['handler'], paramsSchema: z.ZodType = z.object({})): void => {
    service.register({ [NAME]: PROBE, description: 'sonde', category: 'test', paramsSchema, requiredModules: [], destructive: false, handler });
  };
  const run = (input: unknown = {}, requestId?: string) =>
    service.run(PROBE, input, { guildId: GUILD, userId: USER, locale: 'fr', permissions: [], reply: async () => undefined, ...(requestId ? { requestId } : {}) } as ToolRunContext);
  const audits = (): Array<{ action: string; metadata: Record<string, unknown> }> => audit.record.mock.calls.map((call) => call[0]);
  const logged = (event: string): Record<string, unknown> | undefined => events.find((entry) => entry.event === event)?.data;
  return { events, register, run, audits, logged };
}

afterEach(() => {
  setFileLog(null);
});

describe('ToolRegistryService · référence de la demande sur les lignes d\u0027outil', () => {
  it('un appel réussi est audité et journalisé avec la référence de la demande', async () => {
    const { register, run, audits, logged } = harness();
    register(async () => ({ ok: true, summary: 'fait' }));
    expect(await run({}, 'req-trace')).toMatchObject({ ok: true });
    expect(audits()[0]).toMatchObject({ action: `tool.${PROBE}`, actorId: USER, metadata: { ok: true, requestId: 'req-trace' } });
    expect(logged('tool.run')).toMatchObject({ tool: PROBE, ok: true, guildId: GUILD, requestId: 'req-trace' });
    // Un nom hors classification est signalé, et compte pour une écriture.
    expect(logged('tool.unclassified')).toEqual({ tool: PROBE });
  });

  it('sans référence posée par l\u0027appelant, aucune clé vide n\u0027est écrite', async () => {
    const { register, run, audits, logged } = harness();
    register(async () => ({ ok: true, summary: 'fait' }));
    await run();
    expect(audits()[0]?.metadata).not.toHaveProperty('requestId');
    expect(logged('tool.run')).not.toHaveProperty('requestId');
  });

  it('un refus avant le handler (paramètres invalides) porte aussi la référence', async () => {
    const { register, run, audits } = harness();
    register(async () => ({ ok: true, summary: 'jamais atteint' }), z.object({ n: z.number() }));
    expect(await run({ n: 'pas-un-nombre' }, 'req-refus')).toMatchObject({ ok: false });
    expect(audits()[0]?.metadata).toMatchObject({ ok: false, requestId: 'req-refus' });
  });
});

describe('ToolRegistryService · exception du handler', () => {
  it('le modèle reçoit un refus explicite ; le journal garde la nature de l\u0027erreur et une pile tronquée', async () => {
    const { register, run, audits, events } = harness();
    register(async () => {
      throw new Error('réseau coupé');
    });
    expect(await run({}, 'req-panne')).toEqual({ ok: false, summary: `Tool ${PROBE} a échoué : réseau coupé` });
    expect(audits()[0]).toMatchObject({ action: `tool.${PROBE}`, metadata: { ok: false, requestId: 'req-panne' } });
    const failed = events.find((entry) => entry.event === 'tool.failed');
    expect(failed?.level).toBe('error');
    expect(failed?.data).toMatchObject({ tool: PROBE, guildId: GUILD, requestId: 'req-panne', error: 'Error: réseau coupé' });
    // La pile commence là où l'erreur est née (ce fichier), sans chemin absolu.
    expect(failed?.data?.stack).toMatch(/^Object\.handler \(src\/modules\/tool-registry/u);
    expect(String(failed?.data?.stack)).not.toContain(`${process.cwd().replaceAll('\\', '/')}/`);
    // Aucune ligne de succès n'est écrite pour cet appel.
    expect(events.some((entry) => entry.event === 'tool.run')).toBe(false);
  });
});
