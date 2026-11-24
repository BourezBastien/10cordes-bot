import { describe, expect, it, vi } from 'vitest';
import { ChannelType, type TextChannel } from 'discord.js';
import { JobsExecutor } from './jobs.executor';

/**
 * Exécution des tâches planifiées. Le système exécute la tâche sans savoir
 * qui l'a demandée : une mention de masse dans son texte ne pingue jamais.
 */

const GUILD = '1550835980116824136';
const CHANNEL = '1550000000000000002';

function executor() {
  const send = vi.fn(async () => ({ id: 'message-1' }));
  const channel = {
    id: CHANNEL,
    type: ChannelType.GuildText,
    send,
    guild: { members: { me: { id: 'bot' } } },
    permissionsFor: () => ({ has: () => true }),
  } as unknown as TextChannel;
  const prisma = { scheduledJob: { update: vi.fn().mockResolvedValue({}) } };
  const client = { guilds: { cache: new Map([[GUILD, { memberCount: 12 }]]) }, channels: { fetch: vi.fn(async () => channel) } };
  return { send, prisma, jobs: new JobsExecutor(prisma as never, client as never, { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never) };
}

describe('JobsExecutor · message d\u0027une tâche planifiée', () => {
  it('la mention de masse est neutralisée, la tâche se termine sans erreur', async () => {
    const { send, prisma, jobs } = executor();
    await jobs.executeJob(GUILD, GUILD, 'annonce', JSON.stringify([{ type: 'sendMessage', channelId: CHANNEL, content: 'Réunion @Everyone à 20 h' }]));
    expect(send).toHaveBeenCalledWith({ content: 'Réunion `Everyone` à 20 h' });
    // Sans erreur, la tâche ne porte aucune erreur.
    expect(prisma.scheduledJob.update).toHaveBeenCalledWith({ where: { id: GUILD }, data: { lastRunAt: expect.any(Date) } });
  });

  it('un texte sans mention de masse est rendu tel quel', async () => {
    const { send, jobs } = executor();
    await jobs.executeJob(GUILD, GUILD, 'annonce', JSON.stringify([{ type: 'sendMessage', channelId: CHANNEL, content: 'Bonjour à tous' }]));
    expect(send).toHaveBeenCalledWith({ content: 'Bonjour à tous' });
  });
});
