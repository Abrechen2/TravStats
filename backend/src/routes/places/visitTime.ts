import type { AuthRequest } from "../../middleware/auth";
import { resolveTimeField } from "../../shared/time/resolveInput";
import type { TimeFieldInput } from "../../shared/time/timeInput";
import { zoneOf } from "../../shared/time/zoneOf";
import {
  NO_VISIT_TIME,
  visitColumnsFromResolved,
  type VisitTimeColumns,
} from "../../services/timeModel/visitColumns";

/**
 * The time columns of a visit typed or sent by a client (ADR 0002 phase 2).
 *
 * The zone is the PLACE's — the visit happened there — unless the client
 * names one. `visitedAt` is a formerly fake-UTC field, so a bare ISO-Z from a
 * browser session is a cached pre-deploy bundle and is refused
 * (`TIME_SHAPE_REQUIRED`), while the same string from a token (the Companion)
 * is the real instant it always was.
 */
export async function visitTimeColumns(
  input: TimeFieldInput | null,
  place: { lat: number; lon: number },
  req: AuthRequest
): Promise<VisitTimeColumns> {
  if (!input) return NO_VISIT_TIME;
  const resolved = await resolveTimeField(input, {
    field: "visitedAt",
    placeZone: () => zoneOf(place),
    userId: req.userId!,
    legacyFakeUtc: true,
    viaToken: Boolean(req.apiToken),
  });
  return visitColumnsFromResolved(resolved);
}
