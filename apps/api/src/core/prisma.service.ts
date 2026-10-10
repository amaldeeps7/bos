import { ForbiddenException, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { isAll, tenant, tenantStore, TenantCtx } from './tenant';

/** Every model except these carries orgId and is covered by row-level security. */
const GLOBAL = new Set(['Organization', 'Account']);
const READ_WRITE = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany', 'upsert']);
const DOCS = new Set(['Quote', 'Invoice', 'Payment', 'CreditNote']);

/** Extra filter for a member limited to some entities or business units (spec §5.5). */
function scopeFilter(model: string, c: TenantCtx): Record<string, unknown> | null {
  const s = c.scope;
  if (isAll(s)) return null;
  if ('entityIds' in s!) {
    const ids = { in: s.entityIds };
    return DOCS.has(model) ? { entityId: ids } : null;
  }
  const units = { unitId: { in: (s as { unitIds: string[] }).unitIds } };
  switch (model) {
    case 'Project': return units;
    case 'Task': case 'Milestone': return { project: units };
    case 'Quote': case 'Invoice': return { project: units };
    case 'CreditNote': return { invoice: { project: units } };
    case 'Payment': return { allocations: { some: { invoice: { project: units } } } };
    default: return null;
  }
}

function withTenant(model: string, operation: string, args: any, c: TenantCtx) {
  const a = { ...(args || {}) };
  if (READ_WRITE.has(operation)) {
    const where: Record<string, unknown> = { ...(a.where || {}) };
    if (c.orgId) where.orgId = c.orgId;
    const extra = scopeFilter(model, c);
    if (extra) where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), extra];
    a.where = where;
  }
  // Creating a document for an entity outside your scope is refused. orgId itself is filled by the
  // column default (current_setting('app.org_id')) and checked by the RLS policy, including nested creates.
  if (DOCS.has(model) && (operation === 'create' || operation === 'upsert') && c.scope && 'entityIds' in c.scope) {
    const data = operation === 'upsert' ? a.create : a.data;
    if (data?.entityId && !c.scope.entityIds.includes(data.entityId)) throw new ForbiddenException('That entity is outside your access');
  }
  return a;
}

function create() {
  const base = new PrismaClient();
  const log = new Logger('Tenant');
  const setCfg = (c: TenantCtx) => base.$executeRaw`SELECT set_config('app.org_id', ${c.orgId || ''}, true), set_config('app.account_id', ${c.accountId || ''}, true)`;

  const ext = base.$extends({
    name: 'tenant',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (GLOBAL.has(model)) return query(args);
          const c = tenant();
          // Fail closed: no tenant, no tenant data. Memberships may be read by account (sign-in, organisation menu).
          if (!c?.orgId && !(model === 'Membership' && c?.accountId)) {
            log.error(`${model}.${operation} without a tenant context`);
            throw new Error(`No tenant context for ${model}.${operation}`);
          }
          const a = withTenant(model, operation, args, c!);
          if (c!.inTx) return query(a);
          const [, result] = await base.$transaction([setCfg(c!), query(a) as any]);
          return result;
        },
      },
    },
  });

  /** Interactive transactions set the tenant once, then run their queries directly. */
  const $transaction = ((arg: any, opts?: any) => {
    const c = tenant() || {};
    if (typeof arg === 'function') {
      return ext.$transaction(async (tx: any) => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${c.orgId || ''}, true), set_config('app.account_id', ${c.accountId || ''}, true)`;
        return tenantStore.run({ ...c, inTx: true }, async () => await arg(tx));
      }, opts);
    }
    throw new Error('Use an interactive transaction: prisma.$transaction(async tx => …)');
  });

  // Same client, with $transaction replaced and the raw (unextended) client reachable for jobs that set their own config.
  return new Proxy(ext, { get: (t, p, r) => (p === '$transaction' ? $transaction : p === '$base' ? base : Reflect.get(t, p, r)) }) as unknown as Omit<typeof ext, '$transaction'> & {
    $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, opts?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T>;
    $base: PrismaClient;
  };
}

type Db = ReturnType<typeof create>;
/** Injection token and type for the tenant-aware Prisma client. */
export abstract class PrismaService {}
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface PrismaService extends Db {}
export const prismaProvider = { provide: PrismaService, useFactory: async () => { const db = create(); await db.$connect(); return db; } };
export type { Prisma };
