import { describe, expect, it, vi } from 'vitest';
import type { Guild, TextChannel } from 'discord.js';
import type { ToolRunContext } from '@10cordes/shared';
import { messageTools } from './message.tools';
import type { DiscordToolContext } from './tool-context';

/**
 * Tools sur les messages. Le bot a souvent le droit de pinguer tout le
 * serveur là où le demandeur ne l'a pas : sendMessage neutralise la mention
 * de masse pour qui ne peut pas la faire passer lui-même, et le lui dit.
 */

// Clé calculée : sync-tool-names.mjs repère une clé name suivie d'une chaîne.
const NAME = 'name';
const GUILD = '1550835980116824136';
const OWNER = '1550000000000000002';
const MEMBER = '1550000000000000003';
const CHANNEL = '1550000000000000004';
const NOTE = 'mentions @everyone et @here neutralisées';

function harness(permissions: string[], userId = MEMBER) {
  const send = vi.fn(async () => ({ id: 'message-1' }));
  const channel = { id: CHANNEL, send } as unknown as TextChannel;
  const guild = { id: GUILD, ownerId: OWNER, channels: { fetch: vi.fn(async () => channel) } } as unknown as Guild;
  const toolContext: DiscordToolContext = {
    guildOf: (ctx) => (ctx.guildId === GUILD ? guild : null),
    noGuild: () => ({ ok: false, summary: 'Contexte de serveur requis.' }),
    executeDirectOp: vi.fn(),
    textChannelOf: vi.fn(async () => channel),
  };
  const tool = messageTools(toolContext).find((entry) => entry[NAME] === 'sendMessage');
  const ctx: ToolRunContext = { guildId: GUILD, channelId: CHANNEL, userId, locale: 'fr', permissions, reply: async () => undefined };
  const post = (content: string) => tool?.handler({ channelId: CHANNEL, content }, ctx);
  return { send, post };
}

describe('sendMessage · mentions de masse', () => {
  it('un membre : la mention est neutralisée quelle que soit sa casse, et il le sait', async () => {
    const { send, post } = harness(['SendMessages']);
    const result = await post('Réunion @Everyone à 20 h, @here !');
    expect(result?.ok).toBe(true);
    expect(send).toHaveBeenCalledWith({ content: 'Réunion `Everyone` à 20 h, `here` !' });
    expect(result?.summary).toContain(NOTE);
  });

  it('un administrateur : le message part tel quel', async () => {
    const { send, post } = harness(['SendMessages', 'Administrator']);
    const result = await post('Réunion @everyone à 20 h');
    expect(send).toHaveBeenCalledWith({ content: 'Réunion @everyone à 20 h' });
    expect(result?.summary).not.toContain(NOTE);
  });

  it('le propriétaire du serveur, même sans permission relevée', async () => {
    const { send, post } = harness([], OWNER);
    await post('Réunion @everyone à 20 h');
    expect(send).toHaveBeenCalledWith({ content: 'Réunion @everyone à 20 h' });
  });

  it('un membre qui ne demande aucune mention de masse : rien à signaler', async () => {
    const { post } = harness(['SendMessages']);
    const result = await post('Réunion à 20 h, <#1550000000000000004>');
    expect(result?.summary).toBe('Message envoyé dans <#1550000000000000004>.');
  });
});
