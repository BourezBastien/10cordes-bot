import { describe, expect, it, vi } from 'vitest';
import type { TextChannel } from 'discord.js';
import { executeComponentAction } from './registry';
import { registerDefaultComponentExecutors } from './default-executors';

/**
 * Actions de composant. Leur texte a été écrit par le modèle : une mention de
 * masse n'y pingue que pour un administrateur.
 */

const GUILD = '1550835980116824136';
const OWNER = '1550000000000000002';
const MEMBER = '1550000000000000003';
const CHANNEL = '1550000000000000004';

registerDefaultComponentExecutors();

async function reply(permissions: string[], userId = MEMBER) {
  const send = vi.fn(async () => ({ id: 'message-1' }));
  const channel = { isDMBased: () => false, isTextBased: () => true, send } as unknown as TextChannel;
  const interaction = {
    channel,
    user: { id: userId },
    guild: { ownerId: OWNER },
    memberPermissions: { toArray: () => permissions },
  };
  const confirmation = await executeComponentAction({ type: 'reply', message: 'Sortie @Everyone dimanche' } as never, {
    interaction: interaction as never,
    guildId: GUILD,
    channelId: CHANNEL,
    member: null,
    messageId: '1550000000000000005',
  });
  return { send, confirmation };
}

describe('action de composant « reply » · mentions de masse', () => {
  it('un membre : la mention est neutralisée', async () => {
    const { send, confirmation } = await reply([]);
    expect(send).toHaveBeenCalledWith({ content: 'Sortie `Everyone` dimanche' });
    expect(confirmation).toBe('Message posté dans le salon.');
  });

  it.each([
    ['un administrateur', ['Administrator'], MEMBER],
    ['le propriétaire du serveur', [], OWNER],
  ])('%s : le message part tel quel', async (_label, permissions, userId) => {
    const { send } = await reply(permissions, userId);
    expect(send).toHaveBeenCalledWith({ content: 'Sortie @Everyone dimanche' });
  });
});
