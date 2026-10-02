import { prisma } from "../../db";
import logger from "../../utils/logger";
import { SYNC_ENTITIES } from "./entities";

/**
 * Are the sync feed's triggers where `entities.ts` says they are?
 *
 * The change feed (forgejo#141) is written by database triggers, and nothing
 * else notices when they are gone: the feed then answers "nothing changed",
 * which a phone believes. Measured on 2026-10-02 (forgejo#157): restoring a
 * backup taken before the trigger migration left all 25 triggers missing, the
 * restore reported success, and every later edit was invisible to the phone.
 * `check:drift` cannot see a trigger, so this asks `pg_trigger` directly — at
 * boot (the result is on `/health`) and at the end of every restore.
 */

export const SYNC_CHANGE_TRIGGER = "AA_sync_change";
export const SYNC_VERSION_TRIGGER = "sync_advance_updated_at";

export type SyncSchemaCheck = { ok: true } | { ok: false; missing: string[] };

/** `table:trigger` for every trigger `SYNC_ENTITIES` expects and the database lacks. */
export async function missingSyncTriggers(): Promise<string[]> {
  const expected = SYNC_ENTITIES.flatMap((entity) => [
    `${entity.table}:${SYNC_CHANGE_TRIGGER}`,
    ...(entity.versioned ? [`${entity.table}:${SYNC_VERSION_TRIGGER}`] : []),
  ]);
  const rows = await prisma.$queryRaw<Array<{ relname: string; tgname: string }>>`
    SELECT c.relname, t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND t.tgname IN (${SYNC_CHANGE_TRIGGER}, ${SYNC_VERSION_TRIGGER})`;
  const present = new Set(rows.map((row) => `${row.relname}:${row.tgname}`));
  return expected.filter((key) => !present.has(key));
}

let lastCheck: SyncSchemaCheck | null = null;

/** Runs the check, remembers the answer for `/health`, and says so loudly when it fails. */
export async function runSyncSchemaCheck(): Promise<SyncSchemaCheck> {
  const missing = await missingSyncTriggers();
  lastCheck = missing.length === 0 ? { ok: true } : { ok: false, missing };
  if (missing.length > 0) {
    logger.error({
      operation: "sync_schema_check_failed",
      message:
        "Sync feed triggers are missing: the Companion would be told nothing changed. " +
        "Run `prisma migrate deploy`, or restore a backup taken on this version.",
      missing,
    });
  }
  return lastCheck;
}

/** The last answer, or null before the boot check has run. */
export function syncSchemaCheckResult(): SyncSchemaCheck | null {
  return lastCheck;
}
