import { describe, expect, it } from 'vitest';
import { describeMetadata, entryKind, journalRows } from '@/pages/guild/journal';
import type { AuditEntry } from '@/lib/schemas';

/* Le journal : la nature d'une entrée suit la règle du filtre du serveur. */

const entry = (action: string, metadata = '{}'): AuditEntry => ({
  id: `id-${action}`,
  action,
  actorId: '1550835980116824999',
  metadata,
  createdAt: '2026-11-25T08:00:00.000Z',
});

describe('entryKind', () => {
  it('range les plans, les erreurs du bot, les outils, et le reste en actions', () => {
    expect(entryKind('plan.posted')).toBe('plan');
    expect(entryKind('plan.rejected')).toBe('plan');
    expect(entryKind('assistant.error')).toBe('error');
    expect(entryKind('tool.denied.records.delete')).toBe('error');
    expect(entryKind('rule.confirm.denied')).toBe('error');
    expect(entryKind('assistant.tool.records.list')).toBe('tool');
    expect(entryKind('module.enable')).toBe('action');
    expect(entryKind('agent.action.denied')).toBe('action');
  });

  it('un outil en échec reste un outil : son résumé le dit', () => {
    expect(entryKind('assistant.tool.records.delete')).toBe('tool');
  });
});

describe('describeMetadata', () => {
  it('rend le résumé quand il y en a un, et rien sinon', () => {
    expect(describeMetadata('{"summary": "3 fiches lues", "ok": true}')).toEqual({ summary: '3 fiches lues' });
    expect(describeMetadata('{"ok": false}')).toEqual({ summary: null });
    expect(describeMetadata('pas du json')).toEqual({ summary: null });
    expect(describeMetadata('[]')).toEqual({ summary: null });
  });
});

describe('journalRows', () => {
  it('donne à chaque ligne son heure, son badge, son texte et son auteur', () => {
    const rows = journalRows(
      [entry('assistant.tool.records.list', '{"summary": "3 fiches", "ok": true}'), entry('module.enable')],
      () => '08:00:00',
      (kind) => kind.toUpperCase(),
      'Système',
    );
    expect(rows[0]).toMatchObject({ time: '08:00:00', badge: 'TOOL', tone: 'info', text: 'assistant.tool.records.list · 3 fiches', meta: '…824999' });
    expect(rows[1]).toMatchObject({ badge: 'ACTION', tone: 'neutral', text: 'module.enable' });
  });
});
