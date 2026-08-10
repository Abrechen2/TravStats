-- Backfill: make total_price authoritative on existing rows.
--
-- The StayEditor has always typed total_price (deriving per-night for display),
-- but the import/API path could store price_per_night with a null total. The
-- app now derives the total on write; this fills the total for rows written
-- before that, so the trip-cost sum and every average read one source of truth
-- and the frontend's per-night fallback can retire.
--
-- Data-only, idempotent: touches only rows with a per-night price, no total,
-- and a positive night count. total = price_per_night * nights, nights rounded
-- from the check-in/check-out span (matches nightsBetween()).
UPDATE "lodging_stays"
SET "total_price" = "price_per_night" * GREATEST(
      1,
      ROUND(EXTRACT(EPOCH FROM ("check_out" - "check_in")) / 86400.0)
    )
WHERE "total_price" IS NULL
  AND "price_per_night" IS NOT NULL
  AND "price_per_night" > 0
  AND "check_out" > "check_in";
