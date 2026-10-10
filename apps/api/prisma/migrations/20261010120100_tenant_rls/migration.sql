-- Row-level security: the database refuses to read or write another tenant's rows (spec §5.4).
-- The API runs every query inside a transaction that first does
--   SELECT set_config('app.org_id', <org>, true)   (and app.account_id at sign-in)
-- and connects as "bos_app", which has no BYPASSRLS. Migrations and the seed use the owner role.
-- With app.org_id unset, current_setting(..., true) is NULL and no row matches: fail closed.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['LegalEntity','BusinessUnit','Role','Customer','Sac','CatalogItem','Series','Project','Milestone','Task',
    'TaskEvent','TimeBlock','Meeting','MeetingAttendee','ActionItem','Quote','Invoice','Payment','PaymentAllocation','CreditNote',
    'Asset','Approval','Opportunity','AuditLog','Notification','EmailLog','LegacyMonth','DataExport']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant ON %I', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING ("orgId" = current_setting(''app.org_id'', true)) WITH CHECK ("orgId" = current_setting(''app.org_id'', true))', t);
  END LOOP;
END $$;

-- Memberships: your own org's rows, plus your own memberships elsewhere (for sign-in and the organisation menu).
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant ON "Membership";
CREATE POLICY tenant ON "Membership"
  USING ("orgId" = current_setting('app.org_id', true) OR "accountId" = current_setting('app.account_id', true))
  WITH CHECK ("orgId" = current_setting('app.org_id', true));

-- The application role, if it exists (docker/postgres-init.sql creates it).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bos_app') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO bos_app', current_database());
    GRANT USAGE ON SCHEMA public TO bos_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bos_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bos_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bos_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bos_app;
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN REVOKE ALL ON "_prisma_migrations" FROM bos_app; END IF;
  END IF;
END $$;

-- How many organisations an account belongs to, without revealing which (RLS hides other orgs' rows).
-- Used to refuse an admin password reset for someone who also belongs to another organisation.
CREATE OR REPLACE FUNCTION account_org_count(acc text) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT count(*)::int FROM "Membership" WHERE "accountId" = acc $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bos_app') THEN GRANT EXECUTE ON FUNCTION account_org_count(text) TO bos_app; END IF;
END $$;
