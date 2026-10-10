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

Every email the app sends lands in Mailpit at http://localhost:8025. To deliver real email, set `SMTP_URL` (and `EMAIL_FROM`) in `.env`, e.g. `smtps://user:password@smtp.example.com:465`.

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

The API suite covers sign-in, permission enforcement on the API, module switches, GST by place of supply, the milestone → invoice → approval → issue → payment flow, discount-policy routing, GSTIN validation, forward-only numbering, PDF rendering, the email log, adding and inviting people, the org chart, profile permissions and reporting loops, notification switches, meeting reminders and the daily digest, meeting guests, permission-aware search, and editing projects, milestones and deals.

## How it works

- **Permissions are enforced by the API.** Every route declares the permission it needs (`@Perm('invoice.read')`); a module switched off in Settings hides its routes for everyone. Role permissions are cached in Redis and invalidated when they change. The UI reads the same permissions to decide what to show.
- **Approvals follow policy.** Invoices go to Finance before they can be issued; quotations with a discount above the limit (or above the large-quotation threshold) go to the Owner; nobody approves what they raised unless their role holds "approve own". Approving or rejecting from the Approvals screen updates the document.
- **Numbers come from a locked counter** (`SELECT … FOR UPDATE`) per document type, so two people can't get the same number. Patterns support `{prefix}`, `{yyyy}`, `{yy}`, `{fy}` and `{seq}`; counters only move forward.
- **GST** is CGST + SGST when the customer's GSTIN state matches the default issuing entity's, IGST otherwise, at the rate set per SAC code.
- **Audit log** is append-only; settings, access changes and document steps are written to it.
- **Demo mode** (`DEMO_MODE=true`) adds the design's dashed buttons — "Approve as Meera (demo)", "Issue as Meera (demo)" — so one person can walk a document through steps that belong to other roles. The audit log records who clicked. Turn it off in production; then each step needs a person who holds the permission.
- **Email.** Sending a quotation or invoice emails it to the customer's billing email with the PDF attached; credit notes, payment reminders (Settings → Reminders wording), user invitations and meeting invites (with a calendar invite that Google, Outlook and Apple Calendar understand, including updates and cancellations) all go out over SMTP. Every message is recorded with its result under Settings → Email. Without `SMTP_URL`, nothing is sent and the log says so.
- **PDFs** for quotations, invoices and credit notes are drawn on the server from Settings → Templates: layout, accent colour, logo, SAC column, bank details, a UPI QR code for the balance due, signatory line, amount in words and terms.
- **Search (⌘K / Ctrl K, or `/`)** looks across customers, projects, tasks, meetings, quotations, invoices, payments, credit notes, deals, assets and people — by name, document number, `TSK-123`, GSTIN or bank reference — and only returns what the searcher's role can see. With an empty box it offers quick actions and every page.
- **People.** Admins can add someone directly with a password they set (optionally sending a welcome email), or invite by email: the invitee gets a 7-day link to choose their own password. Names, job titles, roles and passwords can be changed later.
- **Team.** An org chart built from each person's manager, and a searchable directory, both showing who is available, in a meeting right now, or on leave. A profile shows contact details, reporting line, direct reports and the projects someone works on, with Schedule meeting and Assign task. People edit their own phone, location, working hours and leave dates; anyone with `user.manage` also sets title, team, manager and joining date (reporting loops are refused). Names elsewhere in the app (meeting attendees, task reporters, project people, search results) open the profile.
- **Your settings** (on your own profile, reached from your name at the bottom of the sidebar or the avatar on mobile): turn calendar invites on or off, meeting reminders (emailed and notified 10 minutes before, with the join link), comment emails on your tasks, and the 8:30 am daily digest of meetings, due tasks and approvals. Reminders and the digest run inside the API once a minute; Redis makes sure each goes out once even with several API instances. Set `SCHEDULER=off` to disable them. Sign out is here too.
- **Assistant.** Suggested questions are answered from live records by the API. Free-text questions go to Claude (`claude-opus-5-5`, server-side refusal fallback enabled) when `ANTHROPIC_API_KEY` is set; otherwise the assistant says so.

## Where things are

| Screen | Files |
| --- | --- |
| Shell (sidebar, header, mobile tabs, notifications, role preview) | `apps/web/src/components/shell.tsx` |
| My Work (focus, approvals, day timeline, milestones) | `apps/web/src/app/(app)/page.tsx` |
| Task ticket panel, meeting record | `apps/web/src/components/overlays.tsx` |
| Dialogs (meeting, task, customer, payment, credit note) | `apps/web/src/components/dialogs.tsx` |
| Quotation / invoice view and editor | `apps/web/src/components/docs.tsx` |
| Settings (all sections, permission matrix, email log) | `apps/web/src/components/settings.tsx` |
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
- One organisation per deployment.
