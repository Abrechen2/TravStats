import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { AuthRequest } from "../../middleware/auth";
import { columnToField, rowVersion, syncEntity, toSyncRecord, type SyncEntity } from "./entities";
import { loadSyncState } from "./state";

/**
 * Optimistic concurrency for edits and deletes (forgejo#141).
 *
 * A client that read a record at version V sends V back — `If-Match: "V"` or
 * `baseVersion: "V"` in the body — and the write goes through only if the
 * record is still at V. Otherwise the answer is 409 with the record as it is
 * now and, where the change log still knows, the fields that moved since V.
 * A client that sends neither is an old client and is served exactly as
 * before: unconditional, last write wins, as it always did.
 *
 * The version is the row's `updated_at`, which every list and detail answer
 * already carries — the phone does not need a new read to have one. The
 * migration's `sync_advance_updated_at` trigger makes it strictly increase on
 * every real change, including raw SQL and two writes in one millisecond.
 *
 * ATOMIC, NOT CHECK-THEN-WRITE. The route handler that does the real write
 * runs after this middleware, on another pooled connection, so a "read,
 * compare, then let the handler write" leaves a window in which a second
 * device's edit at the same base also passes. The check is therefore a claim:
 * one UPDATE that moves `updated_at` forward by a millisecond only where it
 * still equals V. Exactly one of two racing requests matches; the other gets
 * 409. If the handler then refuses the write (a 400, say), the version has
 * moved with no content change — the client's retry meets a 409 whose
 * `changedFields` is empty, which says "nothing you could clash with moved;
 * send it again on the current version".
 */

const versionSchema = z.iso.datetime({ offset: true });

/** `"v"`, `W/"v"` or a bare `v`; `*` asks for no precondition. */
function fromIfMatch(header: string | undefined): string | null {
  if (header === undefined) return null;
  const trimmed = header.trim();
  if (trimmed === "" || trimmed === "*") return null;
  return trimmed.replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}

/** The base version the request names, or null when it names none. */
export function requestedBaseVersion(req: Request): string | null {
  const header = fromIfMatch(req.get("if-match"));
  const body = req.body as { baseVersion?: unknown } | undefined;
  const fromBody = body && typeof body === "object" ? body.baseVersion : undefined;
  if (fromBody !== undefined && typeof fromBody !== "string") {
    throw new AppError("baseVersion must be a version string", 400, "VALIDATION_FAILED");
  }
  if (header !== null && fromBody !== undefined && header !== fromBody) {
    throw new AppError("If-Match and baseVersion disagree", 400, "VALIDATION_FAILED");
  }
  const base = header ?? fromBody ?? null;
  if (base !== null && !versionSchema.safeParse(base).success) {
    throw new AppError(
      "The base version is not a version this server issued",
      400,
      "VALIDATION_FAILED"
    );
  }
  return base;
}

/**
 * The fields that changed after `base`, from the change log; null when the
 * log no longer reaches back that far (pruned, or older than the feed), so
 * the client compares itself instead of trusting an incomplete list.
 */
async function changedFieldsSince(
  entity: SyncEntity,
  id: string,
  base: Date
): Promise<string[] | null> {
  const state = await loadSyncState();
  if (base < state.historyFrom) return null;
  const rows = await prisma.$queryRaw<Array<{ column: string }>>`
    SELECT DISTINCT unnest(changed_columns) AS column
    FROM sync_changes
    WHERE entity = ${entity.name}
      AND entity_id = ${id}
      AND op = 'upsert'
      AND row_updated_at > ${base}::timestamptz AT TIME ZONE 'UTC'`;
  const omitted = new Set(entity.omit);
  return rows
    .map((row) => columnToField(row.column))
    .filter((field) => field !== "updatedAt" && !omitted.has(field))
    .sort();
}

/** Moves the version forward where it still equals `base`; true when it did. */
async function claimVersion(
  entity: SyncEntity,
  id: string,
  userId: string,
  base: string
): Promise<boolean> {
  // `table` and `ownerSql` come from the static entity registry, never from
  // the request; the three values are bound parameters.
  const claimed = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE "${entity.table}" t
       SET updated_at = t.updated_at + interval '1 millisecond'
     WHERE t.id = $1 AND ${entity.ownerSql}
       AND t.updated_at = ($3::timestamptz AT TIME ZONE 'UTC')
     RETURNING t.id`,
    id,
    userId,
    base
  );
  return claimed.length === 1;
}

/**
 * Route middleware: `requireCurrentVersion("flight", "id")`. Must run after
 * `authenticate` and `requireWriteScope`. Without a base version it does
 * nothing; with one it claims the version or answers 409. A record that does
 * not exist (or is not this user's) is left to the handler's own 404.
 */
export function requireCurrentVersion(entityName: string, idParam: string) {
  const entity = syncEntity(entityName);
  if (!entity || !entity.versioned) {
    throw new Error(`requireCurrentVersion: ${entityName} is not a versioned sync entity`);
  }
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const base = requestedBaseVersion(req);
      if (base === null) {
        next();
        return;
      }
      if (req.body && typeof req.body === "object" && "baseVersion" in req.body) {
        const { baseVersion: _drop, ...rest } = req.body as Record<string, unknown>;
        req.body = rest;
      }
      const userId = req.userId;
      if (!userId) throw new AppError("Not authenticated", 401);
      const id = String(req.params[idParam]);
      if (await claimVersion(entity, id, userId, base)) {
        next();
        return;
      }
      const [current] = await entity.find({ where: { AND: [{ id }, entity.ownerWhere(userId)] } });
      if (!current) {
        next();
        return;
      }
      res.status(409).json({
        error: "This record was changed elsewhere since it was read.",
        code: "VERSION_CONFLICT",
        entity: entity.name,
        id,
        baseVersion: base,
        currentVersion: rowVersion(entity, current),
        changedFields: await changedFieldsSince(entity, id, new Date(base)),
        current: toSyncRecord(entity, current),
      });
    } catch (error) {
      next(error);
    }
  };
}
