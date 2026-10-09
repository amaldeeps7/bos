# Business OS

A modular operating system for service businesses: customers and pipeline, quotations, projects and milestones, tasks (as tickets), meetings, invoices with Indian GST, payments and receivables, credit notes, assets, approvals, reports, organisation settings with a full role/permission matrix, and an AI assistant.

It's built from the Claude Design prototype *Business OS Prototype* and follows its layout, tokens and copy: Electric Blue accent, light sidebar, dot-and-word status badges, Inter with JetBrains Mono for reference numbers, and rupee formatting.

## Stack

| Part | Tech |
| --- | --- |
| `apps/web` | Next.js 15 (App Router), React 19, TanStack Query, lucide icon font |
| `apps/api` | NestJS 11, Prisma 6, PostgreSQL 16, Redis 7 (permission cache, login rate limit), Anthropic SDK |
| `packages/shared` | Domain logic used by both: GST maths, numbering patterns, status vocab, the permission catalogue, date/money formatting |

## Run it

### Docker (everything)

```bash
cp .env.example .env          # optional: add ANTHROPIC_API_KEY
docker compose up --build
```

Open http://localhost:3000. The sign-in screen lists demo accounts (password `demo1234`). Priya Raman (Project manager) is the persona the design was built around.

### Local development

Needs Node 22, pnpm 10, Postgres and Redis.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # edit DATABASE_URL / REDIS_URL if needed
pnpm build:shared
pnpm --filter @bos/api prisma:dev           # create the schema
pnpm db:seed                                # load Demo Consulting (wipes the database)
pnpm dev:api                                # http://localhost:4000/api
pnpm dev:web                                # http://localhost:3000 (proxies /api to the API)
```

### Tests

```bash
pnpm --filter @bos/shared build && pnpm --filter @bos/shared test   # GST, numbering, dates
pnpm --filter @bos/api test     # API end-to-end against Postgres (re-seeds the database)
```

The API suite covers sign-in, permission enforcement on the API, module switches, GST by place of supply, the milestone → invoice → approval → issue → payment flow, discount-policy routing, GSTIN validation and forward-only numbering.

## How it works

- **Permissions are enforced by the API.** Every route declares the permission it needs (`@Perm('invoice.read')`); a module switched off in Settings hides its routes for everyone. Role permissions are cached in Redis and invalidated when they change. The UI reads the same permissions to decide what to show.
- **Approvals follow policy.** Invoices go to Finance before they can be issued; quotations with a discount above the limit (or above the large-quotation threshold) go to the Owner; nobody approves what they raised unless their role holds "approve own". Approving or rejecting from the Approvals screen updates the document.
- **Numbers come from a locked counter** (`SELECT … FOR UPDATE`) per document type, so two people can't get the same number. Patterns support `{prefix}`, `{yyyy}`, `{yy}`, `{fy}` and `{seq}`; counters only move forward.
- **GST** is CGST + SGST when the customer's GSTIN state matches the default issuing entity's, IGST otherwise, at the rate set per SAC code.
- **Audit log** is append-only; settings, access changes and document steps are written to it.
- **Demo mode** (`DEMO_MODE=true`) adds the design's dashed buttons — "Approve as Meera (demo)", "Issue as Meera (demo)" — so one person can walk a document through steps that belong to other roles. The audit log records who clicked. Turn it off in production; then each step needs a person who holds the permission.
- **Assistant.** Suggested questions are answered from live records by the API. Free-text questions go to Claude (`claude-opus-5-5`, server-side refusal fallback enabled) when `ANTHROPIC_API_KEY` is set; otherwise the assistant says so.

## Where things are

| Screen | Files |
| --- | --- |
| Shell (sidebar, header, mobile tabs, notifications, role preview) | `apps/web/src/components/shell.tsx` |
| My Work (focus, approvals, day timeline, milestones) | `apps/web/src/app/(app)/page.tsx` |
| Task ticket panel, meeting record | `apps/web/src/components/overlays.tsx` |
| Dialogs (meeting, task, customer, payment, credit note) | `apps/web/src/components/dialogs.tsx` |
| Quotation / invoice view and editor | `apps/web/src/components/docs.tsx` |
| Settings (all 13 sections, permission matrix) | `apps/web/src/components/settings.tsx` |
| Assistant | `apps/web/src/components/assistant.tsx`, `apps/api/src/modules/ai.controller.ts` |
| Data model and demo data | `apps/api/prisma/schema.prisma`, `apps/api/prisma/seed.ts` |

## Differences from the prototype

- The app is personalised for whoever signs in, not hard-wired to Priya, and uses the real clock in the organisation's time zone (the prototype froze it at 10:20 am on 8 Oct). Demo data is generated relative to today.
- After the working day ends, "New meeting" proposes tomorrow's first free slot, and "Plan" says there's no free hour left instead of booking one in the past.
- Due dates can be changed from the task panel (the prototype showed them read-only).
- Not wired to outside services yet: calendar invites, emails (quotes, invoices, reminders), PDF generation and UPI QR codes are recorded and announced but not sent or rendered. The ⌘K search box is visual only.
- One organisation per deployment.
