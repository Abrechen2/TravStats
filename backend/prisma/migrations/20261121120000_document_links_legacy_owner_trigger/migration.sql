-- Plan D2, forgejo#425: "every filed document has a link" held by the
-- database, not by convention. Another writer (SQL on a server, an older
-- build) may still set only an owner column on `documents`; this trigger gives
-- such a row the link that column describes, provenance `legacy` — `primary`
-- when the document has none yet, `covers` when it already has one. A row that
-- already carries a link to that exact target is left alone, so the service,
-- which writes the link first and the projection from it, never doubles up.
-- Clearing an owner column is not this trigger's business (see
-- `documents_before_owner_change` and `document_links_after_delete`).
CREATE FUNCTION "documents_after_owner_set"() RETURNS trigger
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

CREATE TRIGGER "documents_after_owner_set"
AFTER INSERT OR UPDATE OF "flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id", "ferry_journey_id", "trip_expense_id" ON "documents"
FOR EACH ROW EXECUTE FUNCTION "documents_after_owner_set"();
