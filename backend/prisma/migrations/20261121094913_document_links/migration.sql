-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_bus_journey_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_cruise_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_ferry_journey_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_flight_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_lodging_stay_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_place_visit_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_rail_journey_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_rental_booking_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_trip_expense_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_trip_id_fkey";

-- CreateTable
CREATE TABLE "document_links" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "flight_id" TEXT,
    "cruise_id" TEXT,
    "lodging_stay_id" TEXT,
    "trip_id" TEXT,
    "place_visit_id" TEXT,
    "rail_journey_id" TEXT,
    "rental_booking_id" TEXT,
    "bus_journey_id" TEXT,
    "ferry_journey_id" TEXT,
    "trip_expense_id" TEXT,
    "role" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "rental_category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_links_flight_id_idx" ON "document_links"("flight_id");

-- CreateIndex
CREATE INDEX "document_links_cruise_id_idx" ON "document_links"("cruise_id");

-- CreateIndex
CREATE INDEX "document_links_lodging_stay_id_idx" ON "document_links"("lodging_stay_id");

-- CreateIndex
CREATE INDEX "document_links_trip_id_idx" ON "document_links"("trip_id");

-- CreateIndex
CREATE INDEX "document_links_place_visit_id_idx" ON "document_links"("place_visit_id");

-- CreateIndex
CREATE INDEX "document_links_rail_journey_id_idx" ON "document_links"("rail_journey_id");

-- CreateIndex
CREATE INDEX "document_links_rental_booking_id_idx" ON "document_links"("rental_booking_id");

-- CreateIndex
CREATE INDEX "document_links_bus_journey_id_idx" ON "document_links"("bus_journey_id");

-- CreateIndex
CREATE INDEX "document_links_ferry_journey_id_idx" ON "document_links"("ferry_journey_id");

-- CreateIndex
CREATE INDEX "document_links_trip_expense_id_idx" ON "document_links"("trip_expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_flight_id_key" ON "document_links"("document_id", "flight_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_cruise_id_key" ON "document_links"("document_id", "cruise_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_lodging_stay_id_key" ON "document_links"("document_id", "lodging_stay_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_trip_id_key" ON "document_links"("document_id", "trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_place_visit_id_key" ON "document_links"("document_id", "place_visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_rail_journey_id_key" ON "document_links"("document_id", "rail_journey_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_rental_booking_id_key" ON "document_links"("document_id", "rental_booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_bus_journey_id_key" ON "document_links"("document_id", "bus_journey_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_ferry_journey_id_key" ON "document_links"("document_id", "ferry_journey_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_trip_expense_id_key" ON "document_links"("document_id", "trip_expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_one_primary_key" ON "document_links"("document_id") WHERE (role = 'primary');

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_cruise_id_fkey" FOREIGN KEY ("cruise_id") REFERENCES "cruises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_lodging_stay_id_fkey" FOREIGN KEY ("lodging_stay_id") REFERENCES "lodging_stays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_place_visit_id_fkey" FOREIGN KEY ("place_visit_id") REFERENCES "place_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_rail_journey_id_fkey" FOREIGN KEY ("rail_journey_id") REFERENCES "rail_journeys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_rental_booking_id_fkey" FOREIGN KEY ("rental_booking_id") REFERENCES "rental_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_bus_journey_id_fkey" FOREIGN KEY ("bus_journey_id") REFERENCES "bus_journeys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_ferry_journey_id_fkey" FOREIGN KEY ("ferry_journey_id") REFERENCES "ferry_journeys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_trip_expense_id_fkey" FOREIGN KEY ("trip_expense_id") REFERENCES "trip_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_cruise_id_fkey" FOREIGN KEY ("cruise_id") REFERENCES "cruises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_lodging_stay_id_fkey" FOREIGN KEY ("lodging_stay_id") REFERENCES "lodging_stays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_place_visit_id_fkey" FOREIGN KEY ("place_visit_id") REFERENCES "place_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_rail_journey_id_fkey" FOREIGN KEY ("rail_journey_id") REFERENCES "rail_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_rental_booking_id_fkey" FOREIGN KEY ("rental_booking_id") REFERENCES "rental_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_bus_journey_id_fkey" FOREIGN KEY ("bus_journey_id") REFERENCES "bus_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_ferry_journey_id_fkey" FOREIGN KEY ("ferry_journey_id") REFERENCES "ferry_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_trip_expense_id_fkey" FOREIGN KEY ("trip_expense_id") REFERENCES "trip_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below this line (plan 2026-11-21-document-links, phase D1).
-- Prisma expresses neither CHECK constraints, nor the backfill, nor triggers.
-- Replayed against rows of every old shape by
-- src/__tests__/migration.documentLinks.test.ts.
-- ---------------------------------------------------------------------------

-- A link points at exactly one entry.
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_single_target_check" CHECK (
  num_nonnulls("flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id", "ferry_journey_id", "trip_expense_id") = 1
);
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_role_check" CHECK (
  "role" IN ('primary', 'covers')
);
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_provenance_check" CHECK (
  "provenance" IN ('user', 'parser', 'suggestion', 'legacy')
);
-- The rental category moves onto the rental link it describes (forgejo#239).
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_rental_category_check" CHECK (
  "rental_category" IS NULL
  OR ("rental_booking_id" IS NOT NULL
      AND "rental_category" IN ('pickup', 'return', 'damage', 'fuel', 'odometer'))
);

-- Backfill: every filed document becomes one primary link of provenance
-- `legacy`, dated when it was filed. An unfiled document gets none.
INSERT INTO "document_links" (
  "id", "document_id", "flight_id", "cruise_id", "lodging_stay_id", "trip_id",
  "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id",
  "ferry_journey_id", "trip_expense_id", "role", "provenance", "rental_category",
  "created_at"
)
SELECT gen_random_uuid()::text, "id", "flight_id", "cruise_id", "lodging_stay_id",
  "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id",
  "bus_journey_id", "ferry_journey_id", "trip_expense_id", 'primary', 'legacy',
  CASE WHEN "rental_booking_id" IS NOT NULL THEN "rental_category" END,
  COALESCE("linked_at", "created_at")
FROM "documents"
WHERE num_nonnulls("flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id", "ferry_journey_id", "trip_expense_id") = 1;

-- A category on a document that is not a rental's could not exist under the
-- old CHECK; cleared anyway so the projection holds from the first row.
UPDATE "documents" SET "rental_category" = NULL
WHERE "rental_category" IS NOT NULL AND "rental_booking_id" IS NULL;

-- When a link goes — an entry deleted through ANY path (its route, a trip, a
-- lodging, a restore), or a link removed by the service — the document stays.
-- A removed primary hands the role to the oldest remaining link, and the owner
-- columns follow it; the last link gone makes the document unfiled and starts
-- its 30-day grace (`unlinked_at`), exactly as unfiling it by hand does. Done
-- in the database because a cascade never passes through application code.
CREATE FUNCTION "document_links_after_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  next_link "document_links"%ROWTYPE;
BEGIN
  IF OLD."role" = 'primary' THEN
    SELECT * INTO next_link FROM "document_links"
    WHERE "document_id" = OLD."document_id"
    ORDER BY "created_at", "id"
    LIMIT 1;
    IF FOUND THEN
      UPDATE "document_links" SET "role" = 'primary' WHERE "id" = next_link."id";
      UPDATE "documents" SET
        "flight_id" = next_link."flight_id",
        "cruise_id" = next_link."cruise_id",
        "lodging_stay_id" = next_link."lodging_stay_id",
        "trip_id" = next_link."trip_id",
        "place_visit_id" = next_link."place_visit_id",
        "rail_journey_id" = next_link."rail_journey_id",
        "rental_booking_id" = next_link."rental_booking_id",
        "bus_journey_id" = next_link."bus_journey_id",
        "ferry_journey_id" = next_link."ferry_journey_id",
        "trip_expense_id" = next_link."trip_expense_id",
        "rental_category" = next_link."rental_category",
        "linked_at" = COALESCE("linked_at", (now() AT TIME ZONE 'UTC')),
        "unlinked_at" = NULL
      WHERE "id" = OLD."document_id";
      RETURN NULL;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "document_links" WHERE "document_id" = OLD."document_id") THEN
    UPDATE "documents" SET
      "flight_id" = NULL, "cruise_id" = NULL, "lodging_stay_id" = NULL,
      "trip_id" = NULL, "place_visit_id" = NULL, "rail_journey_id" = NULL,
      "rental_booking_id" = NULL, "bus_journey_id" = NULL,
      "ferry_journey_id" = NULL, "trip_expense_id" = NULL,
      "rental_category" = NULL,
      "linked_at" = NULL,
      "unlinked_at" = COALESCE("unlinked_at", (now() AT TIME ZONE 'UTC'))
    WHERE "id" = OLD."document_id";
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "document_links_after_delete" AFTER DELETE ON "document_links"
FOR EACH ROW EXECUTE FUNCTION "document_links_after_delete"();

-- The same rule from the other side, for a document whose owner column is
-- cleared while it has no link to say so (a `SET NULL` cascade on a row no
-- link describes, or any writer that still sets the old columns directly):
-- it becomes unfiled with its grace clock started rather than unfiled without
-- a date — a row the sweep, abstaining on a null stamp, would keep forever.
-- A rental's category leaves with the rental, before the row's CHECK
-- (`documents_rental_category_check`) would refuse the cascade.
CREATE FUNCTION "documents_before_owner_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."rental_booking_id" IS NOT NULL AND NEW."rental_booking_id" IS NULL THEN
    NEW."rental_category" := NULL;
  END IF;
  IF num_nonnulls(OLD."flight_id", OLD."cruise_id", OLD."lodging_stay_id", OLD."trip_id", OLD."place_visit_id", OLD."rail_journey_id", OLD."rental_booking_id", OLD."bus_journey_id", OLD."ferry_journey_id", OLD."trip_expense_id") > 0
     AND num_nonnulls(NEW."flight_id", NEW."cruise_id", NEW."lodging_stay_id", NEW."trip_id", NEW."place_visit_id", NEW."rail_journey_id", NEW."rental_booking_id", NEW."bus_journey_id", NEW."ferry_journey_id", NEW."trip_expense_id") = 0
     AND NEW."unlinked_at" IS NULL THEN
    NEW."linked_at" := NULL;
    NEW."unlinked_at" := (now() AT TIME ZONE 'UTC');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "documents_before_owner_change"
BEFORE UPDATE OF "flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id", "ferry_journey_id", "trip_expense_id" ON "documents"
FOR EACH ROW EXECUTE FUNCTION "documents_before_owner_change"();
