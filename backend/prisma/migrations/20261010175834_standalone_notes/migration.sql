-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT,
    "body" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "occurred_zone" TEXT NOT NULL,
    "occurred_precision" TEXT NOT NULL DEFAULT 'minute',
    "place_name" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "photo_filename" TEXT,
    "photo_mimetype" TEXT,
    "photo_size_bytes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notes_user_id_occurred_at_idx" ON "notes"("user_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "notes_user_id_client_id_key" ON "notes"("user_id", "client_id");

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-added below the generated part (forgejo#137). Prisma does not model
-- CHECK constraints or triggers, so neither shows up as schema drift.
-- ---------------------------------------------------------------------------

-- A note is dated to the minute or to the day; nothing else is stored.
ALTER TABLE "notes" ADD CONSTRAINT "notes_occurred_precision_check"
  CHECK ("occurred_precision" IN ('minute', 'day'));

-- A position is a pair or nothing: half a coordinate places a note nowhere.
ALTER TABLE "notes" ADD CONSTRAINT "notes_position_pair_check"
  CHECK (("lat" IS NULL) = ("lon" IS NULL));

-- The photo's three columns are written together and cleared together.
ALTER TABLE "notes" ADD CONSTRAINT "notes_photo_columns_check"
  CHECK (("photo_filename" IS NULL) = ("photo_mimetype" IS NULL)
     AND ("photo_filename" IS NULL) = ("photo_size_bytes" IS NULL));

-- Notes join the Companion's change feed (forgejo#141) from the start: the
-- phone keeps them offline (companion#28, `lib/moments.ts`) and must hear of an
-- edit made on the web. `notes` carries `user_id`, so the owner is read off the
-- row. `syncTriggers.test.ts` holds this list against `SYNC_ENTITIES`.
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "notes"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('note', '');

CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "notes"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
