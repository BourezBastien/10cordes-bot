import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestProgressService } from './request-progress.service';
import { WebAgentService } from './web-agent.service';

/**
 * L’agent du dashboard : la même boucle que Discord, avec les permissions du
 * membre lié. Tout ce qui entoure la boucle est remplacé ; ce qui est fixé
 * ici, c’est le contrat de `chat` : l’identité et les permissions passées à
 * la boucle, les outils rendus, et le suivi des étapes quand le panel a
 * choisi un identifiant de demande (aucun suivi sinon).
 */

const GUILD = '1550000000000000001';
const USER = '1550000000000000002';
const ID = 'web-0f1e2d3c-4b5a';

vi.mock('../providers/image-engines', () => ({ imageEnginesLine: async () => null }));
vi.mock('../agent/skill.service', () => ({ getSkillTriggers: async () => [] }));
vi.mock('../action-plan/action-plan.runtime', () => ({ getActionPlans: () => null }));

interface RunOptions {
  userId: string;
  guildId: string;
  requestId: string;
}

interface RunHooks {
  cause: string;
  onToolResult?: (name: string, result: { ok: boolean; summary: string }) => void;
}

interface LoopCall {
  ctx: { guildId: string; userId: string; requestId: string; permissions: string[] };
  options: RunOptions;
  hooks: RunHooks;
}

/** Le leurre de boucle : il rend les outils comme le fait la vraie boucle, par son cinquième argument. */
function harness(options: { fails?: boolean } = {}) {
  const loop = {
    run: vi.fn(async (_messages: unknown, _toolset: unknown, ctx: LoopCall['ctx'], runOptions: RunOptions, hooks: RunHooks) => {
      if (options.fails) throw new Error('modèle indisponible');
      hooks.onToolResult?.('records.list', { ok: true, summary: '3 fiches lues' });
      hooks.onToolResult?.('records.delete', { ok: false, summary: 'Action en attente de confirmation.' });
      return { finalText: 'Voici les 3 fiches.', usage: { promptTokens: 120, completionTokens: 40 }, turns: 2 };
    }),
  };
  const member = { displayName: 'Bastien', permissions: { toArray: () => ['ManageGuild', 'ViewChannel'] } };
  const guild = { id: GUILD, name: 'Les Cordées', memberCount: 12, members: { fetch: vi.fn(async () => member) } };
  const client = { guilds: { cache: new Map([[GUILD, guild]]) }, channels: { fetch: vi.fn() } };
  const progress = new RequestProgressService();
  const deps = {
    llm: { planRequest: vi.fn(async () => ({ preferReasoning: false })) },
    registry: { listForGuild: vi.fn(async () => []) },
    guildRules: { describeForPrompt: vi.fn(async () => []) },
    loop,
    memory: { getGuildProfile: vi.fn(async () => null), getMemberProfile: vi.fn(async () => null) },
    config: { get: vi.fn(async () => null) },
    audit: { record: vi.fn() },
    prisma: { auditLog: { findMany: vi.fn(async () => []) } },
    client,
    router: {},
    integrations: {},
    progress,
  };
  const service = new WebAgentService(
    deps.llm as never,
    deps.registry as never,
    deps.guildRules as never,
    deps.loop as never,
    deps.memory as never,
    deps.config as never,
    deps.audit as never,
    deps.prisma as never,
    deps.client as never,
    deps.router as never,
    deps.integrations as never,
    deps.progress,
  );
  return { service, deps, loop, progress, guild };
}

afterEach(() => {
  vi.clearAllTimers();
});

describe('WebAgentService · chat', () => {
  it('la boucle reçoit le serveur, le membre Discord et ses permissions ; le résultat rend la réponse et les outils', async () => {
    const { service, loop, deps } = harness();
    const result = await service.chat(GUILD, USER, '  liste les fiches  ');
    expect(result).toEqual({
      reply: 'Voici les 3 fiches.',
      silent: false,
      tools: [
        { name: 'records.list', ok: true, summary: '3 fiches lues' },
        { name: 'records.delete', ok: false, summary: 'Action en attente de confirmation.' },
      ],
    });
    const [ctx, runOptions, hooks] = [loop.run.mock.calls[0]?.[2], loop.run.mock.calls[0]?.[3], loop.run.mock.calls[0]?.[4]];
    expect(ctx).toMatchObject({ guildId: GUILD, userId: USER, permissions: ['ManageGuild', 'ViewChannel'], channelId: null });
    expect(runOptions).toMatchObject({ userId: USER, guildId: GUILD, requestId: ctx?.requestId });
    expect(hooks?.cause).toBe('web');
    expect(deps.llm.planRequest).toHaveBeenCalledWith({ userId: USER, guildId: GUILD, cause: 'web' }, expect.anything());
    expect(deps.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'llm.usage', source: 'agent', actorId: USER, metadata: expect.objectContaining({ cause: 'web', promptTokens: 120, completionTokens: 40, turns: 2 }) }));
  });

  it('sans identifiant choisi par le panel, la demande garde un identifiant interne et rien n’est suivi', async () => {
    const { service, loop, progress } = harness();
    await service.chat(GUILD, USER, 'bonjour');
    const ctx = loop.run.mock.calls[0]?.[2];
    expect(ctx?.requestId).toMatch(/^web-[a-z0-9]{8}$/u);
    expect(progress.count(GUILD)).toBe(0);
  });

  it('avec l’identifiant choisi par le panel, les étapes se suivent en direct et la demande se clôt en réussite', async () => {
    const { service, loop, progress } = harness();
    // Pendant l'exécution, on lit l'état depuis la boucle elle-même.
    let live: unknown = null;
    loop.run.mockImplementationOnce(async (_m: unknown, _t: unknown, ctx: LoopCall['ctx'], runOptions: RunOptions, hooks: RunHooks) => {
      hooks.onToolResult?.('records.list', { ok: true, summary: '3 fiches lues' });
      live = progress.read(GUILD, ID);
      return { finalText: 'Voici.', usage: { promptTokens: 1, completionTokens: 1 }, turns: 1 };
    });
    await service.chat(GUILD, USER, 'liste', ID);
    expect(live).toEqual({ requestId: ID, state: 'running', steps: [{ name: 'records.list', ok: true, summary: '3 fiches lues' }] });
    expect(loop.run.mock.calls[0]?.[2]).toMatchObject({ requestId: ID });
    expect(loop.run.mock.calls[0]?.[3]).toMatchObject({ requestId: ID });
    expect(progress.read(GUILD, ID)).toMatchObject({ state: 'done', steps: [{ name: 'records.list', ok: true }] });
    expect(progress.read('1550000000000000008', ID)).toBeNull();
  });

  it('une boucle qui échoue clôt la demande en échec, et la réponse le dit sans inventer', async () => {
    const { service, progress } = harness({ fails: true });
    const result = await service.chat(GUILD, USER, 'fais quelque chose', ID);
    expect(result).toMatchObject({ silent: false, tools: [] });
    expect(result.reply).toContain('réussi à produire une réponse');
    expect(progress.read(GUILD, ID)).toMatchObject({ state: 'failed', steps: [] });
  });

  it('les refus avant tout appel au modèle : message vide ou trop long, cadence, non-membre', async () => {
    const { service, loop, guild } = harness();
    await expect(service.chat(GUILD, USER, '   ')).rejects.toThrow('Message vide.');
    await expect(service.chat(GUILD, USER, 'x'.repeat(2_001))).rejects.toThrow('Message trop long');
    await expect(service.chat(GUILD, USER, 'salut')).resolves.toBeDefined();
    await expect(service.chat(GUILD, USER, 're')).rejects.toThrow('Trop de demandes');
    expect(loop.run).toHaveBeenCalledTimes(1);
    guild.members.fetch.mockResolvedValue(null as never);
    await expect(service.chat('1550000000000000009', USER, 'ailleurs')).rejects.toThrow();
  });
});
