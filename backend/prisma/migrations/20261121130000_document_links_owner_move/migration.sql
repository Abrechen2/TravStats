-- forgejo#425: a legacy writer that MOVES a document between owners moves its primary link too.
-- Replaces the function of 20261121120000; the trigger itself is unchanged.
CREATE OR REPLACE FUNCTION "documents_after_owner_set"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF num_nonnulls(NEW."flight_id", NEW."cruise_id", NEW."lodging_stay_id", NEW."trip_id", NEW."place_visit_id", NEW."rail_journey_id", NEW."rental_booking_id", NEW."bus_journey_id", NEW."ferry_journey_id", NEW."trip_expense_id") <> 1 THEN
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
  ) THEN
    RETURN NULL;
  END IF;
  -- An older writer MOVED the owner (A -> B, not a first set): the primary link
  -- to A moves with it, or the next projection would restore A and an unfile
  -- would remove the wrong link.
  IF TG_OP = 'UPDATE' AND num_nonnulls(OLD."flight_id", OLD."cruise_id", OLD."lodging_stay_id", OLD."trip_id", OLD."place_visit_id", OLD."rail_journey_id", OLD."rental_booking_id", OLD."bus_journey_id", OLD."ferry_journey_id", OLD."trip_expense_id") = 1 THEN
    UPDATE "document_links" l SET
      "flight_id" = NEW."flight_id", "cruise_id" = NEW."cruise_id", "lodging_stay_id" = NEW."lodging_stay_id",
      "trip_id" = NEW."trip_id", "place_visit_id" = NEW."place_visit_id", "rail_journey_id" = NEW."rail_journey_id",
      "rental_booking_id" = NEW."rental_booking_id", "bus_journey_id" = NEW."bus_journey_id",
      "ferry_journey_id" = NEW."ferry_journey_id", "trip_expense_id" = NEW."trip_expense_id",
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
      AND l."trip_expense_id" IS NOT DISTINCT FROM OLD."trip_expense_id";
    IF FOUND THEN
      RETURN NULL;
    END IF;
  END IF;
  INSERT INTO "document_links" (
    "id", "document_id", "flight_id", "cruise_id", "lodging_stay_id", "trip_id",
    "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id",
    "ferry_journey_id", "trip_expense_id", "role", "provenance", "rental_category", "created_at"
  ) VALUES (
    gen_random_uuid()::text, NEW."id", NEW."flight_id", NEW."cruise_id", NEW."lodging_stay_id", NEW."trip_id",
    NEW."place_visit_id", NEW."rail_journey_id", NEW."rental_booking_id", NEW."bus_journey_id",
    NEW."ferry_journey_id", NEW."trip_expense_id",
    CASE WHEN EXISTS (SELECT 1 FROM "document_links" p WHERE p."document_id" = NEW."id" AND p."role" = 'primary')
         THEN 'covers' ELSE 'primary' END,
    'legacy',
    CASE WHEN NEW."rental_booking_id" IS NOT NULL THEN NEW."rental_category" ELSE NULL END,
    (now() AT TIME ZONE 'UTC')
  );
  RETURN NULL;
END;
$$;

