-- AlterTable
ALTER TABLE "lodging_stays" ADD COLUMN     "fx_source" TEXT;

-- Every conversion stored before this column existed came from Frankfurter
-- (ECB) — it was the only provider there was. Leaving those rows NULL would
-- make a historical, perfectly official conversion indistinguishable from one
-- of unknown origin, and the UI would mark them all "kein Kurs".
UPDATE "lodging_stays" SET "fx_source" = 'ecb' WHERE "total_price_base" IS NOT NULL;
