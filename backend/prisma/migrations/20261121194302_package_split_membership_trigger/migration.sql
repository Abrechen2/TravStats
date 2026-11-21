-- forgejo#430: a package split names the items it was made across. The
-- statistics can only check its item COUNT, so an entry swapped onto or off a
-- booking would keep stale shares counting. Every path that sets, changes or
-- clears an entry's booking_id (routes, imports, plans, merges, deletes) runs
-- through this one trigger, which clears the split of the booking(s) involved:
-- the package then reads "not split" everywhere until the user splits again.

CREATE OR REPLACE FUNCTION clear_package_split_on_membership() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.booking_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.booking_id IS DISTINCT FROM NEW.booking_id) THEN
    UPDATE bookings SET price_split = NULL, updated_at = now()
     WHERE id = OLD.booking_id AND price_split IS NOT NULL;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.booking_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.booking_id IS DISTINCT FROM NEW.booking_id) THEN
    UPDATE bookings SET price_split = NULL, updated_at = now()
     WHERE id = NEW.booking_id AND price_split IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER flights_package_split AFTER INSERT OR UPDATE OF booking_id OR DELETE ON flights
  FOR EACH ROW EXECUTE FUNCTION clear_package_split_on_membership();
CREATE TRIGGER lodging_stays_package_split AFTER INSERT OR UPDATE OF booking_id OR DELETE ON lodging_stays
  FOR EACH ROW EXECUTE FUNCTION clear_package_split_on_membership();
CREATE TRIGGER cruises_package_split AFTER INSERT OR UPDATE OF booking_id OR DELETE ON cruises
  FOR EACH ROW EXECUTE FUNCTION clear_package_split_on_membership();
CREATE TRIGGER rail_journeys_package_split AFTER INSERT OR UPDATE OF booking_id OR DELETE ON rail_journeys
  FOR EACH ROW EXECUTE FUNCTION clear_package_split_on_membership();
CREATE TRIGGER bus_journeys_package_split AFTER INSERT OR UPDATE OF booking_id OR DELETE ON bus_journeys
  FOR EACH ROW EXECUTE FUNCTION clear_package_split_on_membership();
CREATE TRIGGER ferry_journeys_package_split AFTER INSERT OR UPDATE OF booking_id OR DELETE ON ferry_journeys
  FOR EACH ROW EXECUTE FUNCTION clear_package_split_on_membership();
CREATE TRIGGER rental_bookings_package_split AFTER INSERT OR UPDATE OF booking_id OR DELETE ON rental_bookings
  FOR EACH ROW EXECUTE FUNCTION clear_package_split_on_membership();
