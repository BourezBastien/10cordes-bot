import { Hono, type Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getValidatedEnv } from '../env.accessor';
import { ProbeKeyGuard } from './probe-key.guard';

/**
 * Sonde du processus : la SEULE route qui demande la clé API serveur à
 * serveur, et seulement quand `HTTP_API_KEY` est réglé. La comparaison est à
 * temps constant ; une clé d'autre longueur est refusée sans comparaison.
 */

vi.mock('../env.accessor', () => ({ getValidatedEnv: vi.fn() }));

// Valeurs factices, sans valeur utilisable.
const KEY = 'test-key-not-real-0001';
const WRONG = 'test-key-not-real-0002';
const HEADER = 'x-api-key';

async function through(value?: string): Promise<boolean> {
  const app = new Hono();
  app.get('/healthz', async (ctx: Context) => ctx.text(String(await new ProbeKeyGuard().canActivate(ctx))));
  const response = await app.request('/healthz', { headers: value === undefined ? {} : { [HEADER]: value } });
  return (await response.text()) === 'true';
}

beforeEach(() => {
  vi.mocked(getValidatedEnv).mockReset();
});

describe('ProbeKeyGuard', () => {
  it('sans clé réglée, la sonde est ouverte, avec ou sans en-tête', async () => {
    vi.mocked(getValidatedEnv).mockReturnValue({ HTTP_API_KEY: undefined } as never);
    expect(await through()).toBe(true);
    expect(await through(WRONG)).toBe(true);
  });

  it('avec une clé réglée : absente ou fausse, refus ; exacte, accès', async () => {
    vi.mocked(getValidatedEnv).mockReturnValue({ HTTP_API_KEY: KEY } as never);
    expect(await through()).toBe(false);
    expect(await through('')).toBe(false);
    expect(await through(WRONG)).toBe(false);
    expect(await through(KEY)).toBe(true);
  });

  it('une clé d\u0027autre longueur est refusée sans être comparée', async () => {
    vi.mocked(getValidatedEnv).mockReturnValue({ HTTP_API_KEY: KEY } as never);
    expect(await through(`${KEY}x`)).toBe(false);
    expect(await through(KEY.slice(0, -1))).toBe(false);
  });
});
