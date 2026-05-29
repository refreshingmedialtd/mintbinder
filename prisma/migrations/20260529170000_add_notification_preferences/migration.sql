-- CreateEnum
CREATE TYPE "notification_digest_frequency" AS ENUM ('off', 'daily', 'weekly');

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "price_alerts_enabled" BOOLEAN NOT NULL DEFAULT true,
    "wishlist_target_alerts_enabled" BOOLEAN NOT NULL DEFAULT true,
    "weak_price_alerts_enabled" BOOLEAN NOT NULL DEFAULT true,
    "digest_frequency" "notification_digest_frequency" NOT NULL DEFAULT 'daily',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
