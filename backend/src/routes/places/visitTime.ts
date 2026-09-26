import { prisma } from "../../db";
import type { AuthRequest } from "../../middleware/auth";
import { resolveTimeField } from "../../shared/time/resolveInput";
import type { TimeFieldInput } from "../../shared/time/timeInput";
import { zoneOf } from "../../shared/time/zoneOf";
import {
  NO_VISIT_TIME,
  visitColumnsFromResolved,
  type VisitTimeColumns,
} from "../../services/timeModel/visitColumns";
import { writtenViaOf, type WrittenVia } from "../../services/timeModel/writtenVia";

/**
 * The time columns of a visit typed or sent by a client (ADR 0002 phase 2).
 *
 * The zone is the PLACE's — the visit happened there — unless the client
 * names one. `visitedAt` is a formerly fake-UTC field, so a bare ISO-Z from a
 * browser session is a cached pre-deploy bundle and is refused
 * (`TIME_SHAPE_REQUIRED`), while the same string from a token (the Companion)
 * is the real instant it always was.
 *
 * One browser path sends a bare ISO-Z on purpose: accepting a photo journey
 * creates its visit with the journey's own start (`acceptPhotoJourney` in the
 * web inbox). That value is a machine instant — the first photograph's EXIF
 * time — and the server holds it: a bare ISO-Z that IS the start of one of
 * this user's photo journeys at this place is read as that instant, and the
 * visit is recorded as `suggestion`. A stale bundle's fake UTC does not match
 * a journey's start to the millisecond.
 */

export interface VisitTimeWrite {
  columns: VisitTimeColumns;
  writtenVia: WrittenVia;
}

async function isPhotoJourneyStart(
  input: TimeFieldInput,
  placeId: string,
  userId: string
): Promise<boolean> {
  if (input.kind !== "instant" || !input.bareZ) return false;
  const journey = await prisma.photoJourney.findFirst({
    where: { userId, placeId, startDate: input.utc },
    select: { id: true },
  });
  return journey !== null;
}

export async function visitTimeColumns(
  input: TimeFieldInput | null,
  place: { id: string; lat: number; lon: number },
  req: AuthRequest
): Promise<VisitTimeWrite> {
  if (!input) return { columns: NO_VISIT_TIME, writtenVia: writtenViaOf(req) };
  const fromJourney = !req.apiToken && (await isPhotoJourneyStart(input, place.id, req.userId!));
  const resolved = await resolveTimeField(input, {
    field: "visitedAt",
    placeZone: () => zoneOf(place),
    userId: req.userId!,
    legacyFakeUtc: true,
    viaToken: Boolean(req.apiToken) || fromJourney,
  });
  return {
    columns: visitColumnsFromResolved(resolved),
    writtenVia: fromJourney ? "suggestion" : writtenViaOf(req),
  };
}
