import { describe, expect, it, vi } from 'vitest';
import type { TextChannel } from 'discord.js';
import { isSilenceRequested, ReplySession } from './reply-session';

/**
 * État d'une réponse en cours : silence demandé et publication progressive.
 * Un stream qui continue après une mention de masse est un incident.
 */

const MESSAGE = '1550000000000000010';

function channel(): TextChannel {
  return {
    send: vi.fn(async () => ({ id: 'status-1' })),
    messages: { edit: vi.fn(async () => ({})) },
  } as unknown as TextChannel;
}

describe('isSilenceRequested · filet déterministe', () => {
  it('reconnaît une demande explicite de silence, en français comme en anglais', () => {
    expect(isSilenceRequested('purge les messages sans me répondre')).toBe(true);
    expect(isSilenceRequested('fais-le sans répondre')).toBe(true);
    expect(isSilenceRequested('ne me réponds pas, agis')).toBe(true);
    expect(isSilenceRequested('do it without any reply')).toBe(true);
    expect(isSilenceRequested('do it without replies')).toBe(true);
  });

  it('laisse une demande normale ouvrir le stream', () => {
    expect(isSilenceRequested('résume-moi les statistiques')).toBe(false);
    expect(isSilenceRequested('purge les messages')).toBe(false);
  });
});

describe('ReplySession · silence et stream', () => {
  it('une demande silencieuse désactive le stream dès le départ', () => {
    const session = new ReplySession(channel(), MESSAGE, true);
    expect(session.silent).toBe(true);
    expect(session.streamingActive).toBe(false);
    expect(session.responder.published).toBe(false);
  });

  it('le tool skipReply coupe le stream et impose le silence', () => {
    const session = new ReplySession(channel(), MESSAGE, false);
    session.pushDelta('Voilà');
    expect(session.streamingActive).toBe(true);
    session.requestSilence();
    expect(session.silent).toBe(true);
    expect(session.streamingActive).toBe(false);
    expect(session.responder.published).toBe(false);
  });

  it.each(['attention @everyone', 'ping @here', '[PANEL] Titre'])('le texte interdit « %s » coupe le stream avant publication', (text) => {
    const session = new ReplySession(channel(), MESSAGE, false);
    session.pushDelta('Bonjour, ');
    session.pushDelta(text);
    expect(session.streamingActive).toBe(false);
    expect(session.responder.published).toBe(false);
    session.requestSilence();
  });

  it('un texte normal laisse le stream actif', () => {
    const session = new ReplySession(channel(), MESSAGE, false);
    session.pushDelta('Une réponse tout à fait normale.');
    expect(session.streamingActive).toBe(true);
    session.requestSilence();
  });
});
