import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import Redis from 'ioredis';
import { AppEnv } from '../../app.env';

/**
 * ICacheStore (Phase 2.4) : cache TEMPS RÉEL critique derrière une interface,
 * avec fallback mémoire automatique si REDIS_URL est absent (dev/CI).
 *
 * Consommateurs : fenêtres glissantes (anti-raid/anti-spam), verrous CAS
 * (SET NX EX, « premier clic gagnant »), cooldowns PAR UTILISATEUR des
 * bindings, mini-cache ghost-ping (messages avec mentions, TTL 60 s),
 * SkillPatternDetector. JAMAIS SQLite pour ces usages (race conditions).
 *
 * Implémentation Redis : ZADD/ZREMRANGEBYSCORE/ZCARD pour les fenêtres,
 * SET NX EX pour les verrous, INCR+EXPIRE pour les compteurs.
 */
export interface CacheStore {
  /** Incrémente un compteur clé (retourne la nouvelle valeur) avec TTL. */
  incr(key: string, ttlSec: number): Promise<number>;
  /** Valeur d'une clé (string) ou null. */
  get(key: string): Promise<string | null>;
  /** Poser une valeur avec TTL. */
  set(key: string, value: string, ttlSec: number): Promise<void>;
  /**
   * Fenêtre glissante : enregistre un événement `now` et retourne le nombre
   * d'événements de la clé dans les dernières `windowSec` secondes.
   */
  windowIncr(key: string, windowSec: number): Promise<number>;
  /**
   * CAS atomique : pose la valeur si ABSENTE et retourne true (le gagnant) ;
   * false si déjà posée. Exactement un gagnant par clé tant que le TTL vit.
   */
  claimOnce(key: string, value: string, ttlSec: number): Promise<boolean>;
  /** Supprime une clé (libération explicite). */
  del(key: string): Promise<void>;
}

/** Fallback mémoire (dev sans Redis) : sémantique identique, mono-process. */
class MemoryCacheStore implements CacheStore {
  private readonly counters = new Map<string, { value: number; expiresAt: number }>();
  private readonly values = new Map<string, { value: string; expiresAt: number }>();
  private readonly windows = new Map<string, number[]>();
  private readonly locks = new Map<string, number>();

  private sweep(map: Map<string, { expiresAt: number }>): void {
    const now = Date.now();
    for (const [key, entry] of map) if (entry.expiresAt <= now) map.delete(key);
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    this.sweep(this.counters);
    const current = this.counters.get(key);
    const entry = current && current.expiresAt > Date.now() ? { value: current.value + 1, expiresAt: current.expiresAt } : { value: 1, expiresAt: Date.now() + ttlSec * 1000 };
    this.counters.set(key, entry);
    return entry.value;
  }

  async get(key: string): Promise<string | null> {
    this.sweep(this.values);
    return this.values.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    this.values.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }

  async windowIncr(key: string, windowSec: number): Promise<number> {
    const now = Date.now();
    const events = (this.windows.get(key) ?? []).filter((at) => now - at < windowSec * 1000);
    events.push(now);
    this.windows.set(key, events);
    return events.length;
  }

  async claimOnce(key: string, value: string, ttlSec: number): Promise<boolean> {
    const now = Date.now();
    const lockedUntil = this.locks.get(key);
    if (lockedUntil !== undefined && lockedUntil > now) return false;
    this.locks.set(key, now + ttlSec * 1000);
    await this.set(`lockval:${key}`, value, ttlSec);
    return true;
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
    this.counters.delete(key);
    this.locks.delete(key);
    this.windows.delete(key);
  }
}

/** Implémentation Redis : fenêtres en ZSET, verrous en SET NX EX. */
class RedisCacheStore implements CacheStore {
  constructor(private readonly redis: Redis) {}

  async incr(key: string, ttlSec: number): Promise<number> {
    const value = await this.redis.incr(`cs:${key}`);
    if (value === 1) await this.redis.expire(`cs:${key}`, ttlSec);
    return value;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(`csv:${key}`);
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    await this.redis.set(`csv:${key}`, value, 'EX', ttlSec);
  }

  async windowIncr(key: string, windowSec: number): Promise<number> {
    const member = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const zkey = `csw:${key}`;
    const now = Date.now();
    const pipe = this.redis.multi();
    pipe.zadd(zkey, now, member);
    pipe.zremrangebyscore(zkey, 0, now - windowSec * 1000);
    pipe.zcard(zkey);
    pipe.pexpire(zkey, windowSec * 1000 + 1_000);
    const results = await pipe.exec();
    const card = results?.[2]?.[1];
    return typeof card === 'number' ? card : 0;
  }

  async claimOnce(key: string, value: string, ttlSec: number): Promise<boolean> {
    const won = await this.redis.set(`csl:${key}`, value, 'EX', ttlSec, 'NX');
    return won === 'OK';
  }

  async del(key: string): Promise<void> {
    await this.redis.del(`cs:${key}`, `csv:${key}`, `csw:${key}`, `csl:${key}`);
  }
}

@Injectable()
export class CacheStoreService implements SpraxiumOnBoot {
  private readonly log = new Logger('CacheStore');
  private store: CacheStore = new MemoryCacheStore();
  private redis: Redis | null = null;

  constructor(private readonly env: AppEnv) {}

  onBoot(): void {
    if (!this.env.REDIS_URL) {
      this.log.info('REDIS_URL absent : cache temps réel en mémoire (dev).');
      return;
    }
    const redis = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    redis.on('error', (error) => this.log.warn(`Redis cache : ${error.message.slice(0, 100)}`));
    redis
      .ping()
      .then(() => {
        this.redis = redis;
        this.store = new RedisCacheStore(redis);
        this.log.info('Cache temps réel sur Redis.');
      })
      .catch(() => {
        this.log.warn('Redis injoignable : cache temps réel en mémoire.');
        redis.disconnect();
      });
  }

  /** Le store actif (Redis si dispo, mémoire sinon). */
  get active(): CacheStore {
    return this.store;
  }

  get driverName(): string {
    return this.redis ? 'redis' : 'memory';
  }
}
