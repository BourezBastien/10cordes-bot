import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import type { ConversationContext } from './conversation-context';
import { LlmFormatLeakError, ProviderAuthError, QuotaExhaustedError } from './llm.errors';
import { ReplyDelivery } from './reply-delivery';
import type { ReplyRunOutcome } from './reply-runner';
import { ReplySession } from './reply-session';
import type { ResponseCacheService } from './response-cache.service';

/**
 * Livraison d'une réponse : le SEUL endroit qui écrit la réponse d'une
 * demande. Il envoie la réponse finale, une fois, adressée au message
 * d'origine, et rien d'autre : aucune ligne de statut, aucun brouillon.
 */

const GUILD = '1550000000000000001';
const USER = '1550000000000000002';
const OWNER = '1550000000000000009';
const MESSAGE = '1550000000000000010';

type Send = ReturnType<typeof vi.fn>;

function conversation(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    channel: { send: vi.fn(async () => ({ id: 'sent-1' })) },
    guild: { id: GUILD, ownerId: OWNER },
    request: { guildId: GUILD, channelId: 'c1', userId: USER, authorName: 'Quelqu\u0027un', content: 'une question', messageId: MESSAGE, repliesToBot: false },
    requestId: 'req-test',
    locale: 'fr',
    permissions: [],
    session: new ReplySession(false),
    ...overrides,
  } as unknown as ConversationContext;
}

const sends = (context: ConversationContext) => (context.channel as unknown as { send: Send }).send;

function harness() {
  const audit = { record: vi.fn() };
  const responseCache = { get: vi.fn((): string | null => null), put: vi.fn() };
  const delivery = new ReplyDelivery({ audit: audit as unknown as AuditService, responseCache: responseCache as unknown as ResponseCacheService });
  return { audit, responseCache, delivery };
}

const run = (overrides: Partial<ReplyRunOutcome> = {}): ReplyRunOutcome => ({ finalText: 'Voilà.', executed: [], usage: { promptTokens: 3, completionTokens: 2 }, turns: 1, error: null, ...overrides });

const addressed = { reply: { messageReference: MESSAGE, failIfNotExists: false } };

describe('ReplyDelivery · la réponse finale, une fois, adressée', () => {
  it('un seul envoi, qui répond au message de la demande', async () => {
    const { delivery, audit } = harness();
    const context = conversation();
    await delivery.deliver(context, run());

    const send = sends(context);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ content: 'Voilà.', ...addressed });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ guildId: GUILD, action: 'assistant.reply', actorId: USER, metadata: expect.objectContaining({ requestId: 'req-test', tools: 0 }) }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'llm.usage', metadata: expect.objectContaining({ requestId: 'req-test', promptTokens: 3, completionTokens: 2, turns: 1 }) }));
  });

  it('la comptabilité porte le nombre de tours de la demande', async () => {
    const { delivery, audit } = harness();
    await delivery.deliver(conversation(), run({ turns: 4 }));
    const usage = audit.record.mock.calls.map((call) => call[0]).find((row) => row.action === 'llm.usage');
    expect(usage.metadata.turns).toBe(4);
  });

  it('une réponse plus longue qu\u0027un message est découpée : seul le premier morceau est adressé, rien n\u0027est coupé au milieu d\u0027un mot', async () => {
    const { delivery } = harness();
    const context = conversation();
    await delivery.deliver(context, run({ finalText: `${'a'.repeat(1900)} ${'b'.repeat(700)}` }));

    const send = sends(context);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toEqual({ content: `${'a'.repeat(1900)} `, ...addressed });
    expect(send.mock.calls[1]?.[0]).toEqual({ content: 'b'.repeat(700) });
  });

  it('une réponse de 1300 caractères tient en un seul message', async () => {
    const { delivery } = harness();
    const context = conversation();
    await delivery.deliver(context, run({ finalText: 'a'.repeat(1300) }));
    expect(sends(context)).toHaveBeenCalledTimes(1);
  });

  it('si la réponse adressée échoue (message d\u0027origine parti), le morceau part nu', async () => {
    const { delivery } = harness();
    const send = vi.fn(async (payload: { reply?: unknown }) => {
      if (payload.reply) throw new Error('Unknown message');
      return { id: 'sent-2' };
    });
    const context = conversation({ channel: { send } as unknown as ConversationContext['channel'] });
    await delivery.deliver(context, run());
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual({ content: 'Voilà.' });
  });

  it('le préfixe [PANEL] du modèle n\u0027est jamais montré', async () => {
    const { delivery } = harness();
    const context = conversation();
    await delivery.deliver(context, run({ finalText: '[PANEL] ## Classement\n- premier' }));
    expect(sends(context)).toHaveBeenCalledWith({ content: '## Classement\n- premier', ...addressed });
  });

  it('des tools sans texte final : rien n\u0027est inventé, les résultats sont déjà visibles', async () => {
    const { delivery, audit } = harness();
    const context = conversation();
    await delivery.deliver(context, run({ finalText: null, executed: ['createChannel'] }));
    expect(sends(context)).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'assistant.reply', metadata: expect.objectContaining({ tools: 1 }) }));
  });

  it('aucun tool et aucun texte : « Fait. »', async () => {
    const { delivery } = harness();
    const context = conversation();
    await delivery.deliver(context, run({ finalText: null }));
    expect(sends(context)).toHaveBeenCalledWith({ content: 'Fait.', ...addressed });
  });
});

describe('ReplyDelivery · silence et mentions', () => {
  it('silence demandé : aucun message, et l\u0027audit le dit', async () => {
    const { delivery, audit } = harness();
    const context = conversation({ session: new ReplySession(true) });
    await delivery.deliver(context, run({ executed: ['deleteChannel'] }));
    expect(sends(context)).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'assistant.reply', metadata: expect.objectContaining({ silent: true, tools: 'deleteChannel' }) }));
  });

  it.each([
    ['un membre', [], false],
    ['un administrateur', ['Administrator'], true],
  ])('mention de masse demandée par %s : conservée seulement avec le droit', async (_label, permissions, kept) => {
    const { delivery } = harness();
    const context = conversation({ permissions });
    await delivery.deliver(context, run({ finalText: 'Attention @everyone et @here.' }));
    expect(sends(context)).toHaveBeenCalledWith({
      content: kept ? 'Attention @everyone et @here.' : 'Attention `everyone` et `here`.',
      ...addressed,
    });
  });

  it('le propriétaire du serveur garde la mention de masse', async () => {
    const { delivery } = harness();
    const context = conversation({ request: { ...conversation().request, userId: OWNER } });
    await delivery.deliver(context, run({ finalText: 'Alerte @everyone' }));
    expect(sends(context)).toHaveBeenCalledWith({ content: 'Alerte @everyone', ...addressed });
  });

  it('la casse ne passe plus : @Everyone et @HERE sont neutralisés eux aussi', async () => {
    const { delivery } = harness();
    const context = conversation();
    await delivery.deliver(context, run({ finalText: 'Alerte @Everyone et @HERE' }));
    expect(sends(context)).toHaveBeenCalledWith({ content: 'Alerte `Everyone` et `HERE`', ...addressed });
  });
});

describe('ReplyDelivery · une erreur ne reste jamais silencieuse', () => {
  it.each([
    [new QuotaExhaustedError(), 'quota'],
    [new ProviderAuthError(), 'auth'],
    [new LlmFormatLeakError('<|tool_call|>'), 'format'],
    [new Error('outil en panne'), 'generic'],
  ])('%s : une notice avec la référence de la demande', async (error, kind) => {
    const { delivery, audit } = harness();
    const context = conversation();
    await delivery.deliver(context, run({ finalText: null, error: error as Error }));

    const send = sends(context);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(send.mock.calls[0]?.[0])).toContain('req-test');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'assistant.error', metadata: expect.objectContaining({ requestId: 'req-test', kind }) }));
  });
});

describe('ReplyDelivery · réponse en cache', () => {
  it('une question déjà posée est servie sans boucle, adressée', async () => {
    const { delivery, audit, responseCache } = harness();
    responseCache.get.mockReturnValue('Réponse déjà donnée.');
    const context = conversation();
    expect(await delivery.deliverCached(context)).toBe(true);
    expect(sends(context)).toHaveBeenCalledWith({ content: 'Réponse déjà donnée.', ...addressed });
    expect(responseCache.get).toHaveBeenCalledWith(GUILD, 'une question');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'llm.cache.hit' }));
  });

  it('sans cache, ou pour une demande silencieuse : la boucle prend le relais', async () => {
    const { delivery, responseCache } = harness();
    expect(await delivery.deliverCached(conversation())).toBe(false);
    responseCache.get.mockReturnValue('Réponse déjà donnée.');
    expect(await delivery.deliverCached(conversation({ session: new ReplySession(true) }))).toBe(false);
    expect(sends(conversation())).not.toHaveBeenCalled();
  });

  it('une réponse de pure conversation est gardée en cache, une réponse avec tool non', async () => {
    const { delivery, responseCache } = harness();
    await delivery.deliver(conversation(), run());
    expect(responseCache.put).toHaveBeenCalledWith(GUILD, 'une question', 'Voilà.');
    responseCache.put.mockClear();
    await delivery.deliver(conversation(), run({ executed: ['getChannels'] }));
    expect(responseCache.put).not.toHaveBeenCalled();
  });
});
