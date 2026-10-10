import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { resolveCountryCode } from "../../shared/geo/countryCode";
import { isPlaceCategory } from "../../shared/placeCategories";
import { classifyVisit } from "../../shared/placeCounting";
import { resolveTimeField } from "../../shared/time/resolveInput";
import type { TimeFieldInput } from "../../shared/time/timeInput";
import { zoneOf } from "../../shared/time/zoneOf";
import { normaliseNamePair } from "../geo/gluedPlaceName";
import { findPlaceIdByRef } from "../places/placeRefs";
import { visitColumnsFromResolved } from "../timeModel/visitColumns";
import { recheckAchievements } from "../../utils/achievements";

/**
 * Accepting a `visit` finding (forgejo#211): the place and the visit are made
 * HERE, on the server, in one transaction.
 *
 * The other findings are accepted in two steps — the web creates the entry
 * through the normal endpoints and then links it — because what they create
 * is something the client already knows how to make. A visit finding is
 * different in one way that matters: the place may not exist yet. Two
 * requests (create the place, then the visit) and a third (link) is three
 * places for the sequence to break with a place on the map and no visit on
 * it, and the inbox's retry logic was built around exactly that failure.
 * One transaction cannot half-happen.
 *
 * The place is REUSED before it is made: the own place the scan found within
 * reach, else a place with the same `osm:` ref (the dedup key `POST /places`
 * honours). A second accept of a row that already carries its visit returns
 * that visit — a retry after a lost response must not record the stop twice.
 */

export interface AcceptVisitInput {
  /** Overrides the suggested name; required when the scan named nothing. */
  name?: string;
  localName?: string;
  /**
   * The reader's correction (the batch review, forgejo#211 O5): an own place
   * the visit goes on instead of the one the scan found or would create.
   */
  placeId?: string;
  /** The reader's correction: when the visit was, instead of the first photo's instant. */
  visitedAt?: TimeFieldInput;
}

export interface AcceptVisitOutcome {
  placeId: string;
  placeVisitId: string;
  /** False when an existing place took the visit. */
  placeCreated: boolean;
  /**
   * False when the place already had a visit that day and the finding was
   * linked to it — accepting must not record the same stop twice.
   */
  visitCreated: boolean;
}

const DEFAULT_CATEGORY = "landmark";

type Row = Prisma.PhotoJourneyGetPayload<{ select: typeof ROW }>;
const ROW = {
  id: true,
  kind: true,
  tripId: true,
  placeId: true,
  suggestedName: true,
  suggestedLocalName: true,
  suggestedRef: true,
  suggestedCategory: true,
  startDate: true,
  lat: true,
  lon: true,
  city: true,
  countryName: true,
  countryCode: true,
  createdPlaceVisitId: true,
} as const satisfies Prisma.PhotoJourneySelect;

/**
 * The place the visit goes on: the one the reader chose, an own one within
 * reach, the same ref, or none yet. A chosen place that is not the caller's is
 * a refusal, never a quiet fall-back to the scan's — the reader said which.
 */
async function existingPlace(
  userId: string,
  row: Row,
  chosenId: string | undefined
): Promise<{ id: string; lat: number; lon: number; visited: boolean } | null> {
  const select = { id: true, lat: true, lon: true, visited: true } as const;
  if (chosenId) {
    const chosen = await prisma.place.findFirst({ where: { id: chosenId, userId }, select });
    if (!chosen) {
      throw new AppError("Place not found", 404, "VISIT_PLACE_NOT_FOUND", "placeId");
    }
    return chosen;
  }
  if (row.placeId) {
    const own = await prisma.place.findFirst({ where: { id: row.placeId, userId }, select });
    if (own) return own;
  }
  if (row.suggestedRef) {
    // Its own reference or an alias a merge left on it (forgejo#232).
    const holderId = await findPlaceIdByRef(prisma, userId, row.suggestedRef);
    return holderId ? prisma.place.findFirst({ where: { id: holderId, userId }, select }) : null;
  }
  return null;
}

function placeData(userId: string, row: Row, input: AcceptVisitInput): Prisma.PlaceCreateInput {
  const name = input.name?.trim() || row.suggestedName;
  if (!name) {
    throw new AppError(
      "The lookup named nothing here; send a name for the place",
      400,
      "VISIT_NAME_REQUIRED",
      "name"
    );
  }
  const names = normaliseNamePair(name, input.localName ?? row.suggestedLocalName);
  return {
    user: { connect: { id: userId } },
    name: names.name,
    localName: names.localName,
    category: isPlaceCategory(row.suggestedCategory) ? row.suggestedCategory : DEFAULT_CATEGORY,
    lat: row.lat,
    lon: row.lon,
    city: row.city,
    country: row.countryName,
    isoCountryCode: resolveCountryCode(row.countryName) ?? row.countryCode,
    externalRef: row.suggestedRef,
    dataSource: "manual",
  };
}

export async function acceptVisitFinding(
  userId: string,
  journeyId: string,
  input: AcceptVisitInput
): Promise<AcceptVisitOutcome> {
  const row = await prisma.photoJourney.findFirst({
    where: { id: journeyId, userId, kind: "visit" },
    select: ROW,
  });
  if (!row) throw new AppError("Photo journey not found", 404);

  if (row.createdPlaceVisitId) {
    const visit = await prisma.placeVisit.findFirst({
      where: { id: row.createdPlaceVisitId, userId },
      select: { id: true, placeId: true },
    });
    if (visit) {
      return {
        placeId: visit.placeId,
        placeVisitId: visit.id,
        placeCreated: false,
        visitCreated: false,
      };
    }
  }

  const found = await existingPlace(userId, row, input.placeId);
  const toCreate = found ? null : placeData(userId, row, input);
  // Validated before the transaction opens, so a missing name costs nothing.

  const target = found ?? { lat: row.lat, lon: row.lon, visited: false };
  // The first photograph's instant, read at the place: a machine instant,
  // never a bare-Z refusal — the server holds the value, no bundle sent it.
  // A corrected time is the reader's, typed on the place's clock — resolved
  // like any browser write, so a bare ISO-Z from a stale bundle is refused.
  const resolved = await resolveTimeField(
    input.visitedAt ?? { kind: "instant", utc: row.startDate, bareZ: false },
    {
      field: "visitedAt",
      placeZone: () => zoneOf(target),
      userId,
      legacyFakeUtc: true,
      viaToken: input.visitedAt === undefined,
    }
  );
  const time = visitColumnsFromResolved(resolved);
  // An existing place may already carry a visit that day — logged by hand
  // after the scan, or by an earlier answer. Linking to it records the answer
  // without recording the stop twice.
  const sameDay = found ? await visitOnSameDay(userId, found.id, time.visitedAt) : null;
  // A stop photographed in the past HAPPENED, so the place leaves the wishlist
  // — the rule `POST /places/:id/visits` applies, from the same predicate.
  const happened = classifyVisit({ visitedAt: time.visitedAt }) === "visited";

  const outcome = await prisma.$transaction(async (tx) => {
    const place = toCreate
      ? await tx.place.create({ data: { ...toCreate, visited: happened }, select: { id: true } })
      : found!;
    if (sameDay) {
      await tx.photoJourney.update({
        where: { id: row.id },
        data: { status: "accepted", createdPlaceVisitId: sameDay, resolvedAt: new Date() },
      });
      return { placeId: place.id, placeVisitId: sameDay, placeCreated: false, visitCreated: false };
    }
    const visit = await tx.placeVisit.create({
      data: {
        placeId: place.id,
        userId,
        tripId: row.tripId,
        ...time,
        writtenVia: "suggestion",
      },
      select: { id: true },
    });
    if (!toCreate && happened && !found!.visited) {
      await tx.place.update({ where: { id: place.id }, data: { visited: true } });
    }
    await tx.photoJourney.update({
      where: { id: row.id },
      data: { status: "accepted", createdPlaceVisitId: visit.id, resolvedAt: new Date() },
    });
    return {
      placeId: place.id,
      placeVisitId: visit.id,
      placeCreated: toCreate !== null,
      visitCreated: true,
    };
  });

  await recheckAchievements(userId, "photo visit accept");
  return outcome;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A visit of the caller's at this place on the same calendar day, or null.
 * `visitedAt` holds the place's wall clock as fake UTC, so its UTC date IS the
 * local day — no zone arithmetic, and the same reading the visit list uses.
 */
async function visitOnSameDay(
  userId: string,
  placeId: string,
  visitedAt: Date | null
): Promise<string | null> {
  if (!visitedAt) return null;
  const dayStart = Date.parse(`${visitedAt.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const visit = await prisma.placeVisit.findFirst({
    where: {
      userId,
      placeId,
      visitedAt: { gte: new Date(dayStart), lt: new Date(dayStart + DAY_MS) },
    },
    select: { id: true },
    orderBy: { visitedAt: "asc" },
  });
  return visit?.id ?? null;
}
