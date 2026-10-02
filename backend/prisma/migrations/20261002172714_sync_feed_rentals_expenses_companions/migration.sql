-- ---------------------------------------------------------------------------
-- Hand-written (forgejo#141, owner 2026-10-02 "wie empfohlen"). The change feed
-- of 20261001193030_sync_change_feed covered the 13 tables that existed on its
-- branch. Two domains landed beside it — rental bookings (dev/rental-domain)
-- and trip expenses (forgejo#140) — and the phone would never have heard of a
-- change to either. The companion catalogue joins them: entries already carry
-- their companions as the denormalised `companions` name array, so they reach
-- the phone with the entry; the catalogue itself (what a picker offers) did
-- not. The join tables stay out on purpose — they have no `id`, and every
-- write path that touches them rewrites the parent's name array in the same
-- request, which the parent's own trigger already records.
--
-- All three tables carry `user_id`, so the owner is read off the row; no
-- parent arguments. `syncTriggers.test.ts` holds the trigger list against
-- `SYNC_ENTITIES`, so this file and `entities.ts` cannot drift apart.
-- ---------------------------------------------------------------------------

CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "rental_bookings"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('rental_booking', '');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "trip_expenses"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('trip_expense', '');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "companions"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('companion', '');

CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "rental_bookings"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "trip_expenses"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "companions"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
