/**
 * The places insights (forgejo#259): discoveries against returns, the longest
 * pause before a return, category variety, how well visits are documented,
 * and the largest straight-line jump between two visits. Pure — the loader is
 * `services/stats/insights/placeInsightData.ts`; `now` is a parameter so a
 * test can pin the boundary between a visit and a plan.
 */
import { dayPrecisionDate } from "../../services/evidence/entryMappersDomains";
import type {
  EntryRef,
  MeasureItem,
  MeasureItems,
} from "../../services/stats/insights/measureItems";
import { prepareVisits, type PreparedVisit } from "./prepare";
import {
  computeDiscoveries,
  computeDiversity,
  computeDocumentation,
  computeJump,
  computeRevisits,
  hasNote,
} from "./blocks";
import type { InsightPlace, PlaceInsights } from "./types";

export type { InsightPlace, PlaceInsights } from "./types";

function visitRef(v: PreparedVisit): EntryRef {
  return {
    domain: "place",
    id: v.visit.id,
    href: `/places/${v.place.id}`,
    title: { text: v.place.name },
    subtitle: v.visit.trip ? { text: v.visit.trip.name } : null,
    date: dayPrecisionDate(v.day ? new Date(`${v.day}T00:00:00Z`) : null),
  };
}

function one(v: PreparedVisit): MeasureItem {
  return { entry: visitRef(v), year: v.year, contribution: 1 };
}

/**
 * Lifetime-only items carry `year: null`: the returning places and the
 * longest jump are readings over the whole logbook, and the registry refuses
 * a year for them.
 */
function lifetimeItems(
  counted: readonly PreparedVisit[],
  revisits: PlaceInsights["revisits"],
  jump: PlaceInsights["jump"]
): MeasureItems {
  const byId = new Map(counted.map((v) => [v.visit.id, v]));
  const jumpVisits = jump.longest
    ? [jump.longest.from.visitId, jump.longest.to.visitId].flatMap((id) => {
        const v = byId.get(id);
        return v ? [{ entry: visitRef(v), year: null, contribution: 1 }] : [];
      })
    : [];
  return {
    // A place returned to in two or more calendar years; the union counts places.
    placeReturningPlaceCount: revisits.returning.map((r) => ({
      entry: {
        domain: "place",
        id: r.placeId,
        href: `/places/${r.placeId}`,
        title: { text: r.name },
        subtitle: { text: r.years.join(" · ") },
        date: null,
      },
      year: null,
      credits: [r.placeId],
      creditLabels: { [r.placeId]: r.name },
    })),
    // The two visits the longest straight-line jump runs between.
    placeLongestJumpVisits: jumpVisits,
  };
}

function measureItems(counted: readonly PreparedVisit[]): MeasureItems {
  // Discoveries and returns use the SAME ordering `computeDiscoveries` does,
  // so the panel and the year chart cannot disagree on which visit was first.
  const discoveries: MeasureItem[] = [];
  const revisits: MeasureItem[] = [];
  const grouped = new Map<string, PreparedVisit[]>();
  for (const v of counted) grouped.set(v.place.id, [...(grouped.get(v.place.id) ?? []), v]);
  for (const visits of grouped.values()) {
    if (visits.some((v) => v.year === null || v.instant === null)) continue;
    const ordered = [...visits].sort((a, b) => (a.instant as number) - (b.instant as number));
    ordered.forEach((v, i) => (i === 0 ? discoveries : revisits).push(one(v)));
  }
  return {
    placeDiscoveryVisits: discoveries,
    placeRevisitVisits: revisits,
    placeVisitsWithPhoto: counted.filter((v) => v.visit.photoCount > 0).map(one),
    placeVisitsWithNote: counted.filter(hasNote).map(one),
    placeVisitsWithRating: counted.filter((v) => v.visit.rating !== null).map(one),
  };
}

export function computePlaceInsights(
  places: readonly InsightPlace[],
  now: Date
): { insights: PlaceInsights; items: MeasureItems } {
  const { counted, countedPlaces, planned } = prepareVisits(places, now);
  const revisits = computeRevisits(counted);
  const jump = computeJump(counted);
  return {
    insights: {
      discoveries: computeDiscoveries(counted, countedPlaces),
      revisits,
      diversity: computeDiversity(counted, countedPlaces),
      documentation: computeDocumentation(counted),
      jump,
      plannedVisits: planned,
    },
    items: { ...measureItems(counted), ...lifetimeItems(counted, revisits, jump) },
  };
}
