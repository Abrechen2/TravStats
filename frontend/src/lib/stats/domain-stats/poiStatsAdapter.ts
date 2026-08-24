// Adapter: Place[] + PlaceList[] + curated checklists -> DomainStats. Pure, sync.
//
// The POI counterpart to adaptLodging, with one structural difference worth
// stating: there is no `/stats/poi` rollup to defer to, so every figure here is
// derived from the raw rows. It therefore derives them through
// `shared/placeCounting` — the SAME module the server's achievement engine
// uses — rather than counting inline. That is what keeps the overview card, the
// places list and the badges from disagreeing about whether an undated visit
// happened.
//
// KPI labels are literal German, matching the flight, cruise and lodging
// adapters. None of the four takes a translator; introducing one here would be
// a fifth convention rather than a fix.
import type { Place } from "../../../types/place";
import type { CuratedListSummary, PlaceList } from "../../../types/placeList";
import { classifyPlace, classifyVisit } from "../../../shared/placeCounting";
import type { DomainStats } from "./types";

export interface PoiAdapterInput {
  places: Place[];
  lists: PlaceList[];
  curated: CuratedListSummary[];
}

export function adaptPoi(input?: PoiAdapterInput): DomainStats {
  // No argument at all is the pre-Phase-A resting state, kept so a caller that
  // has not been updated still compiles rather than silently passing undefined
  // into a destructure.
  if (!input) return { domain: "poi", hasData: false };

  const { places, lists, curated } = input;
  const counted = places.filter((p) => classifyPlace(p) === "visited");
  if (counted.length === 0) return { domain: "poi", hasData: false };

  const countries = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const yearlyEvents: Record<number, number> = {};
  const yearlyActiveDays: Record<number, number> = {};
  const monthlyActiveDays: Record<string, number> = {};
  const dailyActiveDays: Record<string, number> = {};
  const weekdayEvents: Record<number, number> = {};
  const countriesByYear: Record<number, Set<string>> = {};

  let totalVisits = 0;

  for (const place of counted) {
    if (place.isoCountryCode) countries.add(place.isoCountryCode.toUpperCase());
    categoryCounts.set(place.category, (categoryCounts.get(place.category) ?? 0) + 1);

    for (const visit of place.visits) {
      if (classifyVisit(visit) !== "visited") continue;
      totalVisits += 1;

      // A visit is an EVENT, and the event is the visit rather than the place:
      // three trips to one McDonald's are three points on the activity chart.
      // An undated one counts in the total above but marks no day — there is
      // no day to mark, exactly as an undated lodging stay has none.
      if (!visit.visitedAt) continue;
      const at = new Date(visit.visitedAt);
      if (Number.isNaN(at.getTime())) continue;

      const year = at.getUTCFullYear();
      const month = String(at.getUTCMonth() + 1).padStart(2, "0");
      const day = String(at.getUTCDate()).padStart(2, "0");
      const ymd = `${year}-${month}-${day}`;

      yearlyEvents[year] = (yearlyEvents[year] ?? 0) + 1;
      weekdayEvents[at.getUTCDay()] = (weekdayEvents[at.getUTCDay()] ?? 0) + 1;
      if (place.isoCountryCode) {
        (countriesByYear[year] ??= new Set()).add(place.isoCountryCode.toUpperCase());
      }
      if (!dailyActiveDays[ymd]) {
        dailyActiveDays[ymd] = 1;
        yearlyActiveDays[year] = (yearlyActiveDays[year] ?? 0) + 1;
        monthlyActiveDays[`${year}-${month}`] = (monthlyActiveDays[`${year}-${month}`] ?? 0) + 1;
      }
    }
  }

  const topCategories = [...categoryCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([label, value]) => ({ label, value }));

  // "Best checklist progress" is a share, not a count: 3 of 7 beats 4 of 20.
  // Comparing raw ticks would make the longest list always look like the one
  // closest to done.
  const bestChecklist = curated
    .filter((c) => c.itemCount > 0)
    .map((c) => ({ ...c, share: c.tickedCount / c.itemCount }))
    .sort((a, b) => b.share - a.share)[0];

  return {
    domain: "poi",
    hasData: true,
    // The event tally is VISITS, matching "1 flight, 1 cruise, 1 stay = 1
    // event" — a visit is the thing that happened on a day.
    totalEvents: totalVisits,
    countries: [...countries],
    countriesByYear: Object.fromEntries(
      Object.entries(countriesByYear).map(([year, set]) => [Number(year), [...set]])
    ),
    yearlyEvents,
    yearlyActiveDays,
    monthlyActiveDays,
    dailyActiveDays,
    weekdayEvents,
    summary: {
      headlineKpis: [
        { label: "Orte besucht", value: counted.length },
        { label: "Länder", value: countries.size },
        {
          label: "Listen",
          // Subscribed checklists are lists too — the same row in the database
          // — so a user who follows two checklists and made none of their own
          // still reads "2" rather than a discouraging "0".
          value: lists.length,
        },
        ...(bestChecklist
          ? [
              {
                label: "Beste Checkliste",
                value: `${bestChecklist.tickedCount}/${bestChecklist.itemCount}`,
              },
            ]
          : []),
      ],
      topItems: { title: "Top-Kategorien", items: topCategories },
      detailRoute: "/places",
    },
  };
}
