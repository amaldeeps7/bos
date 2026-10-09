import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AccessService } from './access.service';
import { IS_PUBLIC, PERMS } from './decorators';

export const COOKIE = 'bos_token';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private jwt: JwtService, private access: AccessService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const header = String(req.headers.authorization || '');
    const token = req.cookies?.[COOKIE] || (header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!token) throw new UnauthorizedException('Sign in to continue');
    let sub: string;
    try { sub = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub; } catch { throw new UnauthorizedException('Your session has ended. Sign in again.'); }
    const user = await this.access.load(sub);
    if (!user) throw new UnauthorizedException('This account is not active');
    req.user = user;
    const need = this.reflector.getAllAndOverride<string[]>(PERMS, targets) || [];
    for (const p of need) if (!AccessService.has(user, p)) throw new ForbiddenException(`You don't have permission: ${p}`);
    return true;
  }
}
