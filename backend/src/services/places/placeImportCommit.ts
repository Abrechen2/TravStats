import { classifyVisit } from "../../shared/placeCounting";
import { resolveCountryCode } from "../../shared/geo/countryCode";
import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { canonicalPlaceRef, findPlaceIdByRef } from "./placeRefs";
import { confirmOwnStay, visitTripId, writeTripStop } from "./takeout/takeoutCommit";
import logger from "../../utils/logger";
import {
  PLACE_IMPORT_FAILURE_MESSAGES,
  type PlaceImportCandidate,
  type PlaceImportFailureCode,
  type PlaceImportSource,
} from "../../schemas/placeImport";

const UNIQUE_VIOLATION = "P2002";

export interface PlaceImportFailure {
  sourceRowIndex: number;
  code: PlaceImportFailureCode;
  error: string;
}

export interface PlaceCommitResult {
  batchId: string;
  created: number;
  /** Already here. Not an error — this is what makes a re-import a no-op. */
  skipped: number;
  /** Rows written as trip stops instead of places (#358). */
  stops: number;
  /** Trip-stop rows skipped because the trip already has that stop on that day. */
  stopsSkipped: number;
  /** Rows confirmed as one of the user's stays — nothing written for them. */
  matchedStays: number;
  failed: PlaceImportFailure[];
}

/**
 * Commit a POI import as one revertible batch — POI Phase D §5.
 *
 * The properties below are copied from `lodgingImportCommit` on purpose; each
 * of them was learned somewhere more expensive than here.
 *
 * - Every row is written in its own try/catch: **a failed row never fails the
 *   batch.** A file of 300 places must not be lost to row 41.
 * - A unique-constraint hit on `externalRef` is a SKIP, not a failure. That is
 *   precisely what lets someone re-run the same file after resolving a few more
 *   rows and get only the new ones.
 * - Failures collapse to a fixed vocabulary. This response is a 201 body, so
 *   the error handler's leak protections never run on it and a raw Prisma
 *   message would go straight to the client.
 * - No geocoding happens here. A row without coordinates is not written at all
 *   — the preview already offered it to the user, and `Place` is a point.
 */
export async function commitPlaceImport(
  userId: string,
  source: PlaceImportSource,
  fileName: string | null,
  rows: readonly PlaceImportCandidate[]
): Promise<PlaceCommitResult> {
  const batch = await prisma.importBatch.create({
    data: { userId, domain: "poi", source, fileName },
  });

  let created = 0;
  let skipped = 0;
  let stops = 0;
  let matchedStays = 0;
  let stopsSkipped = 0;
  const failed: PlaceImportFailure[] = [];
  const fail = (sourceRowIndex: number, code: PlaceImportFailureCode): void => {
    failed.push({ sourceRowIndex, code, error: PLACE_IMPORT_FAILURE_MESSAGES[code] });
  };

  for (const row of rows) {
    try {
      const hasPosition =
        typeof row.lat === "number" &&
        typeof row.lon === "number" &&
        Number.isFinite(row.lat) &&
        Number.isFinite(row.lon);

      // "This is my stay" needs no position: it writes nothing, it only
      // confirms the stay the preview matched is the caller's.
      if (row.treatment === "stay") {
        const outcome = await confirmOwnStay(userId, row);
        if (outcome === "ok") matchedStays += 1;
        else fail(row.sourceRowIndex, outcome);
        continue;
      }

      if (!hasPosition) {
        // Reported rather than silently dropped: the user is told which of
        // their rows did not make it, by name, so they can judge whether
        // anything they cared about is missing.
        fail(row.sourceRowIndex, "no_position");
        continue;
      }

      if (row.treatment === "trip_stop") {
        const outcome = await writeTripStop(userId, {
          ...row,
          lat: row.lat as number,
          lon: row.lon as number,
        });
        if (outcome === "ok") stops += 1;
        else if (outcome === "exists") stopsSkipped += 1;
        else fail(row.sourceRowIndex, outcome);
        continue;
      }

      // Already here — as a place's own reference or as an alias a merge left
      // (forgejo#232). The unique index below cannot see the alias table.
      // A Google CID is stored as `gmaps-cid:<decimal>` whatever spelling the
      // row arrived in, so production's existing references and new ones agree.
      const rawRef = row.externalRef?.trim() || null;
      const ref = rawRef === null ? null : canonicalPlaceRef(rawRef);
      if (ref !== null && (await findPlaceIdByRef(prisma, userId, ref)) !== null) {
        skipped += 1;
        continue;
      }

      const visitedAt = row.visitedAt ? new Date(row.visitedAt) : null;
      const usableVisitedAt = visitedAt && !Number.isNaN(visitedAt.getTime()) ? visitedAt : null;
      // Three states, not two. NO date means the user saved the place — that
      // was always right and stays right. A date that has PASSED means they
      // were there. A date in the FUTURE is a plan, and the import used to
      // read it as "has been there" simply because a date was present, so a
      // row dated 2099 arrived as already visited (AUD-074).
      //
      // `classifyVisit` alone cannot answer this: a null date is `visited` to
      // it, because an undated VISIT ROW is still a visit. An import row
      // without a date is not a visit row at all.
      const happened =
        usableVisitedAt !== null && classifyVisit({ visitedAt: usableVisitedAt }) === "visited";
      // A trip the row names but the caller does not own is refused, not
      // dropped: a visit silently losing its trip is a quiet downgrade.
      const tripId = row.tripId ? await visitTripId(userId, row.tripId) : null;
      if (row.tripId && !tripId) {
        fail(row.sourceRowIndex, "invalid_target");
        continue;
      }
      const country = row.country?.trim() || null;

      await prisma.place.create({
        data: {
          userId,
          batchId: batch.id,
          name: row.name.trim(),
          lat: row.lat as number,
          lon: row.lon as number,
          // `Place.category` is NOT NULL with a default; passing null would be
          // rejected, and inventing a category would be worse. Omitting it lets
          // the schema's own default stand.
          ...(row.category?.trim() ? { category: row.category.trim() } : {}),
          address: row.address?.trim() || null,
          city: row.city?.trim() || null,
          country,
          // Derived exactly as the manual create derives it. Without it the
          // country was stored as prose only, so `/places?country=DE` found
          // nothing and the POI statistics counted zero countries for rows
          // that plainly named one (AUD-075).
          isoCountryCode: resolveCountryCode(country),
          notes: row.notes?.trim() || null,
          externalRef: ref,
          // A place imported with a date that has PASSED is one the user has
          // been to; anything else is a place they saved.
          visited: happened,
          // The date is the evidence, so it is kept as a visit instead of being
          // reduced to a boolean and thrown away. The import used to record
          // `visited: true` and no `PlaceVisit` at all, which left the place
          // counted as visited while every visit figure read zero (AUD-074).
          ...(usableVisitedAt !== null
            ? { visits: { create: [{ userId, tripId, visitedAt: usableVisitedAt, orderIdx: 0 }] } }
            : {}),
          dataSource: "import",
        },
      });
      created += 1;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
        skipped += 1;
        continue;
      }
      logger.warn({ err, userId, sourceRowIndex: row.sourceRowIndex }, "[Place Import] Row failed");
      fail(row.sourceRowIndex, "write_failed");
    }
  }

  logger.info(
    {
      operation: "place_import_commit",
      context: {
        userId,
        batchId: batch.id,
        created,
        skipped,
        stops,
        matchedStays,
        stopsSkipped,
        failed: failed.length,
      },
    },
    "[Place Import] Commit complete"
  );

  return { batchId: batch.id, created, skipped, stops, stopsSkipped, matchedStays, failed };
}
