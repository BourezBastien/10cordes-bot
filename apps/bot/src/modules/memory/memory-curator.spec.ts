import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ llmChat: vi.fn() }));

vi.mock('../assistant/llm.accessor', () => ({
  getLlm: () => ({ chat: mocks.llmChat }),
}));

import { MemoryCuratorService } from './memory-curator.service';

function makeCurator(currentText: string | null = null) {
  const prisma = {
    memberMemoryProfile: {
      findUnique: vi.fn().mockResolvedValue(currentText === null ? null : { text: currentText }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    guildMemoryProfile: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const audit = { record: vi.fn() };
  const curator = new MemoryCuratorService(prisma as never, audit as never);
  return { curator, prisma, audit };
}

const ok = (text: string) => JSON.stringify({ decision: 'appended', reason: '', text });

describe('MemoryCuratorService', () => {
  it('fusionne un fait valide et upsert la fiche', async () => {
    mocks.llmChat.mockResolvedValue({
      content: ok('Fiche : <@123> aime les pizzas.'),
      reasoningContent: null,
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    const { curator, prisma } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'aime les pizzas');
    expect(result.status).toBe('appended');
    expect(prisma.memberMemoryProfile.upsert).toHaveBeenCalledTimes(1);
    // Le fait rapporté est enveloppé dans une zone <donnees> (anti-injection).
    const call = mocks.llmChat.mock.calls[0] as unknown as [unknown[], unknown, { cause: string }];
    expect(call[2].cause).toBe('consolidation');
    expect(JSON.stringify(call[0])).toContain('<donnees>');
  });

  it('rejette une fiche dépassant le budget de 2000 caractères', async () => {
    mocks.llmChat.mockResolvedValue({ content: ok('x'.repeat(2100)), reasoningContent: null, toolCalls: [] });
    const { curator, prisma } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'un fait');
    expect(result.status).toBe('rejected');
    expect(prisma.memberMemoryProfile.upsert).not.toHaveBeenCalled();
  });

  it('anti-wipe : refus si la fusion réduit la fiche de plus de 50 %', async () => {
    mocks.llmChat.mockResolvedValue({ content: ok('Fiche réduite : <@123>.'), reasoningContent: null, toolCalls: [] });
    const { curator, prisma } = makeCurator('a'.repeat(500));
    const result = await curator.consolidateMember('g1', '123', '456', 'un fait');
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('anti-wipe');
    expect(prisma.memberMemoryProfile.upsert).not.toHaveBeenCalled();
  });

  it('rejette une fiche membre qui ne référence pas le sujet', async () => {
    mocks.llmChat.mockResolvedValue({ content: ok('Fiche sans mention du sujet.'), reasoningContent: null, toolCalls: [] });
    const { curator } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'un fait');
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('référence');
  });

  it('respecte le refus explicite du conservateur', async () => {
    mocks.llmChat.mockResolvedValue({
      content: JSON.stringify({ decision: 'rejected', reason: 'fait anecdotique', text: 'Fiche : <@123>.' }),
      reasoningContent: null,
      toolCalls: [],
    });
    const { curator, prisma } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'un fait anecdotique');
    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('fait anecdotique');
    expect(prisma.memberMemoryProfile.upsert).not.toHaveBeenCalled();
  });

  it('unconsolidated si le LLM échoue (le journal brut reste la source)', async () => {
    mocks.llmChat.mockRejectedValue(new Error('timeout'));
    const { curator, prisma } = makeCurator();
    const result = await curator.consolidateMember('g1', '123', '456', 'un fait');
    expect(result.status).toBe('unconsolidated');
    expect(prisma.memberMemoryProfile.upsert).not.toHaveBeenCalled();
  });

  it('la fusion serveur upsert GuildMemoryProfile sans contrainte de sujet', async () => {
    mocks.llmChat.mockResolvedValue({
      content: ok('Le serveur applique la règle : pas de spoilers.'),
      reasoningContent: null,
      toolCalls: [],
    });
    const { curator, prisma } = makeCurator();
    const result = await curator.consolidateGuild('g1', '456', 'pas de spoilers');
    expect(result.status).toBe('appended');
    expect(prisma.guildMemoryProfile.upsert).toHaveBeenCalledTimes(1);
    const call = mocks.llmChat.mock.calls[0] as unknown as [unknown[], unknown, { cause: string }];
    expect(call[2].cause).toBe('consolidation');
  });
});
