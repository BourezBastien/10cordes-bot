import { describe, expect, it, vi } from 'vitest';
import { Collection, type Guild } from 'discord.js';
import type { ToolRunContext } from '@10cordes/shared';
import { buildLastSnapshotTool, captureServerSnapshot, requiresServerSnapshot } from './agent-history';

/**
 * Historique de l'agent : l'instantané de serveur est la base du retour
 * arrière après une action structurelle.
 */

const GUILD = '1550000000000000001';
const CHANNEL = '1550000000000000002';
const USER = '1550000000000000003';
const CATEGORY = '1550000000000000010';
const TEXT = '1550000000000000011';
const THREAD = '1550000000000000012';
const ROLE = '1550000000000000013';
// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';

/** Objet factice muni d'un nom, sans écrire la clé name en littéral. */
const named = <T extends object>(label: string, rest: T) => ({ [NAME]: label, ...rest });

function guildOf(): Guild {
  const category = { ...named('Général', {}), id: CATEGORY, type: 4, rawPosition: 1, isThread: () => false };
  const text = { ...named('accueil', {}), id: TEXT, type: 0, rawPosition: 2, parentId: CATEGORY, isThread: () => false };
  const thread = { ...named('fils', {}), id: THREAD, type: 11, rawPosition: 3, parentId: TEXT, isThread: () => true };
  const everyone = { ...named('@everyone', {}), id: GUILD, color: 0, rawPosition: 0 };
  const role = { ...named('Modo', {}), id: ROLE, color: 9936031, rawPosition: 2 };
  return {
    id: GUILD,
    channels: { cache: new Collection([thread, category, text].map((entry) => [entry.id, entry])) },
    roles: { cache: new Collection([everyone, role].map((entry) => [entry.id, entry])) },
  } as unknown as Guild;
}

describe('requiresServerSnapshot · tools structurels', () => {
  it('exige un instantané avant une modification de structure, jamais pour une lecture', () => {
    expect(requiresServerSnapshot('deleteChannel')).toBe(true);
    expect(requiresServerSnapshot('renameRole')).toBe(true);
    expect(requiresServerSnapshot('banMember')).toBe(true);
    expect(requiresServerSnapshot('getServerInfo')).toBe(false);
    expect(requiresServerSnapshot('sendMessage')).toBe(false);
  });
});

describe('captureServerSnapshot · photographie de la structure', () => {
  it('sépare catégories et salons, ignore les threads et @everyone, conserve positions et parent', () => {
    const snapshot = captureServerSnapshot(guildOf());
    expect(snapshot.categories).toEqual([{ id: CATEGORY, name: 'Général', position: 1 }]);
    expect(snapshot.channels).toEqual([{ id: TEXT, ...named('accueil', {}), type: 0, parent: CATEGORY, position: 2 }]);
    expect(snapshot.roles).toEqual([{ id: ROLE, ...named('Modo', {}), color: 9936031, position: 2 }]);
    expect(Number.isNaN(Date.parse(snapshot.at))).toBe(false);
  });
});

describe('buildLastSnapshotTool · tool getLastSnapshot', () => {
  const ctx = (): ToolRunContext => ({ guildId: GUILD, channelId: CHANNEL, userId: USER, locale: 'fr', permissions: [], reply: async () => undefined });

  it('refuse hors serveur et quand aucun instantané n\u0027a jamais été archivé', async () => {
    const prisma = { auditLog: { findFirst: vi.fn().mockResolvedValue(null) } };
    const tool = buildLastSnapshotTool(prisma as never);
    expect(await tool.handler({}, { ...ctx(), guildId: null })).toEqual({ ok: false, summary: 'Contexte de serveur requis.' });
    expect(await tool.handler({}, ctx())).toEqual({ ok: false, summary: 'Aucun instantané archivé pour ce serveur.' });
    expect(prisma.auditLog.findFirst).toHaveBeenCalledWith({ where: { guildId: GUILD, action: 'server.snapshot' }, orderBy: { id: 'desc' } });
  });

  it('rend le dernier instantané et la demande qui l\u0027a précédé', async () => {
    const snapshot = { roles: [{ id: ROLE }] };
    const prisma = { auditLog: { findFirst: vi.fn().mockResolvedValue({ metadata: JSON.stringify({ requestId: 'req-abc', snapshot }) }) } };
    const result = await buildLastSnapshotTool(prisma as never).handler({}, ctx());
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('req-abc');
    expect(result.data).toEqual({ snapshot });
  });
});
