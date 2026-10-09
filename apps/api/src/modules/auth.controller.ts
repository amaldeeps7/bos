import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Res, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../core/prisma.service';
import { RedisService } from '../core/redis.service';
import { AccessService } from '../core/access.service';
import { OrgService } from '../core/org.service';
import { COOKIE } from '../core/auth.guard';
import { Me, Public } from '../core/decorators';
import type { AuthUser } from '../core/auth.types';
import { str } from '../core/util';

const TIMEOUTS: Record<string, number> = { '30 minutes': 1800, '8 hours': 8 * 3600, '7 days': 7 * 86400, '30 days': 30 * 86400 };

@Controller('auth')
export class AuthController {
  constructor(private prisma: PrismaService, private jwt: JwtService, private redis: RedisService, private access: AccessService, private orgs: OrgService) {}

  @Public() @Post('login') @HttpCode(200)
  async login(@Body() body: any, @Res({ passthrough: true }) res: Response) {
    const email = str(body.email, 'Email', { required: true, max: 200 }).trim().toLowerCase();
    const password = str(body.password, 'Password', { required: true, max: 200 });
    if ((await this.redis.hit(`bos:login:${email}`, 300)) > 10) throw new HttpException('Too many attempts. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    const u = await this.prisma.user.findUnique({ where: { email } });
    if (!u || u.status !== 'Active' || !u.passwordHash || !(await bcrypt.compare(password, u.passwordHash))) throw new UnauthorizedException('That email and password don’t match.');
    await this.redis.del(`bos:login:${email}`);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: 'org' } });
    const ttl = TIMEOUTS[(org.security as any).timeout] || 8 * 3600;
    const token = await this.jwt.signAsync({ sub: u.id }, { expiresIn: ttl });
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: ttl * 1000, path: '/' });
    await this.prisma.user.update({ where: { id: u.id }, data: { lastActiveAt: new Date() } });
    return { ok: true };
  }

  @Public() @Post('logout') @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) { res.clearCookie(COOKIE, { path: '/' }); return { ok: true }; }

  /** Demo accounts for the sign-in screen. Only exposed in demo mode. */
  @Public() @Get('demo-accounts')
  async demo() {
    if (process.env.DEMO_MODE !== 'true') return [];
    const users = await this.prisma.user.findMany({ where: { status: 'Active' }, include: { role: true }, orderBy: { role: { sort: 'asc' } } });
    return users.map(u => ({ email: u.email, name: u.name, role: u.role.name }));
  }

  @Get('me')
  async me(@Me() me: AuthUser) {
    const c = await this.orgs.ctx(); const org = c.org;
    await this.prisma.user.update({ where: { id: me.id }, data: { lastActiveAt: new Date() } });
    return { user: me, org: { name: org.name, slug: org.slug, tz: org.tz, currency: org.currency, ourState: c.ourState || '', discLimit: c.discLimit, sacRates: c.sacRates, templates: org.templates, entity: c.entity },
      demo: process.env.DEMO_MODE === 'true', serverTime: new Date().toISOString() };
  }
}
