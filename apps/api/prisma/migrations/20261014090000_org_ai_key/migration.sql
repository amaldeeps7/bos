-- Each organisation can connect the assistant with its own Anthropic API key (stored encrypted).
ALTER TABLE "Organization" ADD COLUMN "aiKey" TEXT;
ALTER TABLE "Organization" ADD COLUMN "aiKeyHint" TEXT;
