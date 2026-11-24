import { describe, expect, it, vi } from 'vitest';
import type { Message } from 'discord.js';
import { InvestigationPolicy, investigationPolicy, READING_LINE } from './investigation.policy';
import { LiveStatus } from './live-status';

/**
 * Investigation silencieuse (transposée de discord-agent) : une lecture de
 * recherche ne se raconte pas appel par appel. La ligne de statut le dit une
 * fois, puis se tait ; ce qui touche au serveur, lui, continue de se narrater.
 */

/** Salon factice : un seul message de statut, édité en place puis supprimé. */
function channel() {
  const edit = vi.fn(async () => undefined);
  const send = vi.fn(async (_opts: { content: string }) => ({ id: 'status-1', edit, delete: vi.fn(async () => undefined) }));
  return { send, edit, raw: { send } as unknown as { send: (opts: { content: string }) => Promise<Message> } };
}

const textShown = (spy: ReturnType<typeof vi.fn>): string[] => spy.mock.calls.map(([payload]) => (payload as { content: string }).content);

describe('InvestigationPolicy · lectures qui se taisent', () => {
  it.each(['searchInternet', 'searchWikipedia', 'getNews', 'readRssFeed', 'http.fetch', 'githubRepo', 'channel.history.search', 'web.search', 'readMessages'])( '%s est une lecture de recherche', (tool) => {
    expect(investigationPolicy.isQuietRead(tool)).toBe(true);
    expect(investigationPolicy.narrates(tool)).toBe(false);
  });

  it.each(['deleteChannel', 'createChannel', 'getChannels', 'getServerInfo', 'analyzeActivity', 'surface.create', 'records.create', 'announceStep', 'search_tools', 'search_skills'])( '%s continue de se raconter : une action ou une lecture du serveur reste visible', (tool) => {
    expect(investigationPolicy.isQuietRead(tool)).toBe(false);
    expect(investigationPolicy.narrates(tool)).toBe(true);
  });

  it('le singleton est bien une instance de la policy', () => {
    expect(investigationPolicy).toBeInstanceOf(InvestigationPolicy);
  });
});

describe('LiveStatus · ligne de lecture', () => {
  it('dit une fois qu\u0027elle consulte ses sources, puis ne bouge plus', async () => {
    const io = channel();
    const status = new LiveStatus(io.raw);
    await status.reading();
    await status.reading();
    await status.reading();
    expect(io.send).toHaveBeenCalledTimes(1);
    expect(io.edit).not.toHaveBeenCalled();
    expect(textShown(io.send)).toEqual([READING_LINE]);
  });

  it('une action commencée avant la lecture garde sa ligne [TOOL]', async () => {
    const io = channel();
    const status = new LiveStatus(io.raw);
    await status.step('createChannel');
    await status.reading();
    expect(textShown(io.send)).toEqual(['[TOOL] createChannel']);
    expect(io.edit).not.toHaveBeenCalled();
  });

  it('une lecture suivie d\u0027une action raconte l\u0027action, puis se tait de nouveau', async () => {
    const io = channel();
    const status = new LiveStatus(io.raw);
    await status.reading();
    await status.step('createChannel');
    await status.reading();
    await status.step('announceStep');
    expect(textShown(io.send)).toEqual([READING_LINE]);
    expect(textShown(io.edit)).toEqual(['[TOOL] createChannel', '[TOOL] announceStep']);
  });

  it('la ligne de lecture remplace le timer [THINKING] : elle n\u0027attend pas 3 s', async () => {
    const io = channel();
    const status = new LiveStatus(io.raw);
    status.arm();
    await status.reading();
    expect(textShown(io.send)).toEqual([READING_LINE]);
  });

  it('après le ménage de fin de demande, une nouvelle lecture se raconte de nouveau', async () => {
    const io = channel();
    const status = new LiveStatus(io.raw);
    await status.reading();
    await status.done();
    await status.reading();
    expect(io.send).toHaveBeenCalledTimes(2);
    expect(textShown(io.send)).toEqual([READING_LINE, READING_LINE]);
  });
});
