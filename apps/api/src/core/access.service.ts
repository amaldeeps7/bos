import { ForbiddenException, Injectable } from '@nestjs/common';
import { AREA_MODULE } from '@bos/shared';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import type { AuthUser } from './auth.types';

/** Loads a user's effective access (role permissions + switched-on modules), cached in Redis. */
@Injectable()
export class AccessService {
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  async load(userId: string): Promise<AuthUser | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!u || u.status !== 'Active') return null;
    const role = await this.role(u.roleId);
    const modules = await this.modules();
    return { id: u.id, name: u.name, email: u.email, title: u.title, roleId: u.roleId, roleName: role.name, builtIn: role.builtIn, perms: role.perms, modules };
  }

  async role(roleId: string): Promise<{ name: string; builtIn: boolean; perms: string[] }> {
    const key = `bos:role:${roleId}`;
    const hit = await this.redis.getJSON<{ name: string; builtIn: boolean; perms: string[] }>(key);
    if (hit) return hit;
    const r = await this.prisma.role.findUniqueOrThrow({ where: { id: roleId } });
    const v = { name: r.name, builtIn: r.builtIn, perms: r.perms };
    await this.redis.setJSON(key, v, 600);
    return v;
  }

  async modules(): Promise<Record<string, boolean>> {
    const hit = await this.redis.getJSON<Record<string, boolean>>('bos:modules');
    if (hit) return hit;
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: 'org' } });
    const v = org.modules as Record<string, boolean>;
    await this.redis.setJSON('bos:modules', v, 600);
    return v;
  }

  async invalidateRole(roleId?: string) { roleId ? await this.redis.del(`bos:role:${roleId}`) : await this.redis.delPattern('bos:role:*'); }
  async invalidateModules() { await this.redis.del('bos:modules'); }

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
   */
  async actor(u: AuthUser, perm: string, preferUserId?: string | null): Promise<{ id: string; name: string; demo: boolean }> {
    if (AccessService.has(u, perm)) return { id: u.id, name: u.name, demo: false };
    if (process.env.DEMO_MODE !== 'true') throw new ForbiddenException(`You don't have permission: ${perm}`);
    const mod = AREA_MODULE[perm.split('.')[0]];
    if (mod && u.modules[mod] === false) throw new ForbiddenException('That module is switched off');
    const candidates = await this.prisma.user.findMany({ where: { status: 'Active', role: { perms: { has: perm } }, id: { not: u.id } }, include: { role: true }, orderBy: { createdAt: 'asc' } });
    const pick = candidates.find(c => c.id === preferUserId) || candidates.find(c => !c.role.builtIn) || candidates[0];
    if (!pick) throw new ForbiddenException(`Nobody holds ${perm}`);
    return { id: pick.id, name: pick.name, demo: true };
  }

  /** Who, other than `excludeId`, would carry out an action needing `perm` — for "X as Meera (demo)" labels. */
  async whoCan(perm: string, excludeId: string): Promise<{ id: string; name: string } | null> {
    const list = await this.prisma.user.findMany({ where: { status: 'Active', role: { perms: { has: perm }, builtIn: false }, id: { not: excludeId } }, orderBy: { createdAt: 'asc' } });
    const owner = list.length ? null : await this.prisma.user.findFirst({ where: { status: 'Active', role: { builtIn: true }, id: { not: excludeId } } });
    const u = list[0] || owner;
    return u ? { id: u.id, name: u.name } : null;
  }
}
