-- GST becomes optional: entities can be unregistered (plain invoices, no tax), customers can have no GSTIN.
ALTER TABLE "LegalEntity" ADD COLUMN "gst" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "LegalEntity" ADD COLUMN "state" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ADD COLUMN "state" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ALTER COLUMN "gstin" DROP NOT NULL;
UPDATE "Customer" SET "gstin" = NULL WHERE "gstin" = '';
ALTER TABLE "Quote" ADD COLUMN "gst" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Invoice" ADD COLUMN "gst" BOOLEAN NOT NULL DEFAULT true;
-- Keep the state codes filled in from the GSTIN, so place of supply never depends on which field is set.
UPDATE "LegalEntity" SET "state" = substr("gstin", 1, 2) WHERE "gstin" <> '';
UPDATE "Customer" SET "state" = substr("gstin", 1, 2) WHERE "gstin" IS NOT NULL;
