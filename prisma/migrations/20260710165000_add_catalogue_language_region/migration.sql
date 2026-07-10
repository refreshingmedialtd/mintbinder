ALTER TABLE "card_sets"
ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN "region" TEXT NOT NULL DEFAULT 'international';

ALTER TABLE "card_printings"
ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN "region" TEXT NOT NULL DEFAULT 'international';

CREATE INDEX "card_sets_language_idx" ON "card_sets"("language");
CREATE INDEX "card_sets_region_idx" ON "card_sets"("region");
CREATE INDEX "card_printings_language_idx" ON "card_printings"("language");
CREATE INDEX "card_printings_region_idx" ON "card_printings"("region");
