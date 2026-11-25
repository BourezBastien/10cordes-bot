import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';
import { DEFAULT_SHUTDOWN_GRACE_MS, SHUTDOWN_GRACE_MAX_MS, ShutdownService, shutdownGraceMs } from './shutdown.service';
import { awaitShutdownDrained, bindShutdown, trackForShutdown } from './shutdown.runtime';

/*
 * Extinction propre, et la sonde. Ce que fixent ces tests : la vidange ferme
 * les flux temps réel et la file, attend les travaux suivis dans un délai de
 * grâce, ne tourne qu'une fois ; la sonde rend 503 dès qu'un composant manque
 * ou que l'extinction a commencé. La base (PrismaService) a sa propre spec,
 * dans modules/database.
 */

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function harness(grace = '200') {
  const events = { closeAll: vi.fn(() => 2) };
  const queue = { activeCount: vi.fn(() => 1), close: vi.fn(async () => undefined) };
  const service = new ShutdownService({ SHUTDOWN_GRACE_MS: grace } as never, queue as never, events as never);
  service.onBoot();
  return { service, events, queue };
}

describe('shutdownGraceMs', () => {
  it.each([
    ['200', 200],
    [' 5000 ', 5_000],
    [undefined, DEFAULT_SHUTDOWN_GRACE_MS],
    ['', DEFAULT_SHUTDOWN_GRACE_MS],
    ['bientôt', DEFAULT_SHUTDOWN_GRACE_MS],
    ['0', DEFAULT_SHUTDOWN_GRACE_MS],
    ['-5', DEFAULT_SHUTDOWN_GRACE_MS],
    ['999999999', SHUTDOWN_GRACE_MAX_MS],
  ])('« %s » donne %i ms', (raw, expected) => {
    expect(shutdownGraceMs(raw)).toBe(expected);
  });
});

describe('ShutdownService', () => {
  afterEach(() => {
    vi.useRealTimers();
    bindShutdown({ isDraining: () => false, drained: async () => true, track: (work) => work });
  });

  it('un travail signalé par l’accesseur est suivi comme ceux du service, et rend tel quel', async () => {
    const { service } = harness();
    const track = vi.spyOn(service, 'track');
    const work = Promise.resolve('fait');
    await expect(trackForShutdown(work)).resolves.toBe('fait');
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(work);
  });

  it('sans extinction : rien ne se vide, et la base n\u0027a rien à attendre', async () => {
    const { service, events, queue } = harness();
    expect(service.isDraining()).toBe(false);
    expect(await awaitShutdownDrained()).toBe(true);
    expect(events.closeAll).not.toHaveBeenCalled();
    expect(queue.close).not.toHaveBeenCalled();
  });

  it('à l\u0027extinction : les flux se ferment, la file se ferme, les travaux suivis sont attendus, puis la base peut se fermer', async () => {
    const { service, events, queue } = harness();
    let finishChat: () => void = () => undefined;
    const chat = new Promise<void>((resolve) => {
      finishChat = resolve;
    });
    void service.track(chat);

    const shutdown = service.onShutdown();
    expect(service.isDraining()).toBe(true);
    expect(events.closeAll).toHaveBeenCalledTimes(1);
    expect(queue.close).toHaveBeenCalledTimes(1);

    // Tant que la conversation du panel tourne, la base attend.
    let baseMayClose: boolean | null = null;
    const base = awaitShutdownDrained().then((value) => {
      baseMayClose = value;
      return value;
    });
    await tick();
    expect(baseMayClose).toBeNull();

    finishChat();
    await shutdown;
    expect(await base).toBe(true);
  });

  it('le crochet ne vidange qu\u0027une fois, quand le framework le relance', async () => {
    const { service, queue } = harness();
    await Promise.all([service.onShutdown(), service.onShutdown()]);
    expect(queue.close).toHaveBeenCalledTimes(1);
  });

  it('au-delà du délai de grâce, l\u0027extinction renonce : ce qui restait est dit, et la suite suit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { service, queue } = harness('200');
    void service.track(new Promise<void>(() => undefined));
    const warned = vi.spyOn((service as unknown as { log: { warn: unknown } }).log as { warn: (...args: unknown[]) => void }, 'warn').mockImplementation(() => undefined);

    const shutdown = service.onShutdown();
    await vi.advanceTimersByTimeAsync(210);
    expect(await shutdown).toBe(undefined);
    expect(await awaitShutdownDrained()).toBe(false);
    expect(queue.activeCount).toHaveBeenCalled();
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('délai de grâce de 0 s dépassé'));
  });

  it('une fermeture de la file qui échoue n\u0027empêche pas l\u0027extinction', async () => {
    const queue = { activeCount: vi.fn(() => 0), close: vi.fn(async () => {
      throw new Error('connexion Redis perdue');
    }) };
    const service = new ShutdownService({ SHUTDOWN_GRACE_MS: '200' } as never, queue as never, { closeAll: () => 0 } as never);
    await expect(service.onShutdown()).resolves.toBeUndefined();
  });
});

describe('HealthController', () => {
  function mount(options: { db?: boolean; ready?: boolean; draining?: boolean } = {}) {
    const prisma = {
      $queryRaw: vi.fn(async () => {
        if (options.db === false) throw new Error('base fermée');
        return [1];
      }),
    };
    const queue = { counts: vi.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0 })), driverName: 'memory' };
    const client = { isReady: () => options.ready !== false };
    const shutdown = { isDraining: () => options.draining === true };
    const controller = new HealthController(prisma as never, queue as never, client as never, shutdown as never);
    const app = new Hono();
    app.get('/healthz', (ctx) => controller.health(ctx));
    return { app, prisma };
  }

  it('tout va bien : 200, et l\u0027état lu', async () => {
    const response = await mount().app.request('/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, gatewayReady: true, db: true, driver: 'memory', draining: false });
  });

  it.each([
    ['la base ne répond pas', { db: false }, { db: false }],
    ['la passerelle Discord n\u0027est pas prête', { ready: false }, { gatewayReady: false }],
    ['l\u0027extinction a commencé', { draining: true }, { db: true, gatewayReady: true, draining: true }],
  ])('%s : 503, et la cause lue', async (_label, options, cause) => {
    const response = await mount(options).app.request('/healthz');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, ...cause });
  });
});
