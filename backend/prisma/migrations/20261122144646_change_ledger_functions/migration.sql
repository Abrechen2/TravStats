-- The change ledger's two statements that must never abort the caller's
-- transaction (spec docs/superpowers/specs/2026-11-22-change-history.md,
-- "Transactions"). A PL/pgSQL EXCEPTION block is a savepoint taken on the
-- server, so each is ONE round trip instead of SAVEPOINT / statement / RELEASE.
-- Functions are not part of the Prisma schema; check:drift does not see them.

-- The before-snapshot of one row by id (and owner): {"ok": true, "row": <row as jsonb or null>},
-- or {"ok": false, "error": <SQLSTATE>} when the read failed.
CREATE OR REPLACE FUNCTION change_ledger_snapshot(tbl regclass, row_id text, owner_id text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  found_row jsonb;
BEGIN
  EXECUTE format(
    'SELECT to_jsonb(t) FROM %s t WHERE t.id = $1 AND ($2::text IS NULL OR t.user_id = $2)',
    tbl
  ) INTO found_row USING row_id, owner_id;
  RETURN jsonb_build_object('ok', true, 'row', found_row);
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLSTATE);
END
$$;

-- Insert ledger rows given as a JSON array; returns the count, or -1 when the insert failed
-- (an account deleted meanwhile, a full disk). Nothing is inserted on failure.
CREATE OR REPLACE FUNCTION change_ledger_insert(entries jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO change_ledger_entries (
    id, user_id, change_set_id, entity_type, entity_id, operation, field, old_value, new_value,
    omitted, label, source, actor_user_id, reason, restored_from_id, created_at
  )
  SELECT
    gen_random_uuid()::text, e.user_id, e.change_set_id, e.entity_type, e.entity_id, e.operation,
    e.field, e.old_value, e.new_value, e.omitted, e.label, e.source, e.actor_user_id, e.reason,
    e.restored_from_id, e.created_at AT TIME ZONE 'UTC'
  FROM jsonb_to_recordset(entries) AS e(
    user_id text, change_set_id text, entity_type text, entity_id text, operation text,
    field text, old_value text, new_value text, omitted boolean, label text, source text,
    actor_user_id text, reason text, restored_from_id text, created_at timestamptz
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
EXCEPTION WHEN others THEN
  RETURN -1;
END
$$;
