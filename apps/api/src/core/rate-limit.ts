import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RedisService } from './redis.service';

/** Who a limit counts against: the caller's IP address, the signed-in person, or their organisation. */
type By = 'ip' | 'user' | 'org';
type Rule = { name: string; max: number; window: number; by: By };
const LIMIT = 'rateLimit';

/**
 * Caps how often a route can be called, e.g. `@Limit('signup', 5, 3600)` = five sign-ups an hour per IP.
 * Every route also has a default of DEFAULT per minute per IP.
 */
export const Limit = (name: string, max: number, windowSec: number, by: By = 'ip') => SetMetadata(LIMIT, { name, max, window: windowSec, by } satisfies Rule);
const DEFAULT: Rule = { name: 'any', get max() { return Number(process.env.RATE_LIMIT_PER_MIN || 600); }, window: 60, by: 'ip' };

/** Runs after AuthGuard, so per-user and per-organisation limits know who's calling. Counters live in Redis (shared by all instances). */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private reflector: Reflector, private redis: RedisService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (process.env.RATE_LIMIT === 'off') return true;
    const req = ctx.switchToHttp().getRequest(); const res = ctx.switchToHttp().getResponse();
    const rule = this.reflector.getAllAndOverride<Rule>(LIMIT, [ctx.getHandler(), ctx.getClass()]);
    for (const r of rule ? [DEFAULT, rule] : [DEFAULT]) {
      const who = r.by === 'user' ? req.user?.id : r.by === 'org' ? req.user?.orgId : req.ip;
      if (!who) continue;
      const n = await this.redis.hit(`bos:rl:${r.name}:${r.by}:${who}`, r.window);
      if (n > r.max) {
        res.setHeader?.('Retry-After', String(r.window));
        throw new HttpException(r === DEFAULT ? 'Too many requests. Slow down a little.' : `Too many attempts. Try again in ${r.window >= 3600 ? 'an hour' : r.window >= 120 ? `${Math.round(r.window / 60)} minutes` : 'a minute'}.`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    return true;
  }
}
