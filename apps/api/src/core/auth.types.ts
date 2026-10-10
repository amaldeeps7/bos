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
  /** the organisation's policy requires two-factor for this person */
  mfa?: boolean;
  /** this session passed a second factor */
  otp?: boolean;
  /** this session's id (sign-out of one device) and the account's session version (sign-out everywhere) */
  sid?: string;
  sv?: number;
  /** session lifetime from the organisation's "sign out after inactivity" setting, in seconds */
  ttl?: number;
}

/** `amr` lists how the session was authenticated ("pwd", "otp"). `typ: 'mfa'` marks a short-lived challenge ticket, never a session. */
export interface TokenPayload { sub: string; org: string; mid: string; amr?: string[]; typ?: 'mfa'; sid?: string; sv?: number; iat?: number; exp?: number }
