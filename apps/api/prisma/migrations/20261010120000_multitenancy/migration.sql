-- Multitenancy, phase 1 (spec §8). Keeps existing data: every row is assigned to the one
-- organisation that exists today, which gets a real id; users become Account + Membership;
-- documents get their issuing legal entity; invoice/credit note/receipt series go per entity.

-- The organisation existing rows belong to (empty on a fresh database).
SELECT set_config('app.org_id', COALESCE((SELECT id FROM "Organization" LIMIT 1), ''), false);

-- Organisation: plan, lifecycle and billing fields
ALTER TABLE "Organization" ADD COLUMN "billEntityId" TEXT,
ADD COLUMN "billingEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "demo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'trial',
ADD COLUMN "region" TEXT NOT NULL DEFAULT 'ap-south-1',
ADD COLUMN "setupDone" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN "trialEndsAt" TIMESTAMP(3),
ALTER COLUMN "id" DROP DEFAULT;
UPDATE "Organization" SET "plan" = 'growth';

ALTER TABLE "LegalEntity" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "BusinessUnit" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "Role" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "Customer" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "CatalogItem" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "Project" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "Milestone" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "Task" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "TaskEvent" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "TimeBlock" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "Meeting" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "MeetingAttendee" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "ActionItem" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "Quote" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "Invoice" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "Payment" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "PaymentAllocation" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "CreditNote" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "Asset" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "Approval" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "Opportunity" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "AuditLog" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "Notification" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
ALTER TABLE "EmailLog" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

ALTER TABLE "Sac" DROP CONSTRAINT "Sac_pkey", ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true), ADD CONSTRAINT "Sac_pkey" PRIMARY KEY ("orgId", "code");
ALTER TABLE "LegacyMonth" DROP CONSTRAINT "LegacyMonth_pkey", ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true), ADD CONSTRAINT "LegacyMonth_pkey" PRIMARY KEY ("orgId", "month");

-- Accounts (global sign-in) from users; memberships keep the user ids so every FK still works.
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "mfaSecret" TEXT,
    "lastOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");
INSERT INTO "Account" ("id", "email", "name", "passwordHash", "createdAt") SELECT "id", lower("email"), "name", "passwordHash", "createdAt" FROM "User";

ALTER TABLE "User" RENAME TO "Membership";
ALTER TABLE "Membership" RENAME CONSTRAINT "User_pkey" TO "Membership_pkey";
ALTER TABLE "Membership" RENAME CONSTRAINT "User_managerId_fkey" TO "Membership_managerId_fkey";
ALTER TABLE "Membership" RENAME CONSTRAINT "User_roleId_fkey" TO "Membership_roleId_fkey";
ALTER INDEX "User_inviteToken_key" RENAME TO "Membership_inviteToken_key";
DROP INDEX "User_email_key";
ALTER TABLE "Membership" ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true),
ADD COLUMN "accountId" TEXT,
ADD COLUMN "scope" JSONB NOT NULL DEFAULT '{"all": true}',
DROP COLUMN "passwordHash";
UPDATE "Membership" SET "accountId" = "id";
ALTER TABLE "Membership" ALTER COLUMN "accountId" SET NOT NULL;
-- column order differs from a fresh table; harmless
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Membership_orgId_accountId_key" ON "Membership"("orgId", "accountId");
CREATE UNIQUE INDEX "Membership_orgId_email_key" ON "Membership"("orgId", "email");

-- Documents carry the entity that issued them (backfilled with today's default entity).
CREATE TEMP TABLE _def AS SELECT id FROM "LegalEntity" ORDER BY "isDefault" DESC, id LIMIT 1;

ALTER TABLE "Quote" ADD COLUMN "entityId" TEXT;
UPDATE "Quote" SET "entityId" = (SELECT id FROM _def);
ALTER TABLE "Quote" ALTER COLUMN "entityId" SET NOT NULL;
ALTER TABLE "Invoice" ADD COLUMN "entityId" TEXT;
UPDATE "Invoice" SET "entityId" = (SELECT id FROM _def);
ALTER TABLE "Invoice" ALTER COLUMN "entityId" SET NOT NULL;
ALTER TABLE "Payment" ADD COLUMN "entityId" TEXT;
UPDATE "Payment" SET "entityId" = (SELECT id FROM _def);
ALTER TABLE "Payment" ALTER COLUMN "entityId" SET NOT NULL;
ALTER TABLE "CreditNote" ADD COLUMN "entityId" TEXT;
UPDATE "CreditNote" SET "entityId" = (SELECT id FROM _def);
ALTER TABLE "CreditNote" ALTER COLUMN "entityId" SET NOT NULL;
ALTER TABLE "Project" ADD COLUMN "entityId" TEXT;
UPDATE "Project" SET "entityId" = (SELECT id FROM _def);
ALTER TABLE "Project" ALTER COLUMN "entityId" SET NOT NULL;

-- Projects: business unit by reference instead of free text.
ALTER TABLE "Project" ADD COLUMN "unitId" TEXT;
UPDATE "Project" p SET "unitId" = u.id FROM "BusinessUnit" u WHERE u.name = p.bu;
ALTER TABLE "Project" DROP COLUMN "bu";

-- Numbering: one series per type and issuing entity (invoices, credit notes, receipts), org-wide otherwise.
ALTER TABLE "Series" DROP CONSTRAINT "Series_pkey",
ADD COLUMN "entityId" TEXT,
ADD COLUMN "id" TEXT,
ADD COLUMN "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);
UPDATE "Series" SET "id" = 'sr_' || substr(md5(random()::text || type), 1, 20);
UPDATE "Series" SET "entityId" = (SELECT id FROM _def) WHERE type IN ('INVOICE', 'CREDIT_NOTE', 'RECEIPT');
ALTER TABLE "Series" ALTER COLUMN "id" SET NOT NULL, ADD CONSTRAINT "Series_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "Series_orgId_entityId_type_key" ON "Series"("orgId", "entityId", "type") NULLS NOT DISTINCT;

-- Per-tenant uniqueness
DROP INDEX "Asset_code_key"; DROP INDEX "BusinessUnit_name_key"; DROP INDEX "CreditNote_no_key"; DROP INDEX "Customer_gstin_key";
DROP INDEX "Invoice_no_key"; DROP INDEX "Payment_no_key"; DROP INDEX "Project_code_key"; DROP INDEX "Quote_no_key"; DROP INDEX "Role_name_key"; DROP INDEX "Task_key_key";
CREATE UNIQUE INDEX "Asset_orgId_code_key" ON "Asset"("orgId", "code");
CREATE UNIQUE INDEX "BusinessUnit_orgId_name_key" ON "BusinessUnit"("orgId", "name");
CREATE UNIQUE INDEX "CreditNote_entityId_no_key" ON "CreditNote"("entityId", "no");
CREATE UNIQUE INDEX "Customer_orgId_gstin_key" ON "Customer"("orgId", "gstin");
CREATE UNIQUE INDEX "Invoice_entityId_no_key" ON "Invoice"("entityId", "no");
CREATE UNIQUE INDEX "Payment_entityId_no_key" ON "Payment"("entityId", "no");
CREATE UNIQUE INDEX "Project_orgId_code_key" ON "Project"("orgId", "code");
CREATE UNIQUE INDEX "Quote_orgId_no_key" ON "Quote"("orgId", "no");
CREATE UNIQUE INDEX "Role_orgId_name_key" ON "Role"("orgId", "name");
CREATE UNIQUE INDEX "Task_orgId_key_key" ON "Task"("orgId", "key");

-- Data exports
CREATE TABLE "DataExport" (
    "orgId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true),
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Preparing',
    "path" TEXT,
    "size" INTEGER,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LegalEntity_orgId_idx" ON "LegalEntity"("orgId");
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "BusinessUnit_orgId_idx" ON "BusinessUnit"("orgId");
ALTER TABLE "BusinessUnit" ADD CONSTRAINT "BusinessUnit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Role_orgId_idx" ON "Role"("orgId");
ALTER TABLE "Role" ADD CONSTRAINT "Role_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Customer_orgId_idx" ON "Customer"("orgId");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "CatalogItem_orgId_idx" ON "CatalogItem"("orgId");
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Project_orgId_idx" ON "Project"("orgId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Milestone_orgId_idx" ON "Milestone"("orgId");
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Task_orgId_idx" ON "Task"("orgId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "TaskEvent_orgId_idx" ON "TaskEvent"("orgId");
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "TimeBlock_orgId_idx" ON "TimeBlock"("orgId");
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Meeting_orgId_idx" ON "Meeting"("orgId");
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "MeetingAttendee_orgId_idx" ON "MeetingAttendee"("orgId");
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ActionItem_orgId_idx" ON "ActionItem"("orgId");
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Quote_orgId_idx" ON "Quote"("orgId");
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Invoice_orgId_idx" ON "Invoice"("orgId");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Payment_orgId_idx" ON "Payment"("orgId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "PaymentAllocation_orgId_idx" ON "PaymentAllocation"("orgId");
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "CreditNote_orgId_idx" ON "CreditNote"("orgId");
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Asset_orgId_idx" ON "Asset"("orgId");
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Approval_orgId_idx" ON "Approval"("orgId");
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Opportunity_orgId_idx" ON "Opportunity"("orgId");
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "AuditLog_orgId_idx" ON "AuditLog"("orgId");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Notification_orgId_idx" ON "Notification"("orgId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "EmailLog_orgId_idx" ON "EmailLog"("orgId");
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Sac_orgId_idx" ON "Sac"("orgId");
ALTER TABLE "Sac" ADD CONSTRAINT "Sac_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "LegacyMonth_orgId_idx" ON "LegacyMonth"("orgId");
ALTER TABLE "LegacyMonth" ADD CONSTRAINT "LegacyMonth_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Series_orgId_idx" ON "Series"("orgId");
ALTER TABLE "Series" ADD CONSTRAINT "Series_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Membership_orgId_idx" ON "Membership"("orgId");
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "DataExport_orgId_idx" ON "DataExport"("orgId");
ALTER TABLE "DataExport" ADD CONSTRAINT "DataExport_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Series" ADD CONSTRAINT "Series_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Give the existing organisation a real id (cascades to every orgId above).
UPDATE "Organization" SET id = 'org_' || substr(md5(random()::text), 1, 10) WHERE id = 'org';
SELECT set_config('app.org_id', '', false);

