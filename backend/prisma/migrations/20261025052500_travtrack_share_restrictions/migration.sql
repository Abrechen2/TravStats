-- CreateTable
CREATE TABLE "travtrack_share_past_spans" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "start_day" DATE,
    "end_day" DATE,
    "start_zone" TEXT,
    "end_zone" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_share_past_spans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travtrack_share_past_flights" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "departure_time" TIMESTAMP(3),
    "arrival_time" TIMESTAMP(3),
    "dep_time_semantics" TEXT NOT NULL,
    "arr_time_semantics" TEXT NOT NULL,
    "dep_timezone" TEXT,
    "arr_timezone" TEXT,
    "dep_precision" TEXT,
    "arr_precision" TEXT,
    "actual_departure" TIMESTAMP(3),
    "actual_arrival" TIMESTAMP(3),
    "runway_departure_time" TIMESTAMP(3),
    "runway_arrival_time" TIMESTAMP(3),
    "online_check_in_opens_at" TIMESTAMP(3),
    "online_check_in_zone" TEXT,
    "dep_iata" TEXT,
    "dep_icao" TEXT,
    "arr_iata" TEXT,
    "arr_icao" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_share_past_flights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travtrack_share_past_homes" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "home_place" JSONB NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_share_past_homes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "travtrack_share_past_spans_snapshot_id_idx" ON "travtrack_share_past_spans"("snapshot_id");

-- CreateIndex
CREATE INDEX "travtrack_share_past_flights_snapshot_id_idx" ON "travtrack_share_past_flights"("snapshot_id");

-- CreateIndex
CREATE INDEX "travtrack_share_past_homes_snapshot_id_idx" ON "travtrack_share_past_homes"("snapshot_id");

-- AddForeignKey
ALTER TABLE "travtrack_share_past_spans" ADD CONSTRAINT "travtrack_share_past_spans_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "travtrack_share_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_share_past_flights" ADD CONSTRAINT "travtrack_share_past_flights_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "travtrack_share_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_share_past_homes" ADD CONSTRAINT "travtrack_share_past_homes_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "travtrack_share_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below this line (TravTrack plan T7, Codex review of the share
-- snapshot). `prisma migrate dev --create-only` generated the three tables
-- above; Prisma cannot express functions or triggers, so they are appended
-- here, as in `20261001193030_sync_change_feed`. `check:drift` cannot see
-- triggers, so `routes/__tests__/travtrack.shareRestrictions.test.ts` drives
-- each of them through writes that bypass every route.
--
-- Each trigger records the OLD state of a row that restricted a shared route
-- — a trip's days, a flight of the trip, the owner's home — in the
-- transaction of the change, so the restriction can never be lost by a
-- failure after it or by a path that forgot to call the application. It
-- writes only where the account has a shared route, and only when a column
-- that decides the restriction actually changed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION travtrack_share_capture_trip_span()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO "travtrack_share_past_spans"
    ("id", "snapshot_id", "start_date", "end_date", "start_day", "end_day", "start_zone", "end_zone")
  SELECT gen_random_uuid()::text, s."id", OLD."start_date", OLD."end_date", OLD."start_day",
         OLD."end_day", OLD."start_zone", OLD."end_zone"
  FROM "travtrack_share_snapshots" s
  WHERE s."trip_id" = OLD."id" AND s."user_id" = OLD."user_id";
  RETURN NULL;
END $fn$;

CREATE TRIGGER "travtrack_share_trip_span"
AFTER UPDATE OF "start_date", "end_date", "start_day", "end_day", "start_zone", "end_zone" ON "trips"
FOR EACH ROW
WHEN (
  OLD."start_date" IS DISTINCT FROM NEW."start_date"
  OR OLD."end_date" IS DISTINCT FROM NEW."end_date"
  OR OLD."start_day" IS DISTINCT FROM NEW."start_day"
  OR OLD."end_day" IS DISTINCT FROM NEW."end_day"
  OR OLD."start_zone" IS DISTINCT FROM NEW."start_zone"
  OR OLD."end_zone" IS DISTINCT FROM NEW."end_zone"
)
EXECUTE FUNCTION travtrack_share_capture_trip_span();

-- A flight that armed a recorder window on the trip (linked, not cancelled),
-- deleted or changed in anything that places that window.
CREATE OR REPLACE FUNCTION travtrack_share_capture_flight()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW."trip_id" IS NOT DISTINCT FROM OLD."trip_id"
     AND NEW."user_id" IS NOT DISTINCT FROM OLD."user_id"
     AND NEW."status" IS NOT DISTINCT FROM OLD."status"
     AND NEW."departure_time" IS NOT DISTINCT FROM OLD."departure_time"
     AND NEW."arrival_time" IS NOT DISTINCT FROM OLD."arrival_time"
     AND NEW."dep_time_semantics" IS NOT DISTINCT FROM OLD."dep_time_semantics"
     AND NEW."arr_time_semantics" IS NOT DISTINCT FROM OLD."arr_time_semantics"
     AND NEW."dep_timezone" IS NOT DISTINCT FROM OLD."dep_timezone"
     AND NEW."arr_timezone" IS NOT DISTINCT FROM OLD."arr_timezone"
     AND NEW."dep_precision" IS NOT DISTINCT FROM OLD."dep_precision"
     AND NEW."arr_precision" IS NOT DISTINCT FROM OLD."arr_precision"
     AND NEW."actual_departure" IS NOT DISTINCT FROM OLD."actual_departure"
     AND NEW."actual_arrival" IS NOT DISTINCT FROM OLD."actual_arrival"
     AND NEW."runway_departure_time" IS NOT DISTINCT FROM OLD."runway_departure_time"
     AND NEW."runway_arrival_time" IS NOT DISTINCT FROM OLD."runway_arrival_time"
     AND NEW."online_check_in_opens_at" IS NOT DISTINCT FROM OLD."online_check_in_opens_at"
     AND NEW."online_check_in_zone" IS NOT DISTINCT FROM OLD."online_check_in_zone"
     AND NEW."dep_iata" IS NOT DISTINCT FROM OLD."dep_iata"
     AND NEW."dep_icao" IS NOT DISTINCT FROM OLD."dep_icao"
     AND NEW."arr_iata" IS NOT DISTINCT FROM OLD."arr_iata"
     AND NEW."arr_icao" IS NOT DISTINCT FROM OLD."arr_icao"
  THEN
    RETURN NULL;
  END IF;
  INSERT INTO "travtrack_share_past_flights"
    ("id", "snapshot_id", "departure_time", "arrival_time", "dep_time_semantics",
     "arr_time_semantics", "dep_timezone", "arr_timezone", "dep_precision", "arr_precision",
     "actual_departure", "actual_arrival", "runway_departure_time", "runway_arrival_time",
     "online_check_in_opens_at", "online_check_in_zone", "dep_iata", "dep_icao", "arr_iata",
     "arr_icao")
  SELECT gen_random_uuid()::text, s."id", OLD."departure_time", OLD."arrival_time",
         OLD."dep_time_semantics", OLD."arr_time_semantics", OLD."dep_timezone",
         OLD."arr_timezone", OLD."dep_precision", OLD."arr_precision", OLD."actual_departure",
         OLD."actual_arrival", OLD."runway_departure_time", OLD."runway_arrival_time",
         OLD."online_check_in_opens_at", OLD."online_check_in_zone", OLD."dep_iata",
         OLD."dep_icao", OLD."arr_iata", OLD."arr_icao"
  FROM "travtrack_share_snapshots" s
  WHERE s."trip_id" = OLD."trip_id" AND s."user_id" = OLD."user_id";
  RETURN NULL;
END $fn$;

CREATE TRIGGER "travtrack_share_flight"
AFTER UPDATE OR DELETE ON "flights"
FOR EACH ROW
WHEN (OLD."trip_id" IS NOT NULL AND OLD."status" <> 'cancelled')
EXECUTE FUNCTION travtrack_share_capture_flight();

-- The home the owner had, whenever it changes or the settings row goes.
CREATE OR REPLACE FUNCTION travtrack_share_capture_home()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."home_place" IS NOT DISTINCT FROM OLD."home_place" THEN
    RETURN NULL;
  END IF;
  INSERT INTO "travtrack_share_past_homes" ("id", "snapshot_id", "home_place")
  SELECT gen_random_uuid()::text, s."id", OLD."home_place"
  FROM "travtrack_share_snapshots" s
  WHERE s."user_id" = OLD."user_id";
  RETURN NULL;
END $fn$;

CREATE TRIGGER "travtrack_share_home"
AFTER UPDATE OF "home_place" OR DELETE ON "user_settings"
FOR EACH ROW
WHEN (OLD."home_place" IS NOT NULL AND OLD."home_place" <> 'null'::jsonb)
EXECUTE FUNCTION travtrack_share_capture_home();
