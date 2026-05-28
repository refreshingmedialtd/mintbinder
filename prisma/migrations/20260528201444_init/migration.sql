-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "subscription_plan" AS ENUM ('free', 'plus_monthly', 'plus_yearly');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid');

-- CreateEnum
CREATE TYPE "item_type" AS ENUM ('card', 'sealed_product');

-- CreateEnum
CREATE TYPE "item_condition" AS ENUM ('unknown', 'poor', 'played', 'light_played', 'excellent', 'near_mint', 'mint', 'sealed');

-- CreateEnum
CREATE TYPE "grading_company" AS ENUM ('psa', 'bgs', 'cgc', 'ace', 'sgc', 'other');

-- CreateEnum
CREATE TYPE "sealed_product_type" AS ENUM ('booster_box', 'booster_pack', 'elite_trainer_box', 'collection_box', 'tin', 'blister', 'deck', 'case', 'other');

-- CreateEnum
CREATE TYPE "storage_location_type" AS ENUM ('binder', 'box', 'display', 'safe', 'other');

-- CreateEnum
CREATE TYPE "wishlist_priority" AS ENUM ('low', 'medium', 'high', 'grail');

-- CreateEnum
CREATE TYPE "collection_event_type" AS ENUM ('added', 'edited', 'sold', 'removed', 'graded', 'moved', 'imported');

-- CreateEnum
CREATE TYPE "catalogue_visibility" AS ENUM ('global', 'private', 'pending_review');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "preferred_currency" TEXT NOT NULL DEFAULT 'GBP',
    "preferred_region" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_customer_id" TEXT,
    "provider_subscription_id" TEXT,
    "plan" "subscription_plan" NOT NULL DEFAULT 'free',
    "status" "subscription_status" NOT NULL DEFAULT 'active',
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_sets" (
    "id" UUID NOT NULL,
    "provider_ids" JSONB NOT NULL DEFAULT '{}',
    "name" TEXT NOT NULL,
    "series" TEXT,
    "release_date" DATE,
    "printed_total" INTEGER,
    "total" INTEGER,
    "symbol_image_url" TEXT,
    "logo_image_url" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_printings" (
    "id" UUID NOT NULL,
    "card_set_id" UUID NOT NULL,
    "provider_ids" JSONB NOT NULL DEFAULT '{}',
    "name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "rarity" TEXT,
    "supertype" TEXT,
    "subtypes" TEXT[],
    "artist" TEXT,
    "image_small_url" TEXT,
    "image_large_url" TEXT,
    "legalities" JSONB NOT NULL DEFAULT '{}',
    "variant_metadata" JSONB NOT NULL DEFAULT '{}',
    "search_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_printings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sealed_products" (
    "id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "related_card_set_id" UUID,
    "provider_ids" JSONB NOT NULL DEFAULT '{}',
    "name" TEXT NOT NULL,
    "product_type" "sealed_product_type" NOT NULL,
    "release_date" DATE,
    "image_url" TEXT,
    "notes" TEXT,
    "visibility" "catalogue_visibility" NOT NULL DEFAULT 'global',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sealed_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_locations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "storage_location_type" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_type" "item_type" NOT NULL,
    "card_printing_id" UUID,
    "sealed_product_id" UUID,
    "quantity" INTEGER NOT NULL,
    "condition" "item_condition" NOT NULL DEFAULT 'unknown',
    "language" TEXT NOT NULL DEFAULT 'en',
    "variant_label" TEXT,
    "graded_company" "grading_company",
    "graded_score" DECIMAL(4,1),
    "purchase_price_minor" INTEGER,
    "purchase_currency" TEXT,
    "purchase_date" DATE,
    "current_value_override_minor" INTEGER,
    "current_value_override_currency" TEXT,
    "storage_location_id" UUID,
    "notes" TEXT,
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sold_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_type" "item_type" NOT NULL,
    "card_printing_id" UUID,
    "sealed_product_id" UUID,
    "target_price_minor" INTEGER,
    "target_currency" TEXT,
    "priority" "wishlist_priority" NOT NULL DEFAULT 'medium',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" UUID NOT NULL,
    "item_type" "item_type" NOT NULL,
    "card_printing_id" UUID,
    "sealed_product_id" UUID,
    "source" TEXT NOT NULL,
    "source_ref" TEXT,
    "condition" "item_condition",
    "language" TEXT,
    "variant_label" TEXT,
    "graded_company" "grading_company",
    "graded_score" DECIMAL(4,1),
    "price_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "confidence_score" INTEGER NOT NULL,
    "sample_size" INTEGER,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "collection_item_id" UUID NOT NULL,
    "event_type" "collection_event_type" NOT NULL,
    "quantity" INTEGER,
    "amount_minor" INTEGER,
    "currency" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_provider_customer_id_key" ON "subscriptions"("provider_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_provider_subscription_id_key" ON "subscriptions"("provider_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "card_sets_name_idx" ON "card_sets"("name");

-- CreateIndex
CREATE INDEX "card_sets_series_idx" ON "card_sets"("series");

-- CreateIndex
CREATE INDEX "card_printings_card_set_id_idx" ON "card_printings"("card_set_id");

-- CreateIndex
CREATE INDEX "card_printings_name_idx" ON "card_printings"("name");

-- CreateIndex
CREATE INDEX "card_printings_card_set_id_number_idx" ON "card_printings"("card_set_id", "number");

-- CreateIndex
CREATE INDEX "card_printings_search_text_idx" ON "card_printings"("search_text");

-- CreateIndex
CREATE INDEX "sealed_products_name_idx" ON "sealed_products"("name");

-- CreateIndex
CREATE INDEX "sealed_products_product_type_idx" ON "sealed_products"("product_type");

-- CreateIndex
CREATE INDEX "sealed_products_related_card_set_id_idx" ON "sealed_products"("related_card_set_id");

-- CreateIndex
CREATE INDEX "sealed_products_created_by_user_id_idx" ON "sealed_products"("created_by_user_id");

-- CreateIndex
CREATE INDEX "storage_locations_user_id_idx" ON "storage_locations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_user_id_name_key" ON "storage_locations"("user_id", "name");

-- CreateIndex
CREATE INDEX "collection_items_user_id_idx" ON "collection_items"("user_id");

-- CreateIndex
CREATE INDEX "collection_items_user_id_item_type_idx" ON "collection_items"("user_id", "item_type");

-- CreateIndex
CREATE INDEX "collection_items_user_id_card_printing_id_idx" ON "collection_items"("user_id", "card_printing_id");

-- CreateIndex
CREATE INDEX "collection_items_user_id_sealed_product_id_idx" ON "collection_items"("user_id", "sealed_product_id");

-- CreateIndex
CREATE INDEX "collection_items_user_id_storage_location_id_idx" ON "collection_items"("user_id", "storage_location_id");

-- CreateIndex
CREATE INDEX "collection_items_user_id_archived_at_idx" ON "collection_items"("user_id", "archived_at");

-- CreateIndex
CREATE INDEX "wishlist_items_user_id_idx" ON "wishlist_items"("user_id");

-- CreateIndex
CREATE INDEX "wishlist_items_user_id_priority_idx" ON "wishlist_items"("user_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_user_id_card_printing_id_key" ON "wishlist_items"("user_id", "card_printing_id");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_user_id_sealed_product_id_key" ON "wishlist_items"("user_id", "sealed_product_id");

-- CreateIndex
CREATE INDEX "price_snapshots_item_type_card_printing_id_observed_at_idx" ON "price_snapshots"("item_type", "card_printing_id", "observed_at");

-- CreateIndex
CREATE INDEX "price_snapshots_item_type_sealed_product_id_observed_at_idx" ON "price_snapshots"("item_type", "sealed_product_id", "observed_at");

-- CreateIndex
CREATE INDEX "price_snapshots_source_observed_at_idx" ON "price_snapshots"("source", "observed_at");

-- CreateIndex
CREATE INDEX "price_snapshots_currency_observed_at_idx" ON "price_snapshots"("currency", "observed_at");

-- CreateIndex
CREATE INDEX "collection_events_user_id_idx" ON "collection_events"("user_id");

-- CreateIndex
CREATE INDEX "collection_events_collection_item_id_idx" ON "collection_events"("collection_item_id");

-- CreateIndex
CREATE INDEX "collection_events_user_id_occurred_at_idx" ON "collection_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "collection_events_user_id_event_type_idx" ON "collection_events"("user_id", "event_type");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_printings" ADD CONSTRAINT "card_printings_card_set_id_fkey" FOREIGN KEY ("card_set_id") REFERENCES "card_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sealed_products" ADD CONSTRAINT "sealed_products_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sealed_products" ADD CONSTRAINT "sealed_products_related_card_set_id_fkey" FOREIGN KEY ("related_card_set_id") REFERENCES "card_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_card_printing_id_fkey" FOREIGN KEY ("card_printing_id") REFERENCES "card_printings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_sealed_product_id_fkey" FOREIGN KEY ("sealed_product_id") REFERENCES "sealed_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_card_printing_id_fkey" FOREIGN KEY ("card_printing_id") REFERENCES "card_printings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_sealed_product_id_fkey" FOREIGN KEY ("sealed_product_id") REFERENCES "sealed_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_card_printing_id_fkey" FOREIGN KEY ("card_printing_id") REFERENCES "card_printings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_sealed_product_id_fkey" FOREIGN KEY ("sealed_product_id") REFERENCES "sealed_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_events" ADD CONSTRAINT "collection_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_events" ADD CONSTRAINT "collection_events_collection_item_id_fkey" FOREIGN KEY ("collection_item_id") REFERENCES "collection_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
