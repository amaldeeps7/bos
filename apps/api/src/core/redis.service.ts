import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/** Small cache and rate-limit store. The app keeps working (uncached) if Redis is unreachable. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private log = new Logger('Redis');
  private client: Redis | null = null;
  private up = false;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) { this.log.warn('REDIS_URL not set — running without a cache'); return; }
    this.client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.client.on('ready', () => { this.up = true; this.log.log('connected'); });
    this.client.on('error', () => { this.up = false; });
    this.client.on('end', () => { this.up = false; });
  }

  async getJSON<T>(key: string): Promise<T | null> {
    if (!this.client || !this.up) return null;
    try { const v = await this.client.get(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
  }
  async setJSON(key: string, value: unknown, ttlSec = 300) {
    if (!this.client || !this.up) return;
    try { await this.client.set(key, JSON.stringify(value), 'EX', ttlSec); } catch { /* cache only */ }
  }
  async del(...keys: string[]) {
    if (!this.client || !this.up || !keys.length) return;
    try { await this.client.del(...keys); } catch { /* cache only */ }
  }
  async delPattern(pattern: string) {
    if (!this.client || !this.up) return;
    try { const keys = await this.client.keys(pattern); if (keys.length) await this.client.del(...keys); } catch { /* cache only */ }
  }
  /** Counts hits in a fixed window; returns the count after this hit (0 when Redis is down). */
  async hit(key: string, windowSec: number): Promise<number> {
    if (!this.client || !this.up) return 0;
    try { const n = await this.client.incr(key); if (n === 1) await this.client.expire(key, windowSec); return n; } catch { return 0; }
  }
  async onModuleDestroy() { await this.client?.quit().catch(() => undefined); }
}
