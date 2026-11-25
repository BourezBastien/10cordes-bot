import { describe, expect, it, vi } from 'vitest';
import type { Message } from 'discord.js';
import { AssistantQueue } from './assistant.queue';
import type { AgentRequest } from './queue/types';
import type { QueueDriver } from './queue/queue-driver';
import { TypingIndicator } from './typing-indicator';

/**
 * File de l'agent : « écrit… » s'affiche dès l'acceptation d'une demande,
 * pendant l'attente en file, et s'éteint quand elle est soldée, réussie ou
 * non. Une demande refusée n'affiche rien.
 */

const GUILD = '1550000000000000001';
const USER = '1550000000000000002';

interface MessageLike extends Message {
  channel: Message['channel'] & { sendTyping: ReturnType<typeof vi.fn> };
}

function message(id: string, channelId: string): MessageLike {
  return {
    id,
    channelId,
    guildId: GUILD,
    content: `demande ${id}`,
    createdTimestamp: 1_700_000_000_000,
    author: { id: USER },
    channel: { isTextBased: () => true, sendTyping: vi.fn(async () => undefined) },
    reply: vi.fn(async () => ({})),
  } as unknown as MessageLike;
}

/** Un processeur que le test règle à la main : chaque demande attend son tour. */
function deferredProcessor() {
  const pending: Array<{ request: AgentRequest; resolve: () => void; reject: (error: Error) => void }> = [];
  let draining = false;
  const processor = vi.fn(
    (request: AgentRequest) =>
      new Promise<void>((resolve, reject) => {
        if (draining) resolve();
        else pending.push({ request, resolve, reject });
      }),
  );
  /** Vide la file : les demandes en cours et celles qui suivent se soldent toutes seules. */
  const drain = () => {
    draining = true;
    pending.forEach((entry) => entry.resolve());
  };
  return { processor, pending, drain };
}

function harness() {
  const typing = new TypingIndicator();
  const queue = new AssistantQueue({ REDIS_URL: '' } as never, typing);
  return { queue, typing, driver: (queue as never as { driver: QueueDriver }).driver };
}

const settled = (typing: TypingIndicator, expected: string[]) => vi.waitFor(() => expect(typing.activeChannels).toEqual(expected));

describe('AssistantQueue · indicateur « écrit… »', () => {
  it('s\u0027affiche à l\u0027acceptation, reste pendant le traitement, s\u0027éteint à la fin', async () => {
    const { queue, typing } = harness();
    const { processor, pending } = deferredProcessor();
    queue.setProcessor(processor);
    const msg = message('m1', 'c1');

    await queue.enqueueMessage(msg, false);
    expect(msg.channel.sendTyping).toHaveBeenCalledTimes(1);
    expect(typing.activeChannels).toEqual(['c1']);
    expect(pending).toHaveLength(1);

    pending[0]?.resolve();
    await settled(typing, []);
    expect(msg.channel.sendTyping).toHaveBeenCalledTimes(1);
  });

  it('une demande qui attend en file affiche déjà « écrit… »', async () => {
    const { queue, typing } = harness();
    const { processor, pending } = deferredProcessor();
    queue.setProcessor(processor);
    const first = message('m1', 'c1');
    const second = message('m2', 'c2');

    await queue.enqueueMessage(first, false);
    await queue.enqueueMessage(second, false);
    // La file est séquentielle : la seconde demande attend, son indicateur est déjà là.
    expect(pending).toHaveLength(1);
    expect([...typing.activeChannels].sort()).toEqual(['c1', 'c2']);
    expect(second.channel.sendTyping).toHaveBeenCalledTimes(1);

    pending[0]?.resolve();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(typing.activeChannels).toEqual(['c2']);

    pending[1]?.resolve();
    await settled(typing, []);
  });

  it('un traitement en échec éteint l\u0027indicateur', async () => {
    const { queue, typing } = harness();
    const { processor, pending } = deferredProcessor();
    queue.setProcessor(processor);
    await queue.enqueueMessage(message('m1', 'c1'), false);
    expect(typing.activeChannels).toEqual(['c1']);

    pending[0]?.reject(new Error('outil en panne'));
    await settled(typing, []);
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it('l\u0027indicateur est relâché sur la demande d\u0027origine, même si le traitement la réécrit', async () => {
    const { queue, typing } = harness();
    // Ce que fait le coalescing : il remplace le message de la demande en cours.
    const { processor, pending } = deferredProcessor();
    queue.setProcessor(async (request) => {
      await processor(request);
      request.messageId = 'message-plus-recent';
      request.content = 'demande fusionnée';
    });
    await queue.enqueueMessage(message('m1', 'c1'), false);
    expect(typing.activeChannels).toEqual(['c1']);

    pending[0]?.resolve();
    await settled(typing, []);
  });
});

describe('AssistantQueue · une demande refusée n\u0027affiche rien', () => {
  it('agent pas encore prêt', async () => {
    const { queue, typing } = harness();
    const msg = message('m1', 'c1');
    expect(await queue.enqueueMessage(msg, false)).toBe(false);
    expect(typing.activeChannels).toEqual([]);
    expect(msg.channel.sendTyping).not.toHaveBeenCalled();
    expect(msg.reply).toHaveBeenCalledTimes(1);
  });

  it('file saturée', async () => {
    const { queue, typing, driver } = harness();
    const { processor } = deferredProcessor();
    queue.setProcessor(processor);
    driver.counts = vi.fn(async () => ({ waiting: 200, active: 0, completed: 0, failed: 0 }));
    const msg = message('m1', 'c1');
    expect(await queue.enqueueMessage(msg, false)).toBe(false);
    expect(typing.activeChannels).toEqual([]);
    expect(msg.channel.sendTyping).not.toHaveBeenCalled();
  });

  it('trop de demandes du même membre', async () => {
    const { queue, typing } = harness();
    const { processor, pending, drain } = deferredProcessor();
    queue.setProcessor(processor);
    await queue.enqueueMessage(message('m1', 'c1'), false);
    for (let index = 2; index <= 10; index += 1) await queue.enqueueMessage(message(`m${index}`, 'c1'), false);
    const oneTooMany = message('m11', 'c2');
    expect(await queue.enqueueMessage(oneTooMany, false)).toBe(false);
    expect(typing.activeChannels).toEqual(['c1']);
    expect(pending).toHaveLength(1);

    drain();
    await settled(typing, []);
    expect(processor).toHaveBeenCalledTimes(10);
  });

  it('le driver refuse l\u0027ajout : l\u0027indicateur repart', async () => {
    const { queue, typing, driver } = harness();
    const { processor } = deferredProcessor();
    queue.setProcessor(processor);
    driver.enqueue = vi.fn(async () => {
      throw new Error('redis injoignable');
    });
    await expect(queue.enqueueMessage(message('m1', 'c1'), false)).rejects.toThrow('redis injoignable');
    expect(typing.activeChannels).toEqual([]);
    expect(processor).not.toHaveBeenCalled();
  });
});

describe('AssistantQueue · extinction', () => {
  it('à la fermeture : le traitement en cours finit et est attendu, les demandes en attente sont abandonnées, plus rien n\u0027est accepté', async () => {
    const { queue, typing } = harness();
    const { processor, pending, drain } = deferredProcessor();
    queue.setProcessor(processor);
    await queue.enqueue(message('1', 'c1'));
    await queue.enqueue(message('2', 'c1'));
    await queue.enqueue(message('3', 'c1'));
    expect(queue.activeCount()).toBe(1);
    const late = message('4', 'c1');

    let closed = false;
    const closing = queue.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(queue.isClosing()).toBe(true);
    // Le traitement en cours n'est pas coupé : la fermeture l'attend.
    expect(closed).toBe(false);
    expect(processor).toHaveBeenCalledTimes(1);
    await settled(typing, []);

    expect(await queue.enqueue(late)).toBe(false);
    // Une notice Components V2 : le texte est dans son affichage de texte.
    const refused = vi.mocked(late.reply).mock.calls[0]?.[0] as { components: Array<{ toJSON(): unknown }> };
    expect(JSON.stringify(refused.components[0]?.toJSON())).toContain('redémarre');

    drain();
    await closing;
    expect(closed).toBe(true);
    expect(queue.activeCount()).toBe(0);
    // Les deux demandes en attente n'ont pas été prises (la mémoire les perd).
    expect(pending).toHaveLength(1);
    expect(processor).toHaveBeenCalledTimes(1);
  });
});
