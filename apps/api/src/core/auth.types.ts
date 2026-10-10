import type { Scope } from './tenant';

/** The signed-in person as seen by one organisation. `id` is the membership id. */
export interface AuthUser {
  id: string; accountId: string; orgId: string;
  name: string; email: string; title: string;
  roleId: string; roleName: string; builtIn: boolean;
  perms: string[]; modules: Record<string, boolean>;
  scope: Scope;
  /** sample workspace: "… as Meera (demo)" fallbacks allowed */
  demo: boolean;
}

export interface TokenPayload { sub: string; org: string; mid: string }
