import { ForbiddenException, Injectable } from '@nestjs/common';
import { AREA_MODULE } from '@bos/shared';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import type { AuthUser } from './auth.types';
import { orgId, Scope } from './tenant';

/** Loads a user's effective access (role permissions + switched-on modules), cached in Redis. */
@Injectable()
export class AccessService {
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  /** A member's effective access in their organisation (role permissions + modules + scope). Needs the org in context. */
  async load(membershipId: string, accountId: string): Promise<AuthUser | null> {
    const o = orgId();
    const [u, org] = await Promise.all([
      this.prisma.membership.findUnique({ where: { id: membershipId } }),
      this.prisma.organization.findUnique({ where: { id: o } }),
    ]);
    if (!u || u.status !== 'Active' || u.accountId !== accountId || !org || org.status !== 'active') return null;
    const role = await this.role(u.roleId);
    const modules = await this.modules();
    const scope: Scope = role.builtIn || !u.scope ? { all: true } : (u.scope as unknown as Scope);
    return { id: u.id, accountId: u.accountId, orgId: o, name: u.name, email: u.email, title: u.title, roleId: u.roleId, roleName: role.name, builtIn: role.builtIn,
      perms: role.perms, modules, scope, demo: org.demo && process.env.DEMO_MODE === 'true' };
  }

  async role(roleId: string): Promise<{ name: string; builtIn: boolean; perms: string[] }> {
    const key = `bos:${orgId()}:role:${roleId}`;
    const hit = await this.redis.getJSON<{ name: string; builtIn: boolean; perms: string[] }>(key);
    if (hit) return hit;
    const r = await this.prisma.role.findUniqueOrThrow({ where: { id: roleId } });
    const v = { name: r.name, builtIn: r.builtIn, perms: r.perms };
    await this.redis.setJSON(key, v, 600);
    return v;
  }

  async modules(): Promise<Record<string, boolean>> {
    const key = `bos:${orgId()}:modules`;
    const hit = await this.redis.getJSON<Record<string, boolean>>(key);
    if (hit) return hit;
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId() } });
    const v = org.modules as Record<string, boolean>;
    await this.redis.setJSON(key, v, 600);
    return v;
  }

  async invalidateRole(roleId?: string) { roleId ? await this.redis.del(`bos:${orgId()}:role:${roleId}`) : await this.redis.delPattern(`bos:${orgId()}:role:*`); }
  async invalidateModules() { await this.redis.del(`bos:${orgId()}:modules`); }

  static has(u: AuthUser, perm: string): boolean {
    if (!u.perms.includes(perm)) return false;
    const mod = AREA_MODULE[perm.split('.')[0]];
    return !mod || u.modules[mod] !== false;
  }
  static require(u: AuthUser, perm: string) {
    if (!AccessService.has(u, perm)) throw new ForbiddenException(`You don't have permission: ${perm}`);
  }

  /**
   * The person an action is carried out as. Normally the caller; in demo mode, when the caller lacks the
   * permission, the first active colleague who holds it (the design's "Approve as Meera (demo)" buttons).
   * Only in a demo organisation.
   */
  async actor(u: AuthUser, perm: string, preferUserId?: string | null): Promise<{ id: string; name: string; demo: boolean }> {
    if (AccessService.has(u, perm)) return { id: u.id, name: u.name, demo: false };
    // Only in the sample workspace, never in a real organisation (spec §6).
    if (!u.demo) throw new ForbiddenException(`You don't have permission: ${perm}`);
    const mod = AREA_MODULE[perm.split('.')[0]];
    if (mod && u.modules[mod] === false) throw new ForbiddenException('That module is switched off');
    const candidates = await this.prisma.membership.findMany({ where: { status: 'Active', role: { perms: { has: perm } }, id: { not: u.id } }, include: { role: true }, orderBy: { createdAt: 'asc' } });
    const pick = candidates.find(c => c.id === preferUserId) || candidates.find(c => !c.role.builtIn) || candidates[0];
    if (!pick) throw new ForbiddenException(`Nobody holds ${perm}`);
    return { id: pick.id, name: pick.name, demo: true };
  }

  /** Who, other than `excludeId`, would carry out an action needing `perm` — for "X as Meera (demo)" labels. */
  async whoCan(perm: string, excludeId: string, me?: AuthUser): Promise<{ id: string; name: string } | null> {
    if (me && !me.demo) return null;
    const list = await this.prisma.membership.findMany({ where: { status: 'Active', role: { perms: { has: perm }, builtIn: false }, id: { not: excludeId } }, orderBy: { createdAt: 'asc' } });
    const owner = list.length ? null : await this.prisma.membership.findFirst({ where: { status: 'Active', role: { builtIn: true }, id: { not: excludeId } } });
    const u = list[0] || owner;
    return u ? { id: u.id, name: u.name } : null;
  }
}
