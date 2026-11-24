import { describe, expect, it } from 'vitest';
import { isSilenceRequested, ReplySession } from './reply-session';

/**
 * État d'une réponse en cours : la seule chose qu'une demande impose à sa
 * livraison, le silence. La session n'a pas accès au salon : rien ne peut
 * s'y afficher entre la demande et la réponse finale.
 */

describe('isSilenceRequested · filet déterministe', () => {
  it('reconnaît une demande explicite de silence, en français comme en anglais', () => {
    expect(isSilenceRequested('purge les messages sans me répondre')).toBe(true);
    expect(isSilenceRequested('fais-le sans répondre')).toBe(true);
    expect(isSilenceRequested('ne me réponds pas, agis')).toBe(true);
    expect(isSilenceRequested('do it without any reply')).toBe(true);
    expect(isSilenceRequested('do it without replies')).toBe(true);
  });

  it('laisse une demande normale recevoir sa réponse', () => {
    expect(isSilenceRequested('résume-moi les statistiques')).toBe(false);
    expect(isSilenceRequested('purge les messages')).toBe(false);
  });
});

describe('ReplySession · silence', () => {
  it('une demande silencieuse est silence dès le départ', () => {
    expect(new ReplySession(true).silent).toBe(true);
    expect(new ReplySession(false).silent).toBe(false);
  });

  it('le tool skipReply impose le silence pour toute la demande', () => {
    const session = new ReplySession(false);
    session.requestSilence();
    expect(session.silent).toBe(true);
    session.requestSilence();
    expect(session.silent).toBe(true);
  });

  it('la session ne porte aucun accès au salon : rien à afficher pendant le traitement', () => {
    expect(Object.keys(new ReplySession(false))).toEqual(['silent']);
    expect(Object.getOwnPropertyNames(ReplySession.prototype).sort()).toEqual(['constructor', 'requestSilence']);
  });
});
