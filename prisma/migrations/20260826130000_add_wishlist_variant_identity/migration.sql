-- Wishlist targets need to identify the exact card finish whose price should
-- drive alerts. Existing rows remain NULL and retain their legacy
-- any/preferred-variant behaviour until the user chooses a finish.
ALTER TABLE "wishlist_items"
ADD COLUMN "variant_label" TEXT;
