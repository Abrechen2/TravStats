-- ---------------------------------------------------------------------------
-- Hand-written: ferry crossings join the Companion's change feed, the same way
-- bus rides joined it in 20261010040000_sync_feed_bus. The ferry domain landed
-- after the feed, so a crossing created or edited on the web never reached the
-- phone. `ferry_journeys` carries `user_id`, so the owner is read off the row;
-- the companion join table stays out, as for every other domain.
-- `syncTriggers.test.ts` holds the trigger list against `SYNC_ENTITIES`.
-- ---------------------------------------------------------------------------

CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "ferry_journeys"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('ferry_journey', '');

CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "ferry_journeys"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
