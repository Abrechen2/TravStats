-- forgejo#430, review: clearing the split on a membership change destroyed
-- amounts the user had typed for every other item (CLAUDE.md defect class 4,
-- "a re-derivation destroys good data"). The trigger now MARKS the split
-- stale and keeps every amount: the statistics treat a stale split as no
-- split, the booking card asks the user to check it with the old amounts
-- prefilled, and saving a split writes it without the flag.

CREATE OR REPLACE FUNCTION clear_package_split_on_membership() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.booking_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.booking_id IS DISTINCT FROM NEW.booking_id) THEN
    UPDATE bookings
       SET price_split = jsonb_set(price_split::jsonb, '{stale}', 'true'::jsonb), updated_at = now()
     WHERE id = OLD.booking_id AND price_split IS NOT NULL
       AND jsonb_typeof(price_split::jsonb) = 'object'
       AND (price_split::jsonb -> 'stale') IS DISTINCT FROM 'true'::jsonb;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.booking_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.booking_id IS DISTINCT FROM NEW.booking_id) THEN
    UPDATE bookings
       SET price_split = jsonb_set(price_split::jsonb, '{stale}', 'true'::jsonb), updated_at = now()
     WHERE id = NEW.booking_id AND price_split IS NOT NULL
       AND jsonb_typeof(price_split::jsonb) = 'object'
       AND (price_split::jsonb -> 'stale') IS DISTINCT FROM 'true'::jsonb;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
