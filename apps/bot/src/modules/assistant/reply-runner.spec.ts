import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFileLog, type FileLogService } from '../logging/file-log.service';
import type { AgentLoopHooks } from './agent-loop.service';
import type { ConversationContext } from './conversation-context';
import { AgentReplyRunner, type ReplyRunnerDeps } from './reply-runner';
import { ReplySession } from './reply-session';

/**
 * Le runner observe la boucle : il transmet la référence de la demande, audite
 * chaque tool avec elle, et journalise une erreur de la boucle avec sa pile
 * tronquée (la console, elle, ne garde que le message).
 */

const GUILD = '1550000000000000001';
const USER = '1550000000000000002';

const conversation = (): ConversationContext =>
  ({
    guild: { id: GUILD },
    request: { userId: USER },
    requestId: 'req-runner',
    session: new ReplySession(false),
    toolset: {},
    runContext: {},
    messages: [],
    intent: { action: false },
  }) as unknown as ConversationContext;

function journal() {
  const events: Array<{ level: string; event: string; data: Record<string, unknown> | undefined }> = [];
  const log: Pick<FileLogService, 'event' | 'llm'> = {
    event: (level, _ctx, event, data) => {
      events.push({ level, event, data });
    },
    llm: vi.fn(),
  };
  setFileLog(log as FileLogService);
  return events;
}

const outcome = { finalText: 'Fait.', executed: ['surface.create'], usage: { promptTokens: 10, completionTokens: 4 }, turns: 2, error: null, completed: true };

function runner(loop: Record<string, unknown>): { deps: ReplyRunnerDeps; audit: { record: ReturnType<typeof vi.fn> } } {
  const audit = { record: vi.fn() };
  const deps = {
    loop: loop as never,
    llm: { planRequest: async () => ({ reasoningEffort: null, preferReasoning: false }) },
    audit: audit as never,
    patterns: { record: async () => undefined },
    cacheStore: { active: {} },
  } as unknown as ReplyRunnerDeps;
  return { deps, audit };
}

afterEach(() => {
  setFileLog(null);
});

describe('AgentReplyRunner · référence de la demande', () => {
  it('la boucle et l\u0027audit de chaque tool reçoivent la référence', async () => {
    const { deps, audit } = runner({
      run: vi.fn(async (_messages: unknown, _toolset: unknown, _ctx: unknown, _options: unknown, hooks: AgentLoopHooks) => {
        await hooks.onToolResult?.('surface.create', { ok: true, summary: 'créé' }, {}, 0);
        return outcome;
      }),
    });
    const result = await new AgentReplyRunner(deps).run(conversation());
    expect(result).toMatchObject({ finalText: 'Fait.', executed: ['surface.create'], turns: 2, error: null });
    const options = (deps.loop as unknown as { run: ReturnType<typeof vi.fn> }).run.mock.calls[0]?.[3];
    expect(options).toMatchObject({ userId: USER, guildId: GUILD, requestId: 'req-runner' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assistant.tool.surface.create', metadata: expect.objectContaining({ requestId: 'req-runner', ok: true, summary: 'créé' }) }),
    );
  });

  it('une erreur de la boucle est rendue en erreur typée et journalisée avec sa pile tronquée', async () => {
    const events = journal();
    const { deps } = runner({
      run: async () => {
        throw new Error('panne du fournisseur');
      },
    });
    const result = await new AgentReplyRunner(deps).run(conversation());
    expect(result.error?.message).toBe('panne du fournisseur');
    expect(result.turns).toBe(0);
    const failure = events.find((entry) => entry.event === 'loop.error');
    expect(failure?.level).toBe('error');
    expect(failure?.data).toMatchObject({ requestId: 'req-runner', guildId: GUILD, error: 'Error: panne du fournisseur' });
    expect(String(failure?.data?.stack)).toContain('reply-runner.spec.ts');
  });
});
