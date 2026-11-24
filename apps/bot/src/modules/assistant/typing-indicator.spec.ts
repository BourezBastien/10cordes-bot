import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TYPING_MAX_HOLD_MS, TYPING_REFRESH_MS, TypingIndicator, type TypingChannel } from './typing-indicator';

/**
 * Indicateur « écrit… » : la seule trace visible d'une demande en cours.
 * Discord l'efface au bout de 10 secondes : il faut le relancer, et l'éteindre
 * quand la dernière demande du salon est soldée.
 */

type Channel = TypingChannel & { sendTyping: ReturnType<typeof vi.fn> };

const channel = (): Channel => ({ sendTyping: vi.fn(async () => undefined) });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TypingIndicator · relance', () => {
  it('affiche « écrit » tout de suite, puis toutes les 8 secondes, et s\u0027arrête au relâche', () => {
    const typing = new TypingIndicator();
    const salon = channel();
    const release = typing.hold('c1', salon);
    expect(salon.sendTyping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(TYPING_REFRESH_MS);
    expect(salon.sendTyping).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(TYPING_REFRESH_MS * 3);
    expect(salon.sendTyping).toHaveBeenCalledTimes(5);

    release();
    vi.advanceTimersByTime(TYPING_REFRESH_MS * 5);
    expect(salon.sendTyping).toHaveBeenCalledTimes(5);
    expect(typing.activeChannels).toEqual([]);
  });

  it('la relance reste sous les 10 secondes de Discord, même en avançant de moins qu\u0027un intervalle', () => {
    const typing = new TypingIndicator();
    const salon = channel();
    typing.hold('c1', salon);
    for (let step = 0; step < 5; step += 1) vi.advanceTimersByTime(2_000);
    expect(salon.sendTyping).toHaveBeenCalledTimes(2);
    expect(TYPING_REFRESH_MS).toBeLessThan(10_000);
  });
});

describe('TypingIndicator · plusieurs demandes, plusieurs salons', () => {
  it('deux demandes du même salon : un seul indicateur, éteint par la dernière relâchée', () => {
    const typing = new TypingIndicator();
    const salon = channel();
    const premiere = typing.hold('c1', salon);
    const seconde = typing.hold('c1', channel());
    expect(salon.sendTyping).toHaveBeenCalledTimes(1);

    premiere();
    vi.advanceTimersByTime(TYPING_REFRESH_MS);
    expect(salon.sendTyping).toHaveBeenCalledTimes(2);
    expect(typing.activeChannels).toEqual(['c1']);

    seconde();
    vi.advanceTimersByTime(TYPING_REFRESH_MS * 3);
    expect(salon.sendTyping).toHaveBeenCalledTimes(2);
    expect(typing.activeChannels).toEqual([]);
  });

  it('deux salons sont indépendants', () => {
    const typing = new TypingIndicator();
    const a = channel();
    const b = channel();
    const releaseA = typing.hold('a', a);
    typing.hold('b', b);
    vi.advanceTimersByTime(TYPING_REFRESH_MS);
    expect(a.sendTyping).toHaveBeenCalledTimes(2);
    expect(b.sendTyping).toHaveBeenCalledTimes(2);

    releaseA();
    vi.advanceTimersByTime(TYPING_REFRESH_MS);
    expect(a.sendTyping).toHaveBeenCalledTimes(2);
    expect(b.sendTyping).toHaveBeenCalledTimes(3);
    expect(typing.activeChannels).toEqual(['b']);
  });
});

describe('TypingIndicator · une part relâchée ne gêne jamais les autres', () => {
  it('le relâche est idempotent', () => {
    const typing = new TypingIndicator();
    const salon = channel();
    const release = typing.hold('c1', salon);
    release();
    release();
    expect(typing.activeChannels).toEqual([]);
  });

  it('un second relâche n\u0027éteint pas l\u0027indicateur d\u0027une demande plus récente du même salon', () => {
    const typing = new TypingIndicator();
    const salon = channel();
    const ancienne = typing.hold('c1', salon);
    ancienne();
    const recente = typing.hold('c1', salon);

    ancienne();
    vi.advanceTimersByTime(TYPING_REFRESH_MS);
    expect(salon.sendTyping).toHaveBeenCalledTimes(3);
    expect(typing.activeChannels).toEqual(['c1']);

    recente();
    vi.advanceTimersByTime(TYPING_REFRESH_MS);
    expect(salon.sendTyping).toHaveBeenCalledTimes(3);
    expect(typing.activeChannels).toEqual([]);
  });

  it('une part jamais relâchée (traitement tué) s\u0027éteint toute seule au bout de 30 minutes', () => {
    const typing = new TypingIndicator();
    const salon = channel();
    typing.hold('c1', salon);
    vi.advanceTimersByTime(TYPING_MAX_HOLD_MS);
    const avant = salon.sendTyping.mock.calls.length;
    expect(avant).toBeGreaterThan(200);

    vi.advanceTimersByTime(TYPING_REFRESH_MS * 4);
    expect(salon.sendTyping).toHaveBeenCalledTimes(avant);
    expect(typing.activeChannels).toEqual([]);
  });
});

describe('TypingIndicator · du mieux possible', () => {
  it('un salon qui refuse l\u0027indicateur n\u0027arrête rien', async () => {
    const typing = new TypingIndicator();
    const refuse: Channel = { sendTyping: vi.fn(async () => Promise.reject(new Error('Missing Permissions'))) };
    const casse: Channel = { sendTyping: vi.fn(() => {
      throw new TypeError('salon parti');
    }) };
    typing.hold('refuse', refuse);
    typing.hold('casse', casse);
    vi.advanceTimersByTime(TYPING_REFRESH_MS);
    await Promise.resolve();
    expect(refuse.sendTyping).toHaveBeenCalledTimes(2);
    expect(casse.sendTyping).toHaveBeenCalledTimes(2);
    expect(typing.activeChannels).toEqual(['refuse', 'casse']);
  });
});
