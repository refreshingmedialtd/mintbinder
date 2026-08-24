-- CreateEnum
CREATE TYPE "binder_visibility" AS ENUM ('private', 'unlisted');

-- CreateEnum
CREATE TYPE "billing_webhook_status" AS ENUM ('processing', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "billing_customer_provenance" AS ENUM ('app_created', 'provider_matched', 'legacy_subscription');

-- AlterEnum
ALTER TYPE "job_run_type" ADD VALUE 'billing_checkout_retirement';
ALTER TYPE "job_run_type" ADD VALUE 'password_reset_delivery';

-- CreateEnum
CREATE TYPE "account_token_type" AS ENUM ('email_verification', 'password_reset');

-- CreateEnum
CREATE TYPE "notification_delivery_status" AS ENUM ('claimed', 'sent', 'ambiguous');

-- CreateEnum
CREATE TYPE "password_reset_outbox_status" AS ENUM ('queued', 'claimed', 'sent', 'discarded', 'unresolved');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "provider_updated_at" TIMESTAMP(3);
UPDATE "subscriptions"
SET "provider_updated_at" = "updated_at"
WHERE "provider" IN ('square', 'stripe') AND "provider_updated_at" IS NULL;

-- Existing password accounts predate email verification. Trust those accounts
-- during the rollout; newly registered accounts start unverified.
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "deletion_requested_at" TIMESTAMP(3);
UPDATE "users" SET "email_verified_at" = COALESCE("updated_at", "created_at") WHERE "password_hash" IS NOT NULL;

-- CreateTable
CREATE TABLE "binders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cover_style" TEXT NOT NULL DEFAULT 'forest',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "visibility" "binder_visibility" NOT NULL DEFAULT 'private',
    "share_slug" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "binders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "binder_pages" (
    "id" UUID NOT NULL,
    "binder_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "binder_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "binder_slots" (
    "id" UUID NOT NULL,
    "binder_page_id" UUID NOT NULL,
    "collection_item_id" UUID,
    "position" INTEGER NOT NULL,
    "copy_index" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "binder_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" "billing_webhook_status" NOT NULL DEFAULT 'processing',
    "occurred_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_checkout_intents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "plan" "subscription_plan" NOT NULL,
    "status" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "lease_token" TEXT NOT NULL,
    "lease_expires_at" TIMESTAMP(3) NOT NULL,
    "provider_checkout_id" TEXT,
    "provider_order_id" TEXT,
    "provider_payment_id" TEXT,
    "provider_customer_id" TEXT,
    "expected_amount_minor" INTEGER,
    "expected_currency" TEXT,
    "provider_plan_variation_id" TEXT,
    "checkout_origin" TEXT NOT NULL,
    "checkout_url" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_checkout_intents_pkey" PRIMARY KEY ("id")
);

-- A provider customer can back multiple historical subscriptions for one user,
-- but it must never be shared across Mint Binder tenants.
CREATE TABLE "billing_customers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_customer_id" TEXT NOT NULL,
    "provenance" "billing_customer_provenance" NOT NULL DEFAULT 'provider_matched',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id")
);

INSERT INTO "billing_customers" ("id", "user_id", "provider", "provider_customer_id", "provenance", "created_at", "updated_at")
SELECT md5("provider" || ':' || "provider_customer_id")::uuid, "user_id", "provider", "provider_customer_id", 'legacy_subscription', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "subscriptions"
WHERE "provider_customer_id" IS NOT NULL
ON CONFLICT DO NOTHING;

-- CreateTable
CREATE TABLE "account_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "account_token_type" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_throttles" (
    "key_hash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "blocked_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_throttles_pkey" PRIMARY KEY ("key_hash")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "recipient_key" TEXT NOT NULL,
    "status" "notification_delivery_status" NOT NULL DEFAULT 'claimed',
    "provider_message_id" TEXT,
    "error_code" TEXT,
    "sent_at" TIMESTAMP(3),
    "ambiguous_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- Password-reset requests use a durable outbox so the public endpoint never
-- waits for an email provider. Unknown recipients receive a decoy row with a
-- keyed fingerprint only; their raw address is never persisted.
CREATE TABLE "password_reset_outbox" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "recipient_key" TEXT NOT NULL,
    "coalesce_key" TEXT,
    "status" "password_reset_outbox_status" NOT NULL DEFAULT 'queued',
    "claimed_at" TIMESTAMP(3),
    "delivery_attempted_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "discarded_at" TIMESTAMP(3),
    "unresolved_at" TIMESTAMP(3),
    "provider_message_id" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "password_reset_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "password_reset_outbox_active_coalesce_check" CHECK (
        ("status" IN ('queued', 'claimed') AND "coalesce_key" IS NOT NULL)
        OR ("status" IN ('sent', 'discarded', 'unresolved') AND "coalesce_key" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "set_goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "card_set_id" UUID NOT NULL,
    "target_completion_percent" INTEGER NOT NULL DEFAULT 100,
    "wishlist_priority" "wishlist_priority" NOT NULL DEFAULT 'medium',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "set_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE UNIQUE INDEX "binders_share_slug_key" ON "binders"("share_slug");
CREATE UNIQUE INDEX "binders_user_id_name_key" ON "binders"("user_id", "name");
CREATE UNIQUE INDEX "binders_one_default_per_user_key" ON "binders"("user_id") WHERE "is_default";
CREATE INDEX "binders_user_id_updated_at_idx" ON "binders"("user_id", "updated_at");
CREATE UNIQUE INDEX "binder_pages_binder_id_position_key" ON "binder_pages"("binder_id", "position");
CREATE INDEX "binder_pages_binder_id_idx" ON "binder_pages"("binder_id");
CREATE UNIQUE INDEX "binder_slots_binder_page_id_position_key" ON "binder_slots"("binder_page_id", "position");
-- If legacy layouts assigned one owned copy to multiple binders, retain the
-- earliest pocket and clear only the duplicate assignments before enforcing
-- the cross-binder invariant at the database boundary.
WITH ranked_binder_copies AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY collection_item_id, copy_index
      ORDER BY created_at ASC, id ASC
    ) AS copy_rank
  FROM binder_slots
  WHERE collection_item_id IS NOT NULL AND copy_index IS NOT NULL
)
UPDATE binder_slots AS slot
SET collection_item_id = NULL, copy_index = NULL
FROM ranked_binder_copies AS ranked
WHERE slot.id = ranked.id AND ranked.copy_rank > 1;
CREATE UNIQUE INDEX "binder_slots_collection_item_id_copy_index_key" ON "binder_slots"("collection_item_id", "copy_index");
CREATE INDEX "binder_slots_collection_item_id_idx" ON "binder_slots"("collection_item_id");
CREATE UNIQUE INDEX "billing_webhook_events_provider_provider_event_id_key" ON "billing_webhook_events"("provider", "provider_event_id");
CREATE INDEX "billing_webhook_events_status_created_at_idx" ON "billing_webhook_events"("status", "created_at");
CREATE INDEX "billing_webhook_events_status_processed_at_idx" ON "billing_webhook_events"("status", "processed_at");
CREATE UNIQUE INDEX "billing_checkout_intents_idempotency_key_key" ON "billing_checkout_intents"("idempotency_key");
CREATE UNIQUE INDEX "billing_checkout_intents_provider_payment_id_key" ON "billing_checkout_intents"("provider_payment_id");
CREATE INDEX "billing_checkout_intents_user_id_provider_status_updated_at_idx" ON "billing_checkout_intents"("user_id", "provider", "status", "updated_at");
CREATE INDEX "billing_checkout_intents_expires_at_idx" ON "billing_checkout_intents"("expires_at");
CREATE UNIQUE INDEX "billing_customers_provider_provider_customer_id_key" ON "billing_customers"("provider", "provider_customer_id");
CREATE INDEX "billing_customers_user_id_provider_idx" ON "billing_customers"("user_id", "provider");
CREATE UNIQUE INDEX "account_tokens_token_hash_key" ON "account_tokens"("token_hash");
CREATE INDEX "account_tokens_user_id_type_expires_at_idx" ON "account_tokens"("user_id", "type", "expires_at");
CREATE INDEX "account_tokens_expires_at_idx" ON "account_tokens"("expires_at");
CREATE INDEX "auth_throttles_blocked_until_idx" ON "auth_throttles"("blocked_until");
CREATE INDEX "auth_throttles_updated_at_idx" ON "auth_throttles"("updated_at");
CREATE UNIQUE INDEX "notification_deliveries_kind_period_key_recipient_key_key" ON "notification_deliveries"("kind", "period_key", "recipient_key");
CREATE INDEX "notification_deliveries_user_id_created_at_idx" ON "notification_deliveries"("user_id", "created_at");
CREATE INDEX "notification_deliveries_status_updated_at_idx" ON "notification_deliveries"("status", "updated_at");
CREATE INDEX "password_reset_outbox_status_created_at_idx" ON "password_reset_outbox"("status", "created_at");
CREATE INDEX "password_reset_outbox_user_id_created_at_idx" ON "password_reset_outbox"("user_id", "created_at");
CREATE UNIQUE INDEX "password_reset_outbox_coalesce_key_key" ON "password_reset_outbox"("coalesce_key");
CREATE INDEX "job_runs_status_finished_at_idx" ON "job_runs"("status", "finished_at");
CREATE UNIQUE INDEX "set_goals_user_id_key" ON "set_goals"("user_id");
CREATE INDEX "set_goals_card_set_id_idx" ON "set_goals"("card_set_id");
CREATE INDEX "subscriptions_provider_provider_customer_id_idx" ON "subscriptions"("provider", "provider_customer_id");
CREATE INDEX "card_printings_search_text_trgm_idx" ON "card_printings" USING GIN ("search_text" gin_trgm_ops);
CREATE INDEX "sealed_products_name_trgm_idx" ON "sealed_products" USING GIN ("name" gin_trgm_ops);

-- New rows must maintain catalogue-reference and numeric invariants. These are
-- intentionally NOT VALID so existing production rows can be audited before a
-- later validation migration without making this release unsafe to deploy.
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_item_reference_check"
CHECK (
  ("item_type" = 'card' AND "card_printing_id" IS NOT NULL AND "sealed_product_id" IS NULL)
  OR
  ("item_type" = 'sealed_product' AND "sealed_product_id" IS NOT NULL AND "card_printing_id" IS NULL)
) NOT VALID;
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_quantity_check" CHECK ("quantity" > 0) NOT VALID;
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_money_check" CHECK (
  ("purchase_price_minor" IS NULL OR "purchase_price_minor" >= 0)
  AND ("current_value_override_minor" IS NULL OR "current_value_override_minor" >= 0)
) NOT VALID;
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_item_reference_check"
CHECK (
  ("item_type" = 'card' AND "card_printing_id" IS NOT NULL AND "sealed_product_id" IS NULL)
  OR
  ("item_type" = 'sealed_product' AND "sealed_product_id" IS NOT NULL AND "card_printing_id" IS NULL)
) NOT VALID;
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_item_reference_check"
CHECK (
  ("item_type" = 'card' AND "card_printing_id" IS NOT NULL AND "sealed_product_id" IS NULL)
  OR
  ("item_type" = 'sealed_product' AND "sealed_product_id" IS NOT NULL AND "card_printing_id" IS NULL)
) NOT VALID;
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_numeric_check" CHECK (
  "price_minor" >= 0
  AND "confidence_score" BETWEEN 0 AND 100
  AND ("sample_size" IS NULL OR "sample_size" >= 0)
) NOT VALID;
ALTER TABLE "collection_events" ADD CONSTRAINT "collection_events_numeric_check" CHECK (
  ("quantity" IS NULL OR "quantity" > 0)
  AND ("amount_minor" IS NULL OR "amount_minor" >= 0)
) NOT VALID;
ALTER TABLE "set_goals" ADD CONSTRAINT "set_goals_target_completion_percent_check"
CHECK ("target_completion_percent" BETWEEN 1 AND 100);

-- AddForeignKey
ALTER TABLE "binders" ADD CONSTRAINT "binders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "binder_pages" ADD CONSTRAINT "binder_pages_binder_id_fkey" FOREIGN KEY ("binder_id") REFERENCES "binders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "binder_slots" ADD CONSTRAINT "binder_slots_binder_page_id_fkey" FOREIGN KEY ("binder_page_id") REFERENCES "binder_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "binder_slots" ADD CONSTRAINT "binder_slots_collection_item_id_fkey" FOREIGN KEY ("collection_item_id") REFERENCES "collection_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "password_reset_outbox" ADD CONSTRAINT "password_reset_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_checkout_intents" ADD CONSTRAINT "billing_checkout_intents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "set_goals" ADD CONSTRAINT "set_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "set_goals" ADD CONSTRAINT "set_goals_card_set_id_fkey" FOREIGN KEY ("card_set_id") REFERENCES "card_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Legacy price-alert job payloads could contain recipient email addresses and
-- user UUIDs. Retain only non-identifying aggregate diagnostics.
UPDATE "job_runs"
SET
  "request_payload" = jsonb_build_object(
    'redacted', true,
    'dryRun', COALESCE("request_payload"->'dryRun', 'null'::jsonb),
    'now', COALESCE("request_payload"->'now', 'null'::jsonb)
  ),
  "result_payload" = jsonb_build_object(
    'redacted', true,
    'dryRun', COALESCE("result_payload"->'dryRun', 'null'::jsonb),
    'emailConfigured', COALESCE("result_payload"->'emailConfigured', 'null'::jsonb),
    'users', COALESCE("result_payload"->'users', '0'::jsonb),
    'resultCount', CASE
      WHEN jsonb_typeof("result_payload"->'results') = 'array'
        THEN to_jsonb(jsonb_array_length("result_payload"->'results'))
      ELSE '0'::jsonb
    END
  )
WHERE "job_type" = 'price_alerts'::job_run_type;
