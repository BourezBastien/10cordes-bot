import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@spraxium/logger';
import { UsageLogService, type UsageLogEntry } from './usage-log.service';

/**
 * Journal des appels au modèle. Ce que ces tests fixent : une ligne est bornée
 * avant d'être écrite, un appel sans serveur n'écrit rien, et une écriture
 * ratée est dite en warning sans jamais remonter à l'appelant (un rejet non
 * traité ferait échouer la course entière de vitest).
 */

const GUILD = '1550000000000000001';
const INT_MAX = 2_147_483_647;

interface Row {
  guildId: string;
  requestId: string | null;
  cause: string;
  capability: string | null;
  provider: string | null;
  model: string | null;
  fallback: boolean;
  promptTokens: number;
  completionTokens: number;
  ms: number;
  ok: boolean;
}

const ENTRY: UsageLogEntry = {
  guildId: GUILD,
  requestId: 'req-1',
  cause: 'reply',
  capability: 'chat.default',
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  fallback: false,
  promptTokens: 12,
  completionTokens: 34,
  ms: 567,
  ok: true,
};

/** Prisma factice : la table des appels, réduite à l'écriture. */
function fakePrisma(create = vi.fn(async ({ data }: { data: Row }) => data)) {
  return { create, prisma: { llmUsageRow: { create } } };
}

const spyWarn = () => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
let warn: ReturnType<typeof spyWarn>;

beforeEach(() => {
  warn = spyWarn();
});

afterEach(() => {
  warn.mockRestore();
});

describe('UsageLogService', () => {
  it('écrit tout de suite une ligne bornée : textes coupés, jetons et durée entiers et positifs', () => {
    const { prisma, create } = fakePrisma();
    new UsageLogService(prisma as never).record({
      ...ENTRY,
      requestId: `  ${'r'.repeat(90)}  `,
      cause: 'c'.repeat(80),
      capability: 'k'.repeat(90),
      provider: 'p'.repeat(200),
      model: 'm'.repeat(300),
      promptTokens: -5.7,
      completionTokens: Number.NaN,
      ms: 3_000_000_000,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data).toEqual({
      guildId: GUILD,
      requestId: 'r'.repeat(40),
      cause: 'c'.repeat(40),
      capability: 'k'.repeat(56),
      provider: 'p'.repeat(120),
      model: 'm'.repeat(120),
      fallback: false,
      promptTokens: 0,
      completionTokens: 0,
      ms: INT_MAX,
      ok: true,
    });
  });

  it('une ligne saine passe telle quelle, les champs facultatifs vides donnent null', () => {
    const { prisma, create } = fakePrisma();
    new UsageLogService(prisma as never).record({ ...ENTRY, requestId: '  ', capability: null, provider: undefined, promptTokens: 7.9, ms: 1200.5 });
    expect(create.mock.calls[0]?.[0].data).toEqual({
      guildId: GUILD,
      requestId: null,
      cause: 'reply',
      capability: null,
      provider: null,
      model: 'deepseek-flash',
      fallback: false,
      promptTokens: 7,
      completionTokens: 34,
      ms: 1200,
      ok: true,
    });
  });

  it('les drapeaux ne valent vrai que s\u0027ils sont assertés', () => {
    const { prisma, create } = fakePrisma();
    // Valeurs non booléennes, telles qu'une réponse de fournisseur mal typée pourrait en donner.
    new UsageLogService(prisma as never).record({ ...ENTRY, fallback: 1, ok: 'yes' } as unknown as UsageLogEntry);
    expect(create.mock.calls[0]?.[0].data).toMatchObject({ fallback: false, ok: false });
  });

  it('sans serveur (null, vide, blancs), rien n\u0027est écrit et rien n\u0027est dit', () => {
    for (const guildId of [null, '', '   ']) {
      const { prisma, create } = fakePrisma();
      expect(() => new UsageLogService(prisma as never).record({ ...ENTRY, guildId })).not.toThrow();
      expect(create).not.toHaveBeenCalled();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('une écriture ratée est loggée en warning, sans remonter à l\u0027appelant', async () => {
    const { prisma } = fakePrisma(
      vi.fn(async (): Promise<Row> => {
        throw new Error('database is locked');
      }),
    );
    expect(() => new UsageLogService(prisma as never).record(ENTRY)).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(warn.mock.calls[0]?.[0]).toContain('« reply »');
    expect(warn.mock.calls[0]?.[0]).toContain(GUILD);
    expect(warn.mock.calls[0]?.[0]).toContain('database is locked');
  });

  it('un `create` qui lève sans attendre, ou une entrée malformée, sont loggés de même', async () => {
    const syncThrow = vi.fn((): Promise<Row> => {
      throw new TypeError('client déconnecté');
    });
    const service = new UsageLogService({ llmUsageRow: { create: syncThrow } } as never);
    expect(() => service.record(ENTRY)).not.toThrow();
    // Entrée malformée : plus de `guildId` lisible. La ligne est fautive, elle est dite, pas avalée.
    expect(() => new UsageLogService({} as never).record(undefined as unknown as UsageLogEntry)).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(warn.mock.calls[0]?.[0]).toContain('client déconnecté');
    expect(warn.mock.calls[1]?.[0]).toContain('perdue');
  });
});
