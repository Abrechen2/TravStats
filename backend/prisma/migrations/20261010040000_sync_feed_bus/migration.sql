-- ---------------------------------------------------------------------------
-- Hand-written (forgejo#180): bus rides join the Companion's change feed, the
-- same way rental bookings and trip expenses joined it in
-- 20261002172714_sync_feed_rentals_expenses_companions. The bus domain landed
-- after the feed, so the phone — which already creates and edits rides
-- offline (`capture-bus.tsx`, `lib/bus/outbox.ts`) — never heard of a change
-- made on the web. `bus_journeys` carries `user_id`, so the owner is read off
-- the row; the companion join table stays out, as for every other domain.
-- `syncTriggers.test.ts` holds the trigger list against `SYNC_ENTITIES`.
-- ---------------------------------------------------------------------------

CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "bus_journeys"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('bus_journey', '');

CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "bus_journeys"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
