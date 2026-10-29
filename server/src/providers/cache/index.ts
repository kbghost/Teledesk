import { env } from '../../config/env';
import { logger } from '../../config/logger';

/** Abstraction de cache : mémoire par défaut, Redis optionnel (REDIS_ENABLED=true + npm i ioredis). */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}
class MemoryCache implements Cache {
  private m = new Map<string, { v: unknown; exp: number }>();
  async get<T>(key: string) {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.m.delete(key); return undefined; }
    return e.v as T;
  }
  async set(key: string, value: unknown, ttl: number) {
    if (this.m.size > 5000) this.m.clear();
    this.m.set(key, { v: value, exp: Date.now() + ttl * 1000 });
  }
  async del(key: string) { this.m.delete(key); }
}
class RedisCache implements Cache {
  constructor(private r: any) {}
  async get<T>(key: string) { const v = await this.r.get(key); return v ? (JSON.parse(v) as T) : undefined; }
  async set(key: string, value: unknown, ttl: number) { await this.r.set(key, JSON.stringify(value), 'EX', ttl); }
  async del(key: string) { await this.r.del(key); }
}
let cache: Cache = new MemoryCache();
export async function initCache() {
  if (!env.REDIS_ENABLED) return;
  try {
    const name = 'ioredis';
    const mod: any = await import(/* @vite-ignore */ name);
    const Redis = mod.default ?? mod.Redis;
    cache = new RedisCache(new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 }));
    logger.info('redis cache enabled');
  } catch {
    logger.warn('Redis indisponible : repli sur le cache mémoire');
  }
}
export const getCache = () => cache;
