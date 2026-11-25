import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, type ToolRunContext } from '../src/index.js';

/**
 * `defineTool` : le handler reçoit l'entrée déjà typée, sans cast dans le
 * module qui déclare l'outil. La validation reste celle du registry, avant
 * l'appel : la factory ne fait que transmettre.
 */

const ctx: ToolRunContext = { guildId: '1550000000000000001', userId: '1550000000000000002', locale: 'fr', permissions: [], reply: async () => {} };

describe('defineTool', () => {
  it('le handler reçoit l\u0027entrée et le contexte tels quels, et son résultat est rendu tel quel', async () => {
    const calls: Array<{ input: unknown; ctx: ToolRunContext }> = [];
    const tool = defineTool({
      name: 'test.sum',
      description: 'Additionne',
      category: 'test',
      paramsSchema: z.object({ a: z.number(), b: z.number().default(2) }),
      requiredModules: [],
      destructive: false,
      keywords: ['somme'],
      handler: async (input, runCtx) => {
        calls.push({ input, ctx: runCtx });
        return { ok: true, summary: String(input.a + input.b), data: { total: input.a + input.b } };
      },
    });

    expect(await tool.handler({ a: 1, b: 3 }, ctx)).toEqual({ ok: true, summary: '4', data: { total: 4 } });
    expect(calls).toEqual([{ input: { a: 1, b: 3 }, ctx }]);
    expect(tool).toMatchObject({ name: 'test.sum', description: 'Additionne', category: 'test', keywords: ['somme'], destructive: false });
    expect(tool.requiredModules).toEqual([]);
  });

  it('un échec du handler traverse la factory : c\u0027est le registry qui le rend explicite', async () => {
    const tool = defineTool({
      name: 'test.fail',
      description: 'Échoue',
      category: 'test',
      paramsSchema: z.object({}),
      requiredModules: [],
      destructive: false,
      handler: async () => {
        throw new Error('panne');
      },
    });
    await expect(tool.handler({}, ctx)).rejects.toThrow('panne');
  });
});
