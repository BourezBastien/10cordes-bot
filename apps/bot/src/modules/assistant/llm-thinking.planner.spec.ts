import { describe, expect, it, vi } from 'vitest';
import { ReasoningEffortPlanner } from './llm-thinking.planner';

/**
 * Décision d'effort d'UNE requête. Deux notions à ne pas confondre, nées du
 * moteur multi-fournisseurs : `wants` (le serveur veut-il que la requête
 * raisonne, ce qui choisit la capacité de conversation) est indépendant de
 * l'endpoint ; l'effort envoyé, lui, en dépend (un endpoint peut refuser le
 * champ, un autre l'exiger).
 */

function planner(options: { effort?: string; mode?: 'adaptive' | 'always' | 'off'; instanceUrl?: string | null } = {}) {
  const env = { LLM_EFFORT: 'effort' in options ? options.effort : 'high' };
  const agentSettings = { get: vi.fn(async () => ({ thinkingMode: options.mode ?? 'adaptive' })) };
  return new ReasoningEffortPlanner({ env: env as never, agentSettings: agentSettings as never, baseUrl: () => options.instanceUrl ?? null });
}

const GUILD = '1550000000000000001';
const request = { userId: '1550000000000000002', guildId: GUILD, cause: 'reply' as const };
const DEEPSEEK = 'https://api.deepseek.com';

describe('ReasoningEffortPlanner · la requête veut-elle raisonner', () => {
  it('mode adaptive : seulement pour une demande orientée action', async () => {
    expect(await planner({ mode: 'adaptive' }).wants(request, true)).toBe(true);
    expect(await planner({ mode: 'adaptive' }).wants(request, false)).toBe(false);
  });

  it('mode always : toujours, même en conversation simple ; mode off : jamais', async () => {
    expect(await planner({ mode: 'always' }).wants(request, false)).toBe(true);
    expect(await planner({ mode: 'off' }).wants(request, true)).toBe(false);
  });

  it('hors serveur, le mode par défaut est adaptive', async () => {
    expect(await planner({ mode: 'always' }).wants({ ...request, guildId: null }, false)).toBe(false);
  });
});

describe('ReasoningEffortPlanner · effort envoyé, selon l\u0027endpoint', () => {
  it('contre le fournisseur du tour quand il est connu : rien pour un endpoint qui refuse le champ', async () => {
    const subject = planner({ mode: 'always', instanceUrl: DEEPSEEK });
    expect(await subject.plan(request, false, 'https://api.groq.com/openai/v1')).toBeNull();
    expect(await subject.plan(request, false, DEEPSEEK)).toBe('high');
  });

  it('sans fournisseur du tour, contre l\u0027instance', async () => {
    expect(await planner({ mode: 'always', instanceUrl: 'https://openrouter.ai/api/v1' }).plan(request, false)).toBeNull();
    expect(await planner({ mode: 'always', instanceUrl: DEEPSEEK }).plan(request, false)).toBe('high');
  });

  it('sans effort configuré, le champ n\u0027est jamais envoyé', async () => {
    expect(await planner({ effort: undefined, mode: 'always', instanceUrl: DEEPSEEK }).plan(request, true)).toBeNull();
  });

  it('DeepSeek : `none` coupe vraiment quand la requête ne raisonne pas', async () => {
    expect(await planner({ mode: 'adaptive', instanceUrl: DEEPSEEK }).plan(request, false)).toBe('none');
  });
});
