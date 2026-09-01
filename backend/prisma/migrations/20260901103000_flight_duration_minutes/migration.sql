-- Persist the measured flight duration (forgejo#45).
--
-- Until now nothing stored it: `/stats/summary`, `/stats/timeseries`,
-- `GET /flights` and the web client each re-derived the same figure, and only
-- two of the four shared a rule. This column ends the re-derivation for every
-- reader whose answer the row alone determines.
--
-- WHY GENERATED, NOT WRITE-THROUGH
-- The value has four inputs: departure_time, arrival_time, dep_time_semantics
-- and arr_time_semantics. Eight code paths write at least one of them (both
-- create routes, the update route, pendingUpdateService, flightAutoUpdate,
-- bulkFlightRefresh, backfillTimeSemantics, fixMistaggedDurations). A column
-- written by hand at each of those is true only until the ninth path is added
-- by someone who does not know it exists — and a stale duration is worse than
-- a derived one, because a derived one is at least honest. Postgres is the one
-- place all writers meet, so the rule lives there and cannot be bypassed.
-- A STORED generated column is also computed for every existing row during
-- this ADD COLUMN, so there is no backfill script to run or to forget.
--
-- WHY THE AIRPORT CATALOGUE IS NOT AN INPUT HERE
-- `tzAwareDurationMinutes` consults the departure/arrival airport timezones in
-- exactly ONE case: when both endpoints are tagged LEGACY_FAKE_UTC, where the
-- stored components are wall-clock rather than instants. For every other
-- tagging — UTC (all current writes), UNKNOWN, DATE_ONLY — the timezone is
-- never read and the duration is a pure function of this row.
--
-- That asymmetry decides the invalidation rule. A timezone correction on an
-- airport row moves the duration of every LEGACY_FAKE_UTC flight that used it
-- while those flight rows stand still, so no write-trigger of any kind could
-- keep a stored value true for them. Rather than store a claim the database
-- cannot maintain, this expression yields NULL for that class and the reader
-- (`measuredDurationMinutes` in src/utils/flightDurationColumn.ts) derives it
-- from the catalogue on read, exactly as all four consumers do today. The
-- class is closed and shrinking: nothing creates LEGACY_FAKE_UTC rows any
-- more, and scripts/fixMistaggedDurations.ts retags them to UTC.
--
-- NULL therefore means either "no measurable duration" (missing time, or a
-- DATE_ONLY placeholder that is not evidence — #106A) or "ask the catalogue"
-- (the legacy pair). The two are told apart by the semantics columns, which
-- every consumer already selects. NULL never means zero: zero minutes and no
-- duration are different facts, and conflating them is the bug #268 removed.
--
-- DOUBLE PRECISION, not INTEGER: this is byte-for-byte what
-- `tzAwareDurationMinutes` returns, so a sum over the column reaches the same
-- total the request-time loops reach today. Rounding stays at the API edge.

ALTER TABLE "flights" ADD COLUMN "duration_minutes" DOUBLE PRECISION
  GENERATED ALWAYS AS (
    CASE
      -- No pair of clocks, no measurement.
      WHEN "departure_time" IS NULL OR "arrival_time" IS NULL THEN NULL
      -- #106A: a DATE_ONLY side carries a 12:00 placeholder, not a time.
      WHEN "dep_time_semantics" = 'DATE_ONLY' OR "arr_time_semantics" = 'DATE_ONLY' THEN NULL
      -- Catalogue-dependent (see above) — derived on read, never stored.
      WHEN "dep_time_semantics" = 'LEGACY_FAKE_UTC' AND "arr_time_semantics" = 'LEGACY_FAKE_UTC' THEN NULL
      -- Both endpoints are real instants: the naive difference is exact.
      ELSE EXTRACT(EPOCH FROM ("arrival_time" - "departure_time")) / 60.0
    END
  ) STORED;
