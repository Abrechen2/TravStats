import type { PlaceVisit } from "../../../types/place";

/**
 * A visit as `GET /places/:id` sends it: the legacy `visitedAt` beside the
 * time-model columns (`visitedAtUtc` + `visitedZone` + `visitedPrecision`),
 * which `lib/entityTimes.visitTime` and `classifyVisit` read.
 */
export function visitAt(
  id: string,
  utc: string | null,
  extra: Partial<PlaceVisit> & { precision?: "minute" | "day"; zone?: string } = {}
): PlaceVisit {
  const { precision = "minute", zone = "Europe/Berlin", ...rest } = extra;
  return {
    id,
    placeId: "p1",
    tripId: null,
    visitedAt: utc,
    orderIdx: 0,
    notes: null,
    rating: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    photos: [],
    documentCount: 0,
    ...(utc ? { visitedAtUtc: utc, visitedZone: zone, visitedPrecision: precision } : {}),
    ...rest,
  } as PlaceVisit;
}
