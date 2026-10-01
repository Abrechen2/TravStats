-- Roadtrip costs (forgejo#140, owner 2026-10-01): a ferry ticket, a toll, a
-- pitch fee, fuel — on a trip, or on a route section, optionally pinned to a
-- station or to the way between two. See `TripExpense` in schema.prisma.
--
-- HAND-WRITTEN on purpose. The per-leg toll (`trip_route_legs.toll_cost` +
-- `currency`) moves INTO this table and the two columns are dropped (owner:
-- one source of truth for totals). `prisma migrate dev` would emit the drop
-- with no copy in front of it — every stored toll gone. The copy below runs
-- first; `src/__tests__/migration.tripExpenses.test.ts` replays this file
-- against rows in the old shape and asserts they survive.

CREATE TABLE "trip_expenses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trip_id" TEXT,
    "route_id" TEXT,
    "stop_id" TEXT,
    "leg_from_stop_id" TEXT,
    "leg_to_stop_id" TEXT,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(16,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "date" DATE,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trip_expenses_user_id_idx" ON "trip_expenses"("user_id");
CREATE INDEX "trip_expenses_trip_id_idx" ON "trip_expenses"("trip_id");
CREATE INDEX "trip_expenses_route_id_idx" ON "trip_expenses"("route_id");
CREATE INDEX "trip_expenses_stop_id_idx" ON "trip_expenses"("stop_id");
CREATE INDEX "trip_expenses_leg_from_stop_id_idx" ON "trip_expenses"("leg_from_stop_id");
CREATE INDEX "trip_expenses_leg_to_stop_id_idx" ON "trip_expenses"("leg_to_stop_id");

ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_trip_id_fkey"
  FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "trip_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_stop_id_fkey"
  FOREIGN KEY ("stop_id") REFERENCES "trip_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_leg_from_stop_id_fkey"
  FOREIGN KEY ("leg_from_stop_id") REFERENCES "trip_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_leg_to_stop_id_fkey"
  FOREIGN KEY ("leg_to_stop_id") REFERENCES "trip_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exactly one owner scope: trip-wide, or a route section's. Neither FK above
-- is SetNull, so no cascade can ever leave a row violating this.
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_one_scope"
  CHECK (num_nonnulls("trip_id", "route_id") = 1);
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_kind"
  CHECK ("kind" IN ('ferry', 'toll', 'pitch', 'fuel', 'parking', 'other'));
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_amount_not_negative"
  CHECK ("amount" >= 0);
-- On a station OR on the way between two, never both: a total per station
-- and per leg would otherwise count it twice. SetNull only ever clears a
-- column, so no cascade can violate this.
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_station_or_leg"
  CHECK ("stop_id" IS NULL OR ("leg_from_stop_id" IS NULL AND "leg_to_stop_id" IS NULL));
-- The shape only: membership of ISO 4217 is checked at the API boundary.
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_currency_shape"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- The data move. One expense per stored toll, on the leg's ROUTE (a leg has
-- no trip of its own, and a standalone roadtrip has none at all), between the
-- leg's two stops. Its currency is the leg's, upper-cased; a leg that stored
-- none gets the owner's base currency (the schema default EUR when the owner
-- has no settings row). A stored value that is not a three-letter code cannot
-- be a currency: the amount is kept with the owner's currency and the text it
-- was stored with goes into the note, so nothing typed is thrown away. The day
-- is the day the leg left its first stop, else the day it reached the second;
-- station days are calendar days stored as UTC midnight, so the cast reads the
-- place's day. No day anywhere: undated, which counts in totals and no year.
INSERT INTO "trip_expenses" (
    "id", "user_id", "route_id", "leg_from_stop_id", "leg_to_stop_id",
    "kind", "amount", "currency", "date", "note", "created_at", "updated_at"
)
SELECT
    gen_random_uuid()::text,
    r."user_id",
    l."route_id",
    l."from_stop_id",
    l."to_stop_id",
    'toll',
    l."toll_cost",
    CASE
      WHEN UPPER(BTRIM(l."currency")) ~ '^[A-Z]{3}$' THEN UPPER(BTRIM(l."currency"))
      ELSE COALESCE(s."base_currency", 'EUR')
    END,
    CAST(COALESCE(f."end_date", f."start_date", t."start_date") AS DATE),
    CASE
      WHEN l."currency" IS NOT NULL AND NOT (UPPER(BTRIM(l."currency")) ~ '^[A-Z]{3}$')
        THEN 'Toll moved from the leg, stored currency was ''' || l."currency" || ''''
      ELSE NULL
    END,
    l."updated_at",
    l."updated_at"
FROM "trip_route_legs" l
JOIN "trip_routes" r ON r."id" = l."route_id"
JOIN "trip_stops" f ON f."id" = l."from_stop_id"
JOIN "trip_stops" t ON t."id" = l."to_stop_id"
LEFT JOIN "user_settings" s ON s."user_id" = r."user_id"
WHERE l."toll_cost" IS NOT NULL;

-- Only now, with every toll copied, the columns go.
ALTER TABLE "trip_route_legs" DROP COLUMN "toll_cost",
DROP COLUMN "currency";
