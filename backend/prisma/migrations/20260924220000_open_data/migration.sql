-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "open_data_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "lodgings" ADD COLUMN     "website" TEXT,
ADD COLUMN     "wikidata_id" TEXT;

-- AlterTable
ALTER TABLE "places" ADD COLUMN     "wikidata_id" TEXT;

-- AlterTable
ALTER TABLE "trip_journal_entries" ADD COLUMN     "observed_weather" JSONB;
