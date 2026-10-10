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

Open http://localhost:3000. The sign-in screen lists demo accounts (password `demo1234`). Priya Raman (Project manager) is the persona the design was built around. She also owns a second organisation, Raman Advisory (a new trial still on its Get started checklist); switch between them from the organisation menu at the top of the sidebar. "Create an organisation" on the sign-in screen signs a new organisation up.

Every email the app sends lands in Mailpit at http://localhost:8025. To deliver real email, set `SMTP_URL` (and `EMAIL_FROM`) in `.env`, e.g. `smtps://user:password@smtp.example.com:465`.

### Local development

Needs Node 22, pnpm 10, Postgres 15+ and Redis. The API connects as an application role without `BYPASSRLS`; create it once (as a superuser) and give the owner role `BYPASSRLS` for migrations and the seed:

```sql
CREATE ROLE bos_app LOGIN PASSWORD 'bos_app' NOSUPERUSER NOBYPASSRLS;
ALTER ROLE bos BYPASSRLS;
```

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # DATABASE_URL = bos_app, MIGRATE_DATABASE_URL = owner
pnpm build:shared
pnpm --filter @bos/api exec prisma migrate deploy
(cd apps/api && node prisma/app-role.js)    # grants for bos_app
pnpm db:seed                                # load Demo Consulting (wipes the database)
pnpm dev:api                                # http://localhost:4000/api
pnpm dev:web                                # http://localhost:3000 (proxies /api to the API)
```

### Tests

```bash
pnpm --filter @bos/shared build && pnpm --filter @bos/shared test   # GST, numbering, dates
pnpm --filter @bos/api test     # API end-to-end against Postgres (re-seeds the database)
```

The API suite runs the API as `bos_app`, so row-level security is exercised for real. It covers the multitenancy checks from the spec (two organisations with the same GSTIN and invoice numbers; another organisation's records are 404 everywhere; raw SQL with no tenant set returns nothing; concurrent invoices on two entities number independently with no gaps; module caches per organisation; a member scoped to one entity sees only its documents; no demo fallback outside a demo organisation), sign-up, export behind signed links, plan limits and closing an organisation, as well as sign-in, permission enforcement on the API, module switches, GST by place of supply, the milestone → invoice → approval → issue → payment flow, discount-policy routing, GSTIN validation, forward-only numbering, PDF rendering, the email log, adding and inviting people, the org chart, profile permissions and reporting loops, notification switches, meeting reminders and the daily digest, meeting guests, permission-aware search, and editing projects, milestones and deals.

## How it works

- **Many organisations, one deployment.** Each organisation (tenant) has its own people, roles, settings, numbering, records, caches and files. Every tenant table carries `orgId`; Postgres row-level security (forced, on every tenant table) refuses rows from any other organisation, and the API connects as `bos_app`, which can't bypass it. Each request runs its queries in a transaction that first sets `app.org_id` from the session; without it, queries return nothing (and the API refuses to run them). A Prisma extension adds the organisation filter, and a member's access scope, to every query on top. Invoice/credit-note/receipt numbers are per legal entity (one series per GSTIN); quotations and projects per organisation.
- **People and organisations.** A person signs in once (an Account) and belongs to organisations through Memberships, each with its own role, profile and access scope. The session names the organisation; switching from the organisation menu re-issues it after checking the membership. Inviting someone who already uses Business OS adds the organisation to their menu. An admin can only reset the password of someone who belongs to their organisation alone.
- **Access to** (Settings → Users): a member can be limited to one legal entity (its quotations, invoices, payments, credit notes) or one business unit (its projects and tasks, and documents raised from them). The Owner always sees everything.
- **Sign-up and set-up.** "Create organisation" (or the public sign-up page) asks for the organisation, its first legal entity (GSTIN), numbering and optional invitations, then lands on a Get started checklist until the Owner finishes it. Plans (Starter, Growth, Enterprise; new organisations start on a 14-day trial with Growth's limits) set how many people and entities are allowed and which modules can be switched on.
- **Data & export.** Settings → Data & export builds a ZIP of every record as CSV and JSON plus every issued PDF, stored under `STORAGE_DIR/orgs/<orgId>/` and downloadable for 7 days through a signed link (also emailed). The Owner can close the organisation: everyone loses access at once and its data is deleted after 30 days.
- **Permissions are enforced by the API.** Every route declares the permission it needs (`@Perm('invoice.read')`); a module switched off in Settings hides its routes for everyone. Role permissions are cached in Redis and invalidated when they change. The UI reads the same permissions to decide what to show.
- **Approvals follow policy.** Invoices go to Finance before they can be issued; quotations with a discount above the limit (or above the large-quotation threshold) go to the Owner; nobody approves what they raised unless their role holds "approve own". Approving or rejecting from the Approvals screen updates the document.
- **Numbers come from a locked counter** (`SELECT … FOR UPDATE`) per document type and issuing entity, so two people can't get the same number. Patterns support `{prefix}`, `{yyyy}`, `{yy}`, `{fy}` and `{seq}`; counters only move forward.
- **GST** is CGST + SGST when the customer's GSTIN state matches the issuing entity's (chosen per document under "Issued by" when there's more than one), IGST otherwise, at the rate set per SAC code.
- **GST can be off.** A legal entity that isn't registered for GST (Settings → Legal entities, or "Not registered for GST" when creating the organisation) issues plain quotations and invoices: titled "Invoice", with no GSTIN, SAC, tax rows or place of supply, on screen and in the PDF. Each document records whether it charges GST, so switching an entity on or off changes its drafts but never an issued document. Customers need no GSTIN either; their state then sets the place of supply.
- **Invoice numbers are taken at issue.** Drafts carry a `DRAFT-…` reference, so a cancelled or rejected draft never leaves a gap in the GST series. Cancelling an invoice frees its milestone to be billed again; a credit note that settles the balance marks the milestone paid and uses the invoice's own tax rate.
- **Approvals** skip approvers who are on leave, move to someone else when an approver is deactivated, and let the only person who can approve sign off their own document when the policy allows it (recorded in the audit log). Equipment can be requested from Assets; requests, and assignments above the asset limit, go to someone who manages assets.
- **CSV export** on every list (invoices as a GST register with CGST/SGST/IGST, quotations, customers, receipts, receivables, credit notes, projects, tasks, deals, assets, meetings, people) downloads what's on screen: the viewer's own access, with the current tab or search applied.
- **Audit log** is append-only; settings, access changes and document steps are written to it.
- **Demo mode** (`DEMO_MODE=true`, and only in an organisation marked as the sample workspace, never one created by sign-up) adds the design's dashed buttons — "Approve as Meera (demo)", "Issue as Meera (demo)" — so one person can walk a document through steps that belong to other roles. The audit log records who clicked. Turn it off in production; then each step needs a person who holds the permission.
- **Email.** Sending a quotation or invoice emails it to the customer's billing email with the PDF attached; credit notes, payment reminders (Settings → Reminders wording), user invitations and meeting invites (with a calendar invite that Google, Outlook and Apple Calendar understand, including updates and cancellations) all go out over SMTP. Every message is recorded with its result under Settings → Email. Without `SMTP_URL`, nothing is sent and the log says so.
- **PDFs** for quotations, invoices and credit notes are drawn on the server from Settings → Templates: layout, accent colour, logo, SAC column, bank details, a UPI QR code for the balance due, signatory line, amount in words and terms.
- **Search (⌘K / Ctrl K, or `/`)** looks across customers, projects, tasks, meetings, quotations, invoices, payments, credit notes, deals, assets and people — by name, document number, `TSK-123`, GSTIN or bank reference — and only returns what the searcher's role can see. With an empty box it offers quick actions and every page.
- **People.** Admins can add someone directly with a password they set (optionally sending a welcome email), or invite by email: the invitee gets a 7-day link to choose their own password. Names, job titles, roles and passwords can be changed later.
- **Team.** An org chart built from each person's manager, and a searchable directory, both showing who is available, in a meeting right now, or on leave. A profile shows contact details, reporting line, direct reports and the projects someone works on, with Schedule meeting and Assign task. People edit their own phone, location, working hours and leave dates; anyone with `user.manage` also sets title, team, manager and joining date (reporting loops are refused). Names elsewhere in the app (meeting attendees, task reporters, project people, search results) open the profile.
- **Your settings** (on your own profile, reached from your name at the bottom of the sidebar or the avatar on mobile): turn calendar invites on or off, meeting reminders (emailed and notified 10 minutes before, with the join link), comment emails on your tasks, and the 8:30 am daily digest of meetings, due tasks and approvals. Reminders and the digest run once a minute as a repeating background job (see Background jobs below). Set `SCHEDULER=off` to disable them. Sign out is here too.
- **Assistant.** Two modes, chosen by whether `ANTHROPIC_API_KEY` is set on the API:
  - *Without a key*, the suggested questions ("Plan my day", "Who owes us the most?") are answered by built-in code from live records, and a typed question is matched to the closest of those answers.
  - *With a key*, typed questions go to an agent (Claude, `claude-opus-5-5`) that looks things up with tools — search, your day, tasks, a project, invoices, a customer, calendars, the team, the pipeline, approvals — running as the signed-in person, so their role, access scope and organisation (row-level security) apply to every lookup; it only gets the tools their role allows. It can *propose* changes — create or update a task, schedule a meeting, email a payment reminder, comment on a task — which appear as Confirm/Dismiss cards; Confirm makes the same API call you'd make yourself, with your permissions and the audit log. The answer streams as it's written. The conversation is kept on the server for 4 hours (per person and organisation). If Claude is unavailable, the question falls back to the closest built-in answer. Suggestion chips always use the built-in answers (instant, no AI cost). Requests count toward the "Assistant requests" usage meter.

## Sign-in security

- **Two-factor sign-in.** Anyone can turn it on from their profile: scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), confirm a code, and save ten one-time backup codes. Sign-in then asks for a code after the password. Settings → Security can require it for everyone, or for Owner and Finance (on by default for new organisations); people it covers set it up at their next sign-in, and sessions opened without it are sent back to sign in. Secrets are stored encrypted (AES-256-GCM, key `MFA_KEY` or `JWT_SECRET`), each code works once, and someone who lost their phone can use a backup code or have an admin reset it from Settings → Users (only for accounts that belong to that organisation alone). The sample workspace doesn't enforce it, so the demo accounts stay one-click.
- **Headers and requests.** Security headers (helmet: HSTS, no sniffing, no framing, a deny-all CSP for API responses). State-changing requests from another website are refused (Origin check), on top of SameSite cookies. Session cookies are HttpOnly and, in production, Secure (`COOKIE_SECURE`). Production refuses to start with a weak `JWT_SECRET` unless `DEMO_MODE=true`.
- **Rate limits** (Redis, shared by all instances): every route `RATE_LIMIT_PER_MIN` per IP (600); sign-in 100 per 10 minutes per IP plus a lockout after 10 wrong passwords for an email; two-factor codes 30 per 5 minutes; sign-up 5 an hour per IP; invitation links 20 per 10 minutes; inviting people 50 an hour per organisation; the assistant 20 (agent) or 60 (quick answers) a minute per person; exports 5 an hour per organisation. Behind a load balancer, set `TRUST_PROXY` to the number of proxies so limits see the client's address.

## Background jobs

Background work runs on BullMQ (Redis): the once-a-minute scheduler (meeting reminders, the daily digest, expired exports, deleting closed organisations) and data exports. Each job runs once, on one instance, and is picked up again if an instance restarts mid-way; the scheduler is a repeating job, so it runs once a minute however many API instances there are. Every instance runs workers by default; `WORKERS=off` makes an instance only queue work (e.g. run web-facing instances with `WORKERS=off` and a separate worker instance), and `WORKER_CONCURRENCY` sets how many jobs one instance runs at once. Redis should be persistent and not evict keys (`maxmemory-policy noeviction`).

## Where things are

| Screen | Files |
| --- | --- |
| Shell (sidebar, header, mobile tabs, notifications, role preview) | `apps/web/src/components/shell.tsx` |
| My Work (focus, approvals, day timeline, milestones) | `apps/web/src/app/(app)/page.tsx` |
| Task ticket panel, meeting record | `apps/web/src/components/overlays.tsx` |
| Dialogs (meeting, task, customer, payment, credit note) | `apps/web/src/components/dialogs.tsx` |
| Quotation / invoice view and editor | `apps/web/src/components/docs.tsx` |
| Assistant agent (tools, loop, streaming) | `apps/api/src/modules/agent/`, `apps/api/src/modules/ai.controller.ts`, `apps/web/src/components/assistant.tsx` |
| Settings (all sections, permission matrix, email log) | `apps/web/src/components/settings.tsx` |
| Organisation menu, new-organisation wizard, Get started | `apps/web/src/components/orgs.tsx` |
| Plan & billing, Data & export, add legal entity | `apps/web/src/components/workspace.tsx` |
| Tenant context, Prisma extension (org filter, scope, `app.org_id`) | `apps/api/src/core/tenant.ts`, `apps/api/src/core/prisma.service.ts` |
| Row-level security, roles | `apps/api/prisma/migrations/*_tenant_rls/`, `apps/api/prisma/app-role.js` |
| Sign-up, plan, usage, export, close | `apps/api/src/modules/orgs.controller.ts`, `apps/api/src/modules/export.service.ts` |
| Team, profiles, your settings | `apps/web/src/app/(app)/team/`, `apps/web/src/components/team.tsx`, `apps/api/src/modules/team.controller.ts` |
| Meeting reminders and daily digest | `apps/api/src/modules/scheduler.service.ts` |
| Edit dialogs (project, milestone, deal, asset, payment, person) | `apps/web/src/components/forms.tsx` |
| ⌘K search | `apps/web/src/components/search.tsx`, `apps/api/src/modules/search.controller.ts` |
| Email, PDFs, calendar invites | `apps/api/src/core/mail.service.ts`, `apps/api/src/core/pdf.service.ts`, `apps/api/src/core/ics.ts`, `apps/api/src/modules/documents.service.ts` |
| Assistant | `apps/web/src/components/assistant.tsx`, `apps/api/src/modules/ai.controller.ts` |
| Data model and demo data | `apps/api/prisma/schema.prisma`, `apps/api/prisma/seed.ts` |

## Differences from the prototype

- The app is personalised for whoever signs in, not hard-wired to Priya, and uses the real clock in the organisation's time zone (the prototype froze it at 10:20 am on 8 Oct). Demo data is generated relative to today.
- After the working day ends, "New meeting" proposes tomorrow's first free slot, and "Plan" says there's no free hour left instead of booking one in the past.
- Due dates can be changed from the task panel (the prototype showed them read-only).
- The Project manager role can add people (`user.manage`) in freshly seeded databases. In a database seeded before this change, grant it in Settings → Roles & permissions.
- The profile's "Google Calendar" row is labelled Calendar: connecting it means meeting invites arrive as calendar events by email (which Google Calendar, Outlook and Apple Calendar pick up), not a two-way sync with Google.
- Payment reminders are sent when someone clicks "Send reminder" or "Remind overdue customers"; the schedule in Settings → Reminders isn't run automatically yet.
- Meeting invites are sent as calendar emails rather than through a two-way Google/Outlook calendar sync.
- Organisations are chosen by the session (the organisation menu), not by subdomain yet: the "workspace address" (`slug.bos.app`) is reserved at sign-up for that.
- Plans are recorded and their limits enforced, but no payment provider is connected: changing plan takes effect straight away, and Plan & billing shows no subscription invoices.
- A closed organisation can't be reopened from the app during its 30 days; that needs the platform team.
- The design's "Connect your calendar … sync both ways with Google or Microsoft 365" step turns on calendar-invite emails; there's no two-way calendar sync.
- Access scope narrows documents (by entity) or projects, tasks and their documents (by business unit). Customers, people, meetings and the pipeline stay visible to everyone whose role can read them.
