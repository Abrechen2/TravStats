/**
 * The incremental change feed for offline clients (forgejo#141).
 *
 * The version-precondition contract on the edit and delete routes lives here
 * too, because it is the other half of the same protocol: the feed hands out
 * `version`, the edit routes take it back as `If-Match` / `baseVersion`.
 */

import { z } from "zod";

import { registry } from "../registry";
import { SYNC_PAGE_DEFAULT, SYNC_PAGE_MAX } from "../../../schemas/sync";
import { SYNC_RETENTION_DAYS } from "../../sync/state";
import { SYNC_ENTITIES } from "../../sync/entities";
import { errorContent } from "./shared";
import { guardedOperations } from "../syncConflicts";

/** `PATCH|DELETE /rail/{id}, …` — read from the same list the routes mount. */
function guardedOperationList(): string {
  const byPath = new Map<string, string[]>();
  for (const { method, path } of guardedOperations()) {
    byPath.set(path, [...(byPath.get(path) ?? []), method.toUpperCase()]);
  }
  return [...byPath].map(([path, methods]) => `${methods.join("|")} ${path}`).join(", ");
}

const entityName = z.enum(SYNC_ENTITIES.map((entity) => entity.name) as [string, ...string[]]);

const syncChange = z.discriminatedUnion("op", [
  z.object({
    entity: entityName,
    id: z.string(),
    op: z.literal("upsert"),
    version: z
      .string()
      .nullable()
      .describe(
        "The record's version (its updatedAt) to send back as If-Match; null for documents"
      ),
    record: z
      .record(z.string(), z.unknown())
      .describe(
        "The stored row, as the entity's own read endpoints carry it, minus bulky derived " +
          "columns (a flight's actualRoute and enrichmentHistory, a ride's geometry) and " +
          "server internals (a document's storedName and parsedPayload, a companion's " +
          "searchName). Times are stored " +
          "values: instants in UTC plus the local fields of the time model."
      ),
  }),
  z.object({ entity: entityName, id: z.string(), op: z.literal("delete") }),
]);

export const versionConflictSchema = z.object({
  error: z.string(),
  code: z.literal("VERSION_CONFLICT"),
  entity: entityName,
  id: z.string(),
  baseVersion: z.string().describe("The version the request named"),
  currentVersion: z.string().nullable().describe("The record's version now"),
  changedFields: z
    .array(z.string())
    .nullable()
    .describe(
      "Fields changed after baseVersion. Empty: only the version moved (a refused write " +
        "claimed it) — resend on currentVersion. Null: the change log does not reach back " +
        "that far; compare against `current` instead."
    ),
  current: z.record(z.string(), z.unknown()).describe("The record as it is now"),
});

registry.registerPath({
  method: "get",
  path: "/sync/changes",
  summary: "Incremental change feed for offline clients",
  description:
    "Without `since`: a full read of the account, page by page (`mode: full`). With `since`: " +
    "every record created, changed or deleted after that cursor, oldest first, one item per " +
    "record carrying its current state (`mode: delta`). Call again with the returned cursor " +
    "while `hasMore` is true. The cursor is opaque — a position in transaction order, never a " +
    "clock — and a change from a transaction still running is held back until it commits. " +
    "Covered: trips, journal entries, trip stops and stations, flights, rail journeys, cruises " +
    "and their stops, lodgings and stays, places and visits, tour and roadtrip sections, " +
    "rental bookings, trip and roadtrip expenses, the companion catalogue (entries carry " +
    "their companions as the `companions` name array) and document metadata. Hidden domains " +
    "are left out. A cursor the server cannot continue " +
    `answers 410 SYNC_RESYNC_REQUIRED: older than the ${SYNC_RETENTION_DAYS}-day tombstone ` +
    "horizon (cursorExpired), minted before the account's visible domains changed " +
    "(scopeChanged), or before a database restore (epochChanged, cursorFromFuture) — start " +
    "again without `since`. Edits and deletes on " +
    guardedOperationList() +
    " accept the record's version as `If-Match` or a `baseVersion` body field and answer " +
    "409 VERSION_CONFLICT (schema VersionConflict) when the record moved on; without either " +
    "they stay unconditional.",
  tags: ["Sync"],
  request: {
    query: z.object({
      since: z.string().optional().describe("The cursor of the previous answer"),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(SYNC_PAGE_MAX)
        .optional()
        .describe(`Page size, default ${SYNC_PAGE_DEFAULT}`),
    }),
  },
  responses: {
    200: {
      description: "One page of the feed",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              mode: z.enum(["full", "delta"]),
              changes: z.array(syncChange),
              cursor: z.string(),
              hasMore: z.boolean(),
            }),
          }),
        },
      },
    },
    400: { description: "`since` is not a cursor this server issued", content: errorContent },
    401: { description: "Not signed in", content: errorContent },
    410: {
      description: "The cursor cannot be continued; start a full read",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(false),
            error: z.string(),
            code: z.literal("SYNC_RESYNC_REQUIRED"),
            reason: z.enum(["epochChanged", "scopeChanged", "cursorExpired", "cursorFromFuture"]),
          }),
        },
      },
    },
  },
});

registry.register("VersionConflict", versionConflictSchema);
