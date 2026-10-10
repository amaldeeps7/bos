import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import { AccessService } from './access.service';
import { IS_PUBLIC, PERMS } from './decorators';
import type { TokenPayload } from './auth.types';
import { tenant, tenantStore } from './tenant';
import { SessionService } from './session.service';

import { COOKIE } from './cookies';
export { COOKIE };

/** Opens an empty tenant context for every request; AuthGuard fills it once the token is verified. */
export class TenantMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction) { tenantStore.run({}, next); }
}

export const tokenOf = (req: any): string => {
  const header = String(req.headers?.authorization || '');
  return req.cookies?.[COOKIE] || (header.startsWith('Bearer ') ? header.slice(7) : '');
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private jwt: JwtService, private access: AccessService, private session: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const token = tokenOf(req);
    if (!token) { if (isPublic) return true; throw new UnauthorizedException('Sign in to continue'); }
    let p: TokenPayload;
    try { p = await this.jwt.verifyAsync<TokenPayload>(token); } catch { if (isPublic) return true; throw new UnauthorizedException('Your session has ended. Sign in again.'); }
    // A two-factor challenge ticket is not a session.
    if (!p.org || !p.mid || p.typ) { if (isPublic) return true; throw new UnauthorizedException('Your session has ended. Sign in again.'); }
    // The tenant comes from the token, which only /auth/login, /auth/switch and /signup issue after checking membership.
    const c = tenant();
    if (!c) throw new Error('TenantMiddleware is not installed');
    Object.assign(c, { orgId: p.org, accountId: p.sub, membershipId: p.mid });
    const user = await this.access.load(p.mid, p.sub);
    if (!user) {
      Object.assign(c, { orgId: undefined, membershipId: undefined });
      if (isPublic) return true;
      throw new UnauthorizedException('You no longer have access to this organisation');
    }
    // Signed out on that device, or everywhere (password change, "sign out everywhere"), since this token was issued.
    if ((p.sv ?? 0) !== user.sv || (await this.session.isRevoked(p.sid))) {
      Object.assign(c, { orgId: undefined, membershipId: undefined });
      if (isPublic) return true;
      throw new UnauthorizedException('You were signed out. Sign in again.');
    }
    c.scope = user.scope;
    user.otp = !!p.amr?.includes('otp'); user.sid = p.sid;
    req.user = user;
    await this.session.refresh(req, ctx.switchToHttp().getResponse(), p, user.ttl || 8 * 3600);
    // Policy says two-factor and this session didn't pass it (signed in before the rule, or before enrolling): sign in again.
    if (user.verify && !isPublic) throw new UnauthorizedException({ statusCode: 401, code: 'verify_required', message: 'Your organisation requires a confirmed email address. Sign in again to confirm yours.' });
    if (user.mfa && !user.otp && !isPublic) throw new UnauthorizedException({ statusCode: 401, code: 'mfa_required', message: 'Your organisation requires two-factor sign-in. Sign in again to set it up.' });
    const need = this.reflector.getAllAndOverride<string[]>(PERMS, targets) || [];
    for (const perm of need) if (!AccessService.has(user, perm)) throw new ForbiddenException(`You don't have permission: ${perm}`);
    return true;
  }
}
