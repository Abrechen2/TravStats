-- A share link's real end, stored (see `PublicShareLink.effectiveExpiresAt`).
-- Existing links start at the owner's end; the first read of a flight link
-- lowers it to the flight's landing-plus-grace, and nothing ever raises it.
ALTER TABLE "public_share_links" ADD COLUMN "effective_expires_at" TIMESTAMP(3);
UPDATE "public_share_links" SET "effective_expires_at" = "expires_at";
ALTER TABLE "public_share_links" ALTER COLUMN "effective_expires_at" SET NOT NULL;
