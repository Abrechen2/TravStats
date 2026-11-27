-- AlterTable
ALTER TABLE "document_links" ADD COLUMN     "trip_route_id" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "trip_route_id" TEXT;

-- CreateIndex
CREATE INDEX "document_links_trip_route_id_idx" ON "document_links"("trip_route_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_trip_route_id_key" ON "document_links"("document_id", "trip_route_id");

-- CreateIndex
CREATE INDEX "documents_trip_route_id_idx" ON "documents"("trip_route_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_trip_route_id_fkey" FOREIGN KEY ("trip_route_id") REFERENCES "trip_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_trip_route_id_fkey" FOREIGN KEY ("trip_route_id") REFERENCES "trip_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: a roadtrip / tour can carry documents (GitHub #415). The single-target
-- rule, the projection triggers and the check constraint learn the new column.
-- Replayed by src/__tests__/migration.documentLinksTripRoute.test.ts.
ALTER TABLE "documents" DROP CONSTRAINT "documents_single_owner_check";
ALTER TABLE "documents" ADD CONSTRAINT "documents_single_owner_check" CHECK (
  num_nonnulls("flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id", "trip_expense_id", "ferry_journey_id", "trip_route_id") <= 1
);
ALTER TABLE "document_links" DROP CONSTRAINT "document_links_single_target_check";
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_single_target_check" CHECK (
  num_nonnulls("flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id", "ferry_journey_id", "trip_expense_id", "trip_route_id") = 1
);

CREATE OR REPLACE FUNCTION "document_links_after_delete"() RETURNS trigger
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
        "trip_route_id" = next_link."trip_route_id",
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
      "ferry_journey_id" = NULL, "trip_expense_id" = NULL, "trip_route_id" = NULL,
      "rental_category" = NULL,
      "linked_at" = NULL,
      "unlinked_at" = COALESCE("unlinked_at", (now() AT TIME ZONE 'UTC'))
    WHERE "id" = OLD."document_id";
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "documents_before_owner_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."rental_booking_id" IS NOT NULL AND NEW."rental_booking_id" IS NULL THEN
    NEW."rental_category" := NULL;
  END IF;
  IF num_nonnulls(OLD."flight_id", OLD."cruise_id", OLD."lodging_stay_id", OLD."trip_id", OLD."place_visit_id", OLD."rail_journey_id", OLD."rental_booking_id", OLD."bus_journey_id", OLD."ferry_journey_id", OLD."trip_expense_id", OLD."trip_route_id") > 0
     AND num_nonnulls(NEW."flight_id", NEW."cruise_id", NEW."lodging_stay_id", NEW."trip_id", NEW."place_visit_id", NEW."rail_journey_id", NEW."rental_booking_id", NEW."bus_journey_id", NEW."ferry_journey_id", NEW."trip_expense_id", NEW."trip_route_id") = 0
     AND NEW."unlinked_at" IS NULL THEN
    NEW."linked_at" := NULL;
    NEW."unlinked_at" := (now() AT TIME ZONE 'UTC');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "documents_after_owner_set"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF num_nonnulls(NEW."flight_id", NEW."cruise_id", NEW."lodging_stay_id", NEW."trip_id", NEW."place_visit_id", NEW."rail_journey_id", NEW."rental_booking_id", NEW."bus_journey_id", NEW."ferry_journey_id", NEW."trip_expense_id", NEW."trip_route_id") <> 1 THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "document_links" l
    WHERE l."document_id" = NEW."id"
      AND l."flight_id" IS NOT DISTINCT FROM NEW."flight_id"
      AND l."cruise_id" IS NOT DISTINCT FROM NEW."cruise_id"
      AND l."lodging_stay_id" IS NOT DISTINCT FROM NEW."lodging_stay_id"
      AND l."trip_id" IS NOT DISTINCT FROM NEW."trip_id"
      AND l."place_visit_id" IS NOT DISTINCT FROM NEW."place_visit_id"
      AND l."rail_journey_id" IS NOT DISTINCT FROM NEW."rail_journey_id"
      AND l."rental_booking_id" IS NOT DISTINCT FROM NEW."rental_booking_id"
      AND l."bus_journey_id" IS NOT DISTINCT FROM NEW."bus_journey_id"
      AND l."ferry_journey_id" IS NOT DISTINCT FROM NEW."ferry_journey_id"
      AND l."trip_expense_id" IS NOT DISTINCT FROM NEW."trip_expense_id"
      AND l."trip_route_id" IS NOT DISTINCT FROM NEW."trip_route_id"
  ) THEN
    RETURN NULL;
  END IF;
  -- An older writer MOVED the owner (A -> B, not a first set): the primary link
  -- to A moves with it, or the next projection would restore A and an unfile
  -- would remove the wrong link.
  IF TG_OP = 'UPDATE' AND num_nonnulls(OLD."flight_id", OLD."cruise_id", OLD."lodging_stay_id", OLD."trip_id", OLD."place_visit_id", OLD."rail_journey_id", OLD."rental_booking_id", OLD."bus_journey_id", OLD."ferry_journey_id", OLD."trip_expense_id", OLD."trip_route_id") = 1 THEN
    UPDATE "document_links" l SET
      "flight_id" = NEW."flight_id", "cruise_id" = NEW."cruise_id", "lodging_stay_id" = NEW."lodging_stay_id",
      "trip_id" = NEW."trip_id", "place_visit_id" = NEW."place_visit_id", "rail_journey_id" = NEW."rail_journey_id",
      "rental_booking_id" = NEW."rental_booking_id", "bus_journey_id" = NEW."bus_journey_id",
      "ferry_journey_id" = NEW."ferry_journey_id", "trip_expense_id" = NEW."trip_expense_id", "trip_route_id" = NEW."trip_route_id",
      "rental_category" = CASE WHEN NEW."rental_booking_id" IS NOT NULL THEN NEW."rental_category" ELSE NULL END
    WHERE l."document_id" = NEW."id" AND l."role" = 'primary'
      AND l."flight_id" IS NOT DISTINCT FROM OLD."flight_id"
      AND l."cruise_id" IS NOT DISTINCT FROM OLD."cruise_id"
      AND l."lodging_stay_id" IS NOT DISTINCT FROM OLD."lodging_stay_id"
      AND l."trip_id" IS NOT DISTINCT FROM OLD."trip_id"
      AND l."place_visit_id" IS NOT DISTINCT FROM OLD."place_visit_id"
      AND l."rail_journey_id" IS NOT DISTINCT FROM OLD."rail_journey_id"
      AND l."rental_booking_id" IS NOT DISTINCT FROM OLD."rental_booking_id"
      AND l."bus_journey_id" IS NOT DISTINCT FROM OLD."bus_journey_id"
      AND l."ferry_journey_id" IS NOT DISTINCT FROM OLD."ferry_journey_id"
      AND l."trip_expense_id" IS NOT DISTINCT FROM OLD."trip_expense_id"
      AND l."trip_route_id" IS NOT DISTINCT FROM OLD."trip_route_id";
    IF FOUND THEN
      RETURN NULL;
    END IF;
  END IF;
  INSERT INTO "document_links" (
    "id", "document_id", "flight_id", "cruise_id", "lodging_stay_id", "trip_id",
    "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id",
    "ferry_journey_id", "trip_expense_id", "trip_route_id", "role", "provenance", "rental_category", "created_at"
  ) VALUES (
    gen_random_uuid()::text, NEW."id", NEW."flight_id", NEW."cruise_id", NEW."lodging_stay_id", NEW."trip_id",
    NEW."place_visit_id", NEW."rail_journey_id", NEW."rental_booking_id", NEW."bus_journey_id",
    NEW."ferry_journey_id", NEW."trip_expense_id", NEW."trip_route_id",
    CASE WHEN EXISTS (SELECT 1 FROM "document_links" p WHERE p."document_id" = NEW."id" AND p."role" = 'primary')
         THEN 'covers' ELSE 'primary' END,
    'legacy',
    CASE WHEN NEW."rental_booking_id" IS NOT NULL THEN NEW."rental_category" ELSE NULL END,
    (now() AT TIME ZONE 'UTC')
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER "documents_before_owner_change" ON "documents";
DROP TRIGGER "documents_after_owner_set" ON "documents";
CREATE TRIGGER "documents_before_owner_change"
BEFORE UPDATE OF "flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id", "ferry_journey_id", "trip_expense_id", "trip_route_id" ON "documents"
FOR EACH ROW EXECUTE FUNCTION "documents_before_owner_change"();
CREATE TRIGGER "documents_after_owner_set"
AFTER INSERT OR UPDATE OF "flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id", "ferry_journey_id", "trip_expense_id", "trip_route_id" ON "documents"
FOR EACH ROW EXECUTE FUNCTION "documents_after_owner_set"();
