# Superadmin app — plan (Option B)

Status: **to do**. Decided approach: a separate admin app and admin API in this monorepo, not a section of the tenant app.

## Why separate

The tenant API connects as `bos_app`, which Postgres row-level security fences into one organisation per request. A superadmin must see every tenant. Keeping that cross-tenant access out of the tenant-facing app means a bug or stolen session there can never reach other customers' data.

## Shape

| Piece | What |
|---|---|
| `apps/admin` | Next.js admin UI, served at `admin.<domain>` (its own origin and cookies) |
| `apps/admin-api` | NestJS API for staff only. Reuses `prisma/schema.prisma` and `packages/shared` (plans, formatting, GST maths) |
| DB role `bos_admin` | Its own Postgres role with explicit admin policies, read-mostly. Writes only through named admin actions. The tenant API never contains bypass code. |
| Staff accounts | Separate from customer accounts. Two-factor required. Optional IP allowlist / VPN. Staff roles: Support, Billing, Super-admin. |
| Admin audit log | Every admin action: who, when, which tenant, before/after. Append-only. |
| Support access ("act as") | Time-limited, logged, visible to the tenant's Owner (optionally granted by the Owner first). |

"Another port" alone is not the separation; the login, the database role and network access are.

## Scope

1. **Tenants**: list and search; usage (seats, entities, documents, storage, AI requests); status (trial, active, suspended, closed); extend trial; suspend / reactivate; override limits; see Owners.
2. **Plans and entitlements**: move plans and per-tenant feature flags (modules, AI, limits) from `apps/api/src/core/plans.ts` into the database; edit them from the admin app.
3. **Billing**: subscriptions; our GST invoices to tenants; payment status and dunning (chasing failed payments); Razorpay (India) or Stripe webhooks.
4. **Support**: support access; reset a tenant Owner's sign-in or two-factor; resend invitations; view a tenant's email log and exports.
5. **Platform**: BullMQ queue health (failed jobs, retries), failed emails, AI usage and cost per tenant, announcements to tenants.
6. **Security**: the admin audit log; staff roles and permissions.

## Phases

1. Admin app skeleton, staff auth with 2FA, `bos_admin` role, audit log; tenants list/detail; suspend, extend trial.
2. Plans and entitlements in the database; limit overrides.
3. Billing integration and invoices to tenants; dunning.
4. Support access; platform health; announcements.

## Open questions

- Hosted only (SaaS), or also installed on customers' own servers? Self-hosted needs signed licence keys verified offline; SaaS just needs plans/entitlements.
- Payment provider: Razorpay, Stripe, or manual invoicing to start?
- Staff: one person at first, or several with different access?
