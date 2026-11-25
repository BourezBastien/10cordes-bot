import { describe, expect, it, vi } from 'vitest';
import { AgentDecisionRecorder, DECISION_STEPS_MAX, motifOf, outcomeOf } from './agent-decision.recorder';
import { AgentDecisionJournal, DECISION_RETENTION_MS } from './agent-decision.journal';
import type { RequestIntent } from './request-intent';

/*
 * Journal des décisions : ce qu'une demande laisse (le motif de son
 * classement, l'issue, les étapes bornées), et ce que le journal en fait
 * (une écriture qui ne casse rien, une purge à 14 jours).
 */

const GUILD = '1550000000000000001';
const USER = '1550000000000000002';
const T0 = Date.UTC(2026, 10, 25, 18, 0, 0);

const intent = (overrides: Partial<RequestIntent> = {}): RequestIntent => ({ action: false, signal: null, matchedSkills: [], mutatingTools: [], ...overrides });
const usage = { promptTokens: 10, completionTokens: 5 };

describe('motifOf', () => {
  it('une conversation simple n\u0027a ni signal ni motif', () => {
    expect(motifOf(intent())).toEqual({ intent: 'conversation', signal: null, motif: null });
  });

  it('une action garde son signal et ce qu\u0027il a nommé : la recette, l\u0027outil, le verbe', () => {
    expect(motifOf(intent({ action: true, signal: 'skill', matchedSkills: ['tickets | Quand on demande un système de tickets'] }))).toEqual({ intent: 'action', signal: 'skill', motif: 'skill:tickets' });
    expect(motifOf(intent({ action: true, signal: 'tool', mutatingTools: ['channel.create'] }))).toEqual({ intent: 'action', signal: 'tool', motif: 'tool:channel.create' });
    expect(motifOf(intent({ action: true, signal: 'verb' }))).toEqual({ intent: 'action', signal: 'verb', motif: 'verb' });
  });
});

describe('outcomeOf', () => {
  it.each([
    ['répondu', { finalText: 'Voilà.', error: null }, 'replied'],
    ['silencieux (outils seuls)', { finalText: null, error: null }, 'silent'],
    ['au plafond d\u0027itérations', { finalText: 'Résumé.', error: null, forcedSummary: true }, 'ceiling'],
    ['en échec', { finalText: null, error: new Error('panne') }, 'failed'],
    ['crédits épuisés', { finalText: null, error: new Error('402'), quotaExhausted: true }, 'quota'],
  ])('%s', (_label, result, outcome) => {
    expect(outcomeOf(result)).toBe(outcome);
  });
});

describe('AgentDecisionRecorder', () => {
  it('une décision garde son commencement, son motif, son parcours et sa durée', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(T0);
      const recorder = new AgentDecisionRecorder({ guildId: GUILD, requestId: 'req-1', source: 'discord', actorId: USER, channelId: '1550000000000000003' });
      recorder.note('analyse : 1/3');
      vi.setSystemTime(T0 + 400);
      recorder.step('records.list', { ok: true, summary: '3 fiches' });
      recorder.step('records.delete', { ok: false, summary: 'Refusé' });
      vi.setSystemTime(T0 + 1_500);
      const row = recorder.finish({ intent: intent({ action: true, signal: 'tool', mutatingTools: ['records.delete'] }), reasoning: true, effort: 'low', turns: 3, usage, outcome: 'replied' });
      const { stepsJson, ...rest } = row;
      expect(rest).toEqual({
        requestId: 'req-1',
        source: 'discord',
        actorId: USER,
        channelId: '1550000000000000003',
        intent: 'action',
        signal: 'tool',
        motif: 'tool:records.delete',
        reasoning: true,
        effort: 'low',
        turns: 3,
        tools: 2,
        failures: 1,
        outcome: 'replied',
        error: null,
        promptTokens: 10,
        completionTokens: 5,
        durationMs: 1_500,
      });
      expect(JSON.parse(stepsJson ?? '[]')).toEqual([
        { at: 0, kind: 'progress', text: 'analyse : 1/3' },
        { at: 400, kind: 'tool', name: 'records.list', text: '3 fiches', ok: true },
        { at: 400, kind: 'tool', name: 'records.delete', text: 'Refusé', ok: false },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('les étapes sont bornées : au-delà de 60, elles sont comptées ; les textes sont coupés ; sans étape, rien n\u0027est écrit', () => {
    const recorder = new AgentDecisionRecorder({ guildId: GUILD, requestId: 'req-2', source: 'web', actorId: USER, channelId: null });
    expect(recorder.cached(intent()).stepsJson).toBeNull();
    for (let index = 0; index < DECISION_STEPS_MAX + 2; index += 1) recorder.note(`étape ${index}`);
    const steps = JSON.parse(recorder.cached(intent()).stepsJson ?? '[]') as Array<{ text: string }>;
    expect(steps).toHaveLength(DECISION_STEPS_MAX + 1);
    expect(steps.at(-1)?.text).toBe('(+2 autres étapes)');

    const long = new AgentDecisionRecorder({ guildId: GUILD, requestId: 'req-3', source: 'web', actorId: USER, channelId: null });
    long.note('x'.repeat(500));
    long.step('n'.repeat(200), { ok: true, summary: 's'.repeat(500) });
    const clipped = JSON.parse(long.cached(intent()).stepsJson ?? '[]') as Array<{ name?: string; text: string }>;
    expect(clipped[0]?.text).toHaveLength(200);
    expect(clipped[1]?.name).toHaveLength(80);
    expect(clipped[1]?.text).toHaveLength(200);
  });

  it('l\u0027erreur est bornée (la nature de l\u0027erreur, jamais sa pile), et absente quand la demande a abouti', () => {
    const recorder = new AgentDecisionRecorder({ guildId: GUILD, requestId: 'req-4', source: 'web', actorId: USER, channelId: null });
    const row = recorder.finish({ intent: intent(), reasoning: false, effort: null, turns: 1, usage, outcome: 'failed', error: new Error('e'.repeat(900)) });
    expect(row.error).not.toBeNull();
    expect(row.error?.length).toBeLessThanOrEqual(300);
    expect(row.error).toMatch(/^Error: e+$/u);
    expect(row.stepsJson).toBeNull();
    expect(recorder.cached(intent()).error).toBeNull();
  });
});

describe('AgentDecisionJournal', () => {
  function harness() {
    const prisma = { agentDecision: { create: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 3 })) } };
    const journal = new AgentDecisionJournal(prisma as never);
    return { prisma, journal };
  }

  it('la purge au démarrage retire ce qui a plus de 14 jours', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(T0);
      const { prisma, journal } = harness();
      await journal.onBoot();
      expect(prisma.agentDecision.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date(T0 - DECISION_RETENTION_MS) } } });
      expect(DECISION_RETENTION_MS).toBe(14 * 24 * 60 * 60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('une décision s\u0027écrit pour son serveur ; la purge suit au plus une fois par heure', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(T0);
      const { prisma, journal } = harness();
      await journal.onBoot();
      prisma.agentDecision.deleteMany.mockClear();
      const row = new AgentDecisionRecorder({ guildId: GUILD, requestId: 'req-5', source: 'web', actorId: USER, channelId: null }).cached(intent());
      await journal.record(GUILD, row);
      await journal.record(GUILD, row);
      expect(prisma.agentDecision.create).toHaveBeenCalledTimes(2);
      expect(prisma.agentDecision.create).toHaveBeenLastCalledWith({ data: { guildId: GUILD, ...row } });
      expect(prisma.agentDecision.deleteMany).not.toHaveBeenCalled();

      vi.setSystemTime(T0 + 60 * 60_000);
      await journal.record(GUILD, row);
      expect(prisma.agentDecision.deleteMany).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('une écriture qui échoue ne remonte jamais : elle se dit', async () => {
    const { prisma, journal } = harness();
    prisma.agentDecision.create.mockRejectedValueOnce(new Error('base pleine'));
    const row = new AgentDecisionRecorder({ guildId: GUILD, requestId: 'req-6', source: 'web', actorId: USER, channelId: null }).cached(intent());
    await expect(journal.record(GUILD, row)).resolves.toBeUndefined();
    prisma.agentDecision.deleteMany.mockRejectedValueOnce(new Error('base absente'));
    await expect(journal.purge(T0)).resolves.toBe(0);
  });
});
