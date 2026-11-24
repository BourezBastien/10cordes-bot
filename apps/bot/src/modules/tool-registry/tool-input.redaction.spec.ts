import { describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '@10cordes/shared';
import { z } from 'zod';
import { ToolRegistryService } from './tool-registry.service';
import { redactToolInput } from './tool-input.redaction';

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';

/**
 * Le registre journalise l'entrée de chaque tool. Un secret donné en
 * paramètre (clé API d'un fournisseur) ne doit JAMAIS se retrouver en clair
 * dans la table d'audit.
 */

const GUILD = '1550835980116824136';
const SECRET = 'test-key-not-real';
const KEY = 'apiKey';

describe('redactToolInput', () => {
  it('laisse l\u0027entrée telle quelle quand le tool ne déclare aucun paramètre sensible', () => {
    const input = { slug: 'openrouter', baseUrl: 'https://api.example.test' };
    expect(redactToolInput(input, undefined)).toEqual(input);
    expect(redactToolInput(input, [])).toEqual(input);
  });

  it('masque les paramètres déclarés sensibles, et seulement eux', () => {
    const input = { slug: 'openrouter', [KEY]: SECRET, note: 'autre' };
    const redacted = redactToolInput(input, [KEY]);
    expect(redacted).toEqual({ slug: 'openrouter', [KEY]: '[masqué]', note: 'autre' });
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
  });

  it('ne modifie pas l\u0027objet d\u0027origine et tolère une entrée vide', () => {
    const input = { [KEY]: SECRET };
    redactToolInput(input, [KEY]);
    expect(input[KEY]).toBe(SECRET);
    expect(redactToolInput(undefined, [KEY])).toEqual({});
    expect(redactToolInput('texte', [KEY])).toEqual({});
  });
});

describe('ToolRegistryService · audit d\u0027un tool à paramètre sensible', () => {
  it('journalise l\u0027entrée avec la clé masquée, et transmet la vraie valeur au handler', async () => {
    const audit = { record: vi.fn() };
    const registry = new ToolRegistryService(
      { activeModules: async () => new Set<string>() } as never,
      {} as never,
      audit as never,
      { toolNode: { findMany: async () => [] } } as never,
      {} as never,
      {} as never,
    );
    let received: unknown;
    registry.register({
      [NAME]: 'test.providerUpsert',
      description: 'tool de test',
      category: 'test',
      paramsSchema: z.object({ slug: z.string(), [KEY]: z.string().optional() }),
      requiredModules: [],
      destructive: false,
      sensitiveInputs: [KEY],
      handler: async (input) => {
        received = input;
        return { ok: true, summary: 'fait' };
      },
    });
    const ctx: ToolRunContext = { guildId: GUILD, channelId: null, userId: '1550000000000000001', locale: 'fr', permissions: [], reply: async () => undefined };
    const result = await registry.run('test.providerUpsert', { slug: 'openrouter', [KEY]: SECRET }, ctx);
    expect(result.ok).toBe(true);
    expect(received).toEqual({ slug: 'openrouter', [KEY]: SECRET });
    const auditRow = audit.record.mock.calls.at(-1)?.[0] as { action: string; metadata: { input: Record<string, unknown> } };
    expect(auditRow.action).toBe('tool.test.providerUpsert');
    expect(auditRow.metadata.input[KEY]).toBe('[masqué]');
    expect(JSON.stringify(auditRow)).not.toContain(SECRET);
  });
});
