import { prisma } from "../../db";
import type { Place as PlaceRow, Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import type { MergePlaceInput } from "../../schemas/place";
import { normaliseNamePair } from "../geo/gluedPlaceName";
import { carryRefsIntoMerge } from "./placeRefs";

type Pick = "target" | "source";

/** What moved from the duplicate to the place that stays — for the log. */
export interface MergeCounts {
  visits: number;
  listEntriesMoved: number;
  /** Lists both were in: the duplicate's entry goes, the membership stays. */
  listEntriesShared: number;
  roadtripStations: number;
  photoJourneys: number;
}

/**
 * Fold one of the caller's places into another (forgejo#232), in ONE
 * transaction: either everything below happens, or nothing does.
 *
 * - Every visit moves, and with a visit its proof photos, kept documents and
 *   photo refusals, which hang off the visit rather than the place.
 * - Every list membership moves. A list both were in keeps one entry — the
 *   one it already had for the place that stays — so the list neither loses
 *   the place nor shows it twice.
 * - Roadtrip stations and photo-journey findings that named the duplicate now
 *   name the place that stays. A finding is DELETED with its place (cascade),
 *   so without this a merge would silently drop open questions.
 * - Master data comes from the side the user picked per group; nothing is
 *   decided for them here.
 * - `visited` is the OR of the two: a place one of them had been to stays
 *   visited — the flag is one-directional everywhere else as well.
 * - The primary source reference (`externalRef`) follows the POSITION — it
 *   names the object at those coordinates — and falls back to the other side's.
 *   The reference that is NOT kept as the primary is not dropped: it becomes an
 *   alias of the place that stays (`PlaceExternalRef`), and the folded place's
 *   own aliases move along, so every dedup path still finds a later import or
 *   search pick of either object (review I1; `placeRefs.ts`). `wikidataId` is
 *   a re-derivable cache, so one of the two is enough. `curatedItemId` is kept
 *   from whichever side has one; two DIFFERENT checklist items cannot become
 *   one place (409).
 * - The merged place leaves its import batch unless both came from the same
 *   one: "Import rückgängig" deletes a batch's places, and must not take the
 *   history that was merged in from elsewhere (review I2).
 * - The name pair goes through `normaliseNamePair`, like every other write: a
 *   second name equal to the first is stored as none.
 *
 * Both places must be the caller's; anything else is 404, the same answer as
 * for a place that does not exist. Nothing here merges by proximity — this
 * only ever runs on two ids the user chose.
 */
export async function mergePlaces(
  userId: string,
  targetId: string,
  input: MergePlaceInput
): Promise<MergeCounts> {
  if (targetId === input.sourceId) {
    throw new AppError("A place cannot be merged into itself", 400, "PLACE_MERGE_SAME");
  }
  return prisma.$transaction(async (tx) => {
    const [target, source] = await Promise.all([
      tx.place.findFirst({ where: { id: targetId, userId } }),
      tx.place.findFirst({ where: { id: input.sourceId, userId } }),
    ]);
    if (!target || !source) throw new AppError("Place not found", 404);
    if (
      target.curatedItemId !== null &&
      source.curatedItemId !== null &&
      target.curatedItemId !== source.curatedItemId
    ) {
      throw new AppError(
        "Both places stand for a different checklist item",
        409,
        "PLACE_MERGE_BOTH_CURATED"
      );
    }

    const merged = mergedData(target, source, input.fields);
    const keptRef = merged.externalRef as string | null;
    const refsToAlias = [target.externalRef, source.externalRef].filter(
      (ref): ref is string => ref !== null && ref !== keptRef
    );

    // The duplicate gives up its unique identity columns BEFORE the place that
    // stays takes them over — `@@unique([userId, externalRef])` and
    // `([userId, curatedItemId])` would refuse two rows holding the same one.
    await tx.place.update({
      where: { id: source.id },
      data: { externalRef: null, curatedItemId: null },
    });

    await carryRefsIntoMerge(tx, userId, target.id, source.id, refsToAlias);

    const visits = await tx.placeVisit.updateMany({
      where: { placeId: source.id, userId },
      data: { placeId: target.id },
    });

    const sourceEntries = await tx.placeListEntry.findMany({ where: { placeId: source.id } });
    const targetLists = new Set(
      (
        await tx.placeListEntry.findMany({
          where: { placeId: target.id },
          select: { listId: true },
        })
      ).map((e) => e.listId)
    );
    const shared = sourceEntries.filter((e) => targetLists.has(e.listId)).map((e) => e.id);
    const moving = sourceEntries.filter((e) => !targetLists.has(e.listId)).map((e) => e.id);
    if (shared.length > 0) await tx.placeListEntry.deleteMany({ where: { id: { in: shared } } });
    if (moving.length > 0) {
      await tx.placeListEntry.updateMany({
        where: { id: { in: moving } },
        data: { placeId: target.id },
      });
    }

    const stations = await tx.tripStop.updateMany({
      where: { placeId: source.id },
      data: { placeId: target.id },
    });
    const journeys = await tx.photoJourney.updateMany({
      where: { placeId: source.id, userId },
      data: { placeId: target.id },
    });

    await tx.place.update({ where: { id: target.id }, data: merged });
    await tx.place.delete({ where: { id: source.id } });

    return {
      visits: visits.count,
      listEntriesMoved: moving.length,
      listEntriesShared: shared.length,
      roadtripStations: stations.count,
      photoJourneys: journeys.count,
    };
  });
}

/** The place that stays, with each group taken from the side the user picked. */
function mergedData(
  target: PlaceRow,
  source: PlaceRow,
  fields: MergePlaceInput["fields"]
): Prisma.PlaceUpdateInput {
  const from = (pick: Pick): PlaceRow => (pick === "source" ? source : target);
  const positioned = from(fields.position);
  const other = positioned === source ? target : source;
  const address = from(fields.address);
  const names = normaliseNamePair(from(fields.name).name, from(fields.localName).localName);
  return {
    name: names.name,
    localName: names.localName,
    category: from(fields.category).category,
    lat: positioned.lat,
    lon: positioned.lon,
    externalRef: positioned.externalRef ?? other.externalRef,
    wikidataId: positioned.wikidataId ?? other.wikidataId,
    address: address.address,
    city: address.city,
    country: address.country,
    // The code was derived from that country text; the pair moves together.
    isoCountryCode: address.isoCountryCode,
    notes: mergedNotes(target.notes, source.notes, fields.notes),
    visited: target.visited || source.visited,
    curatedItemId: target.curatedItemId ?? source.curatedItemId,
    coverPhoto: coverFor(target, source),
    // A merged row is no longer "what that import created" — unless both were.
    batch:
      target.batchId !== null && target.batchId === source.batchId
        ? { connect: { id: target.batchId } }
        : { disconnect: true },
  };
}

function mergedNotes(
  target: string | null,
  source: string | null,
  pick: "target" | "source" | "both"
): string | null {
  if (pick === "target") return target;
  if (pick === "source") return source;
  const both = [target, source].filter((n): n is string => n !== null && n.trim() !== "");
  return both.length > 0 ? both.join("\n\n") : null;
}

/** The lead photo the user chose on either place — the photos move with the visits. */
function coverFor(target: PlaceRow, source: PlaceRow): Prisma.PlaceUpdateInput["coverPhoto"] {
  const id = target.coverPhotoId ?? source.coverPhotoId;
  return id ? { connect: { id } } : { disconnect: true };
}
