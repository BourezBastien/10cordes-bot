import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentDecisionJournal } from './agent-decision.journal';
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
  ctx: { guildId: string; userId: string; requestId: string; permissions: string[]; progress?: (text: string) => Promise<void> };
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
    llm: { planRequest: vi.fn(async () => ({ preferReasoning: false, reasoningEffort: null })) },
    registry: { listForGuild: vi.fn(async () => []) },
    guildRules: { describeForPrompt: vi.fn(async () => []) },
    loop,
    memory: {
      getGuildProfile: vi.fn(async () => null),
      getMemberProfile: vi.fn(async () => null),
      correctionLines: vi.fn(async () => ({ guild: [], members: new Map<string, string[]>() })),
    },
    config: { get: vi.fn(async () => null) },
    audit: { record: vi.fn() },
    prisma: { auditLog: { findMany: vi.fn(async () => []) }, agentDecision: { create: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 0 })) } },
    client,
    router: {},
    integrations: {},
    progress,
  };
  // Le vrai journal des décisions, sur une base factice : ce que la demande a laissé se lit dans `record`.
  const journal = new AgentDecisionJournal(deps.prisma as never);
  const record = vi.spyOn(journal, 'record');
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
    journal,
    // L'extinction suit une conversation commencée : ici, elle la laisse passer telle quelle.
    { track: (work: Promise<unknown>) => work } as never,
  );
  return { service, deps, loop, progress, guild, record };
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

  it('la décision est journalisée : émetteur, issue, tours, outils, et les étapes reçues de la progression', async () => {
    const { service, record, loop } = harness();
    loop.run.mockImplementationOnce(async (_m: unknown, _t: unknown, ctx: LoopCall['ctx'], _runOptions: RunOptions, hooks: RunHooks) => {
      await ctx.progress?.('analyse : 12/36 salons');
      hooks.onToolResult?.('records.list', { ok: true, summary: '3 fiches lues' });
      return { finalText: 'Voici.', usage: { promptTokens: 120, completionTokens: 40 }, turns: 2 };
    });
    await service.chat(GUILD, USER, 'liste les fiches', ID);
    expect(record).toHaveBeenCalledTimes(1);
    const [guildId, row] = record.mock.calls[0] ?? [];
    expect(guildId).toBe(GUILD);
    expect(row).toMatchObject({ requestId: ID, source: 'web', actorId: USER, outcome: 'replied', intent: 'conversation', turns: 2, tools: 1, failures: 0, promptTokens: 120, completionTokens: 40 });
    expect(JSON.parse(row.stepsJson ?? '[]')).toEqual([
      expect.objectContaining({ kind: 'progress', text: 'analyse : 12/36 salons' }),
      expect.objectContaining({ kind: 'tool', name: 'records.list', ok: true, text: '3 fiches lues' }),
    ]);
  });

  it('une boucle qui échoue laisse une décision en échec, avec la nature de l’erreur', async () => {
    const { service, record } = harness({ fails: true });
    await service.chat(GUILD, USER, 'fais quelque chose', ID);
    expect(record.mock.calls[0]?.[1]).toMatchObject({ outcome: 'failed', turns: 0, tools: 0, reasoning: false });
    expect(String(record.mock.calls[0]?.[1].error)).toContain('modèle indisponible');
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
