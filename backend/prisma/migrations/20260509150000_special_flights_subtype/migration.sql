-- Special-flights subtype (formerly feat/special-flights port).
-- Hand-written for the same reason as the cruise + trip migrations:
-- pre-existing schema-drift makes prisma migrate dev unsafe here.
-- Adds 7 nullable columns + a single index. Pure superset — no
-- existing rows are touched, every legacy flight stays a regular
-- line flight (specialType IS NULL).

ALTER TABLE "flights"
  ADD COLUMN "special_type" TEXT,
  ADD COLUMN "event_lat"    DOUBLE PRECISION,
  ADD COLUMN "event_lon"    DOUBLE PRECISION,
  ADD COLUMN "event_label"  TEXT,
  ADD COLUMN "pattern_lat"  DOUBLE PRECISION,
  ADD COLUMN "pattern_lon"  DOUBLE PRECISION,
  ADD COLUMN "special_data" JSONB;

CREATE INDEX "flights_special_type_idx" ON "flights"("special_type");
