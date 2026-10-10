-- Two-factor sign-in: backup codes and replay protection (the encrypted TOTP secret uses the existing "mfaSecret").
ALTER TABLE "Account" ADD COLUMN "mfaBackup" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Account" ADD COLUMN "mfaStep" INTEGER NOT NULL DEFAULT 0;
