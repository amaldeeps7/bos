-- Sessions that can be revoked, optional email verification, profile pictures, and cancelled meetings kept as history.
ALTER TABLE "Account" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Account" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "avatarAt" TIMESTAMP(3);
ALTER TABLE "Meeting" ADD COLUMN "cancelledAt" TIMESTAMP(3);
-- Accounts that already sign in (they came through an emailed invitation or set-up) count as verified,
-- so turning verification on later doesn't lock existing people out.
UPDATE "Account" SET "emailVerifiedAt" = "createdAt" WHERE "passwordHash" IS NOT NULL;
