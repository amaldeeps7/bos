import { AsyncLocalStorage } from 'async_hooks';

/** Whose records a member sees inside their organisation (spec §5.5). The Owner is always { all }. */
export type Scope = { all: true } | { entityIds: string[] } | { unitIds: string[] };

/**
 * The tenant a piece of work runs for. Set per request (TenantMiddleware + AuthGuard) and per job
 * (scheduler, exports). Every tenant-table query reads it; with no orgId they fail closed.
 */
export interface TenantCtx {
  orgId?: string;
  accountId?: string;
  membershipId?: string;
  scope?: Scope;
  /** inside an interactive transaction that already ran set_config */
  inTx?: boolean;
}

export const tenantStore = new AsyncLocalStorage<TenantCtx>();
export const tenant = (): TenantCtx | undefined => tenantStore.getStore();
export const orgId = (): string => {
  const id = tenant()?.orgId;
  if (!id) throw new Error('No organisation in context');
  return id;
};

/** Runs `fn` as a given tenant (jobs, sign-in, sign-up). */
// Awaited inside the context: Prisma queries are lazy and run on .then(), which must happen in this tenant.
export const runAs = <T>(ctx: TenantCtx, fn: () => PromiseLike<T>): Promise<T> => tenantStore.run({ ...ctx }, async () => await fn());

export const isAll = (s?: Scope): boolean => !s || 'all' in s;
