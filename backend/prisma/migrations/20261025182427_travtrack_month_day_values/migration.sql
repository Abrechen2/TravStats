-- AlterTable
ALTER TABLE "travtrack_month_values" ADD COLUMN     "day_values" JSONB;

-- Backfill (TravTrack plan T5.3): every month already computed is owed once
-- more, so its next run writes the per-day values. 4 is `MONTHS_BIT`
-- (`services/travtrack/dirtyDays.ts`); the other projections' bits stay.
UPDATE "travtrack_dirty_days" AS d
   SET "done" = d."done" & ~4
  FROM "travtrack_month_values" AS m
 WHERE d."user_id" = m."user_id"
   AND date_trunc('month', d."day")::date = m."month";
