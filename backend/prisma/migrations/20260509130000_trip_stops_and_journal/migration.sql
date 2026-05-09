-- Trip-system Phase-1 iteration 3: stops + journal entries.
-- TripStop: a place visited within a trip (city, hotel, POI, hike,
-- restaurant, airport layover etc.). Domain is a free-form
-- DomainKey-style label so the timeline can render the right badge
-- colour. Coordinates optional — a textual stop is fine.
-- TripJournalEntry: dated long-form notes (Markdown). Mood / weather
-- are optional facets users can fill in if they want.
-- Both tables CASCADE on trip delete (the existing onDelete: Cascade
-- on the User → Trip relation already implies this for nested rows).
-- Hand-written like other recent migrations to dodge pre-existing
-- schema drift in the migration history (see CLAUDE.md).

CREATE TABLE IF NOT EXISTS "trip_stops" (
    "id"          TEXT NOT NULL,
    "trip_id"     TEXT NOT NULL,
    "order_idx"   INTEGER NOT NULL DEFAULT 0,
    "domain"      TEXT,
    "source_id"   TEXT,
    "title"       TEXT NOT NULL,
    "description" TEXT,
    "start_date"  TIMESTAMP(3),
    "end_date"    TIMESTAMP(3),
    "lat"         DOUBLE PRECISION,
    "lon"         DOUBLE PRECISION,
    "notes"       TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trip_stops_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "trip_stops_trip_id_idx"
    ON "trip_stops"("trip_id");
CREATE INDEX IF NOT EXISTS "trip_stops_trip_id_order_idx_idx"
    ON "trip_stops"("trip_id", "order_idx");

ALTER TABLE "trip_stops"
    ADD CONSTRAINT "trip_stops_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "trip_journal_entries" (
    "id"           TEXT NOT NULL,
    "trip_id"      TEXT NOT NULL,
    "date"         TIMESTAMP(3) NOT NULL,
    "title"        TEXT,
    "body"         TEXT NOT NULL,
    "mood"         TEXT,
    "weather"      TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trip_journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "trip_journal_entries_trip_id_idx"
    ON "trip_journal_entries"("trip_id");
CREATE INDEX IF NOT EXISTS "trip_journal_entries_trip_id_date_idx"
    ON "trip_journal_entries"("trip_id", "date");

ALTER TABLE "trip_journal_entries"
    ADD CONSTRAINT "trip_journal_entries_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
