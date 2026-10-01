-- CreateTable
CREATE TABLE "sync_changes" (
    "seq" BIGSERIAL NOT NULL,
    "xid" BIGINT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "changed_columns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "row_updated_at" TIMESTAMP(3),
    "kind" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_changes_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "epoch" TEXT NOT NULL,
    "pruned_xid" BIGINT NOT NULL DEFAULT 0,
    "pruned_seq" BIGINT NOT NULL DEFAULT 0,
    "history_from" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_changes_user_id_xid_seq_idx" ON "sync_changes"("user_id", "xid", "seq");

-- CreateIndex
CREATE INDEX "sync_changes_entity_entity_id_idx" ON "sync_changes"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "sync_changes_created_at_idx" ON "sync_changes"("created_at");

-- ---------------------------------------------------------------------------
-- Hand-written below this line (forgejo#141). `prisma migrate dev
-- --create-only` generated the two tables above; Prisma cannot express
-- functions or triggers, so they are appended here, the way Prisma documents
-- custom SQL in a migration. `check:drift` cannot see triggers, so
-- `services/sync/__tests__/syncTriggers.test.ts` replays every kind of delete
-- path (delete, deleteMany, ON DELETE CASCADE, raw SQL) against them instead.
-- ---------------------------------------------------------------------------

-- The feed's bookkeeping row. `history_from` = now: no change before this
-- migration was recorded, so a 409 against an older base version cannot name
-- what changed and says so (`changedFields: null`).
INSERT INTO "sync_state" ("id", "epoch", "history_from", "updated_at")
VALUES (1, gen_random_uuid()::text, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'));

-- The owner of a parent row. A parent deleted earlier in THIS transaction (an
-- ON DELETE CASCADE reaching the child) is no longer in its table, but its own
-- tombstone is: PostgreSQL runs a cascade's child deletes from the RI trigger
-- with trigger firing deferred to the outer statement, so the children's
-- AFTER triggers fire behind the parent's and find its row already written.
CREATE OR REPLACE FUNCTION sync_parent_owner(parent_entity text, parent_table text, parent_id text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  owner_id text;
BEGIN
  IF parent_id IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT user_id FROM %I WHERE id = $1', parent_table) INTO owner_id USING parent_id;
  IF owner_id IS NULL THEN
    SELECT c.user_id INTO owner_id
    FROM sync_changes c
    WHERE c.entity = parent_entity
      AND c.entity_id = parent_id
      AND c.op = 'delete'
      AND c.xid = pg_current_xact_id()::text::bigint
    ORDER BY c.seq DESC
    LIMIT 1;
  END IF;
  RETURN owner_id;
END $fn$;

-- One change row per insert, real update and delete of a synced row.
-- Arguments: entity name, 'kind' or '' (record the row's kind column), then
-- zero or more (parent entity, parent table, foreign-key column) triples for
-- tables without a user_id of their own.
--
-- A row whose owner cannot be resolved, or whose owner no longer exists, is
-- not recorded. That happens exactly when the account itself is being
-- deleted: every parent chain ends at a table with user_id, and that table's
-- tombstone is skipped only because the user row is gone. Nobody is left to
-- sync those tombstones to.
CREATE OR REPLACE FUNCTION sync_record_change()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  entity_name text := TG_ARGV[0];
  row_j       jsonb;
  old_j       jsonb;
  owner_id    text;
  changed     text[] := ARRAY[]::text[];
  change_op   text := 'upsert';
  i           int := 2;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_j := to_jsonb(OLD);
    change_op := 'delete';
  ELSE
    row_j := to_jsonb(NEW);
    IF TG_OP = 'UPDATE' THEN
      old_j := to_jsonb(OLD);
      SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::text[]) INTO changed
      FROM jsonb_object_keys(row_j) AS k
      WHERE row_j -> k IS DISTINCT FROM old_j -> k;
      IF cardinality(changed) = 0 THEN
        RETURN NULL;
      END IF;
    END IF;
  END IF;

  owner_id := row_j ->> 'user_id';
  WHILE owner_id IS NULL AND i + 2 < TG_NARGS LOOP
    owner_id := sync_parent_owner(TG_ARGV[i], TG_ARGV[i + 1], row_j ->> TG_ARGV[i + 2]);
    i := i + 3;
  END LOOP;
  IF owner_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = owner_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO sync_changes (xid, user_id, entity, entity_id, op, changed_columns, row_updated_at, kind)
  VALUES (
    pg_current_xact_id()::text::bigint,
    owner_id,
    entity_name,
    row_j ->> 'id',
    change_op,
    changed,
    CASE WHEN change_op = 'upsert' THEN (row_j ->> 'updated_at')::timestamp(3) END,
    CASE WHEN TG_ARGV[1] = 'kind' THEN row_j ->> 'kind' END
  );
  RETURN NULL;
END $fn$;

-- A row's updated_at is its version for optimistic concurrency (If-Match /
-- baseVersion), so every real change must move it forward. Prisma's
-- @updatedAt stamps the Node clock, which two writes in one millisecond share
-- and a raw-SQL UPDATE does not touch at all; either would hand two different
-- states the same version and let a stale edit through.
CREATE OR REPLACE FUNCTION sync_advance_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.updated_at <= OLD.updated_at AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    NEW.updated_at := OLD.updated_at + interval '1 millisecond';
  END IF;
  RETURN NEW;
END $fn$;

-- Measured, not assumed: with the parent's trigger renamed to sort after the
-- RI triggers the cascade test still passes, and with the tombstone fallback
-- in sync_parent_owner removed it fails (syncTriggers.test.ts). The order of
-- trigger NAMES is therefore not what the cascade relies on.
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "flights"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('flight', '');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "rail_journeys"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('rail_journey', '');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "cruises"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('cruise', '');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "cruise_stops"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('cruise_stop', '', 'cruise', 'cruises', 'cruise_id');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "lodgings"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('lodging', '');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "lodging_stays"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('lodging_stay', '');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "trips"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('trip', '');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "trip_journal_entries"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('trip_journal_entry', '', 'trip', 'trips', 'trip_id');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "places"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('place', '');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "place_visits"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('place_visit', '');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "trip_routes"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('trip_route', 'kind');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "trip_stops"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('trip_stop', '', 'trip', 'trips', 'trip_id', 'trip_route', 'trip_routes', 'route_id');
CREATE TRIGGER "AA_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION sync_record_change('document', '');

CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "flights"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "rail_journeys"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "cruises"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "cruise_stops"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "lodgings"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "lodging_stays"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "trips"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "trip_journal_entries"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "places"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "place_visits"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "trip_routes"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
CREATE TRIGGER "sync_advance_updated_at" BEFORE UPDATE ON "trip_stops"
  FOR EACH ROW EXECUTE FUNCTION sync_advance_updated_at();
