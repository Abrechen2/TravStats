/**
 * The rows a received change lands on, held from the precondition to the write (spec 2026-10-20
 * F6; F-S4d review and its leftover). A copy's facts are not all on its own row: a cruise's port
 * calls and legs live in `cruise_stops` / `cruise_legs`, a stay's house in `lodgings`. A local save
 * to one of those that committed between the check and the write was otherwise replaced by the
 * incoming value without a conflict.
 *
 * `FOR UPDATE` on the entry's row also holds back a new child row (its foreign key check takes a
 * key-share lock on the parent); the existing children are locked themselves, so an edit or a
 * delete of one waits too. The order is parent first, then children. A local write path that
 * takes them the other way round can deadlock with it; Postgres then aborts one of the two, and
 * an aborted incoming change is answered as a failure here and sent again (not lost).
 */
import type { DbTransaction } from "../../../db";
import { SHARE_TYPES, type ShareEntity } from "../shareTypes";

/** Child rows per entity: the SQL that locks those of one entry, given its id as `$1`. */
const CHILDREN: Partial<Record<ShareEntity, readonly string[]>> = {
  cruise: [
    "SELECT 1 FROM cruise_stops WHERE cruise_id = $1 ORDER BY id FOR UPDATE",
    "SELECT 1 FROM cruise_legs WHERE cruise_id = $1 ORDER BY id FOR UPDATE",
  ],
  lodgingStay: [
    "SELECT 1 FROM lodgings WHERE id = (SELECT lodging_id FROM lodging_stays WHERE id = $1) FOR UPDATE",
  ],
};

/** Lock the copy `id` of `entity` and every row its facts are read from. */
export async function lockCopy(tx: DbTransaction, entity: ShareEntity, id: string): Promise<void> {
  await tx.$queryRawUnsafe(
    `SELECT 1 FROM "${SHARE_TYPES[entity].table}" WHERE id = $1 FOR UPDATE`,
    id
  );
  for (const sql of CHILDREN[entity] ?? []) await tx.$queryRawUnsafe(sql, id);
}
