-- Store the concrete provider object referenced by each signed webhook. The
-- column is nullable so historical events remain valid without a table rewrite
-- or speculative backfill.
ALTER TABLE "billing_webhook_events"
ADD COLUMN IF NOT EXISTS "provider_resource_id" TEXT;

-- Hosted billing verification looks up the event stream for one exact payment
-- or subscription. Keep that path selective without disturbing the existing
-- status/retention indexes.
CREATE INDEX IF NOT EXISTS "billing_webhook_provider_resource_type_idx"
ON "billing_webhook_events"("provider", "provider_resource_id", "event_type");
