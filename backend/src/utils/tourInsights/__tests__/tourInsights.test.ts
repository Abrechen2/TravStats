import { computeTourInsights } from "..";
import { tourFacts, type InsightTour, type InsightTrack } from "../tourFacts";
import { classifyTour } from "../../../shared/tour/tourCounting";
import { totalsOf } from "../../../services/stats/insights/measureItems";

const NOW = new Date("2026-10-09T12:00:00Z");
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function track(over: Partial<InsightTrack> = {}): InsightTrack {
  return {
    startedAt: new Date("2025-06-01T08:00:00Z"),
    endedAt: new Date("2025-06-01T14:00:00Z"),
    distanceKm: 18,
    ascentM: 900,
    movingSeconds: 5 * 3600,
    maxElevationM: 1850,
    truncated: false,
    ...over,
  };
}

let seq = 0;
function tour(over: Partial<InsightTour> = {}): InsightTour {
  seq += 1;
  return {
    id: `t${seq}`,
    name: `Tour ${seq}`,
    activity: "hike",
    tourDate: d("2025-06-01"),
    zone: "Europe/Berlin",
    tripId: null,
    tripName: null,
    anchorStopId: null,
    anchorRoadtripId: null,
    duringCruise: false,
    country: "AT",
    start: null,
    routeKm: 15,
    tracks: [],
    ...over,
  };
}

const facts = (tours: InsightTour[]) => tours.map((t) => tourFacts(t, NOW));

describe("tour counting rule (forgejo#264)", () => {
  it("counts a tour once it is recorded or its day is past, never a sketch", () => {
    const base = { zone: "Europe/Berlin", tracks: [] };
    expect(classifyTour({ ...base, tourDate: d("2026-10-08") }, NOW)).toBe("completed");
    expect(classifyTour({ ...base, tourDate: d("2026-10-09") }, NOW)).toBe("planned");
    expect(classifyTour({ ...base, tourDate: null }, NOW)).toBe("undated");
    expect(
      classifyTour({ ...base, tourDate: null, tracks: [{ startedAt: d("2024-01-01") }] }, NOW)
    ).toBe("completed");
  });
});

describe("tour insights", () => {
  it("reports per activity with coverage, distance from the recording where there is one", () => {
    const { insights } = computeTourInsights(
      facts([
        tour({ tracks: [track()] }),
        tour({ routeKm: 10 }),
        tour({ activity: "bike", routeKm: 60 }),
      ])
    );
    const hike = insights.byActivity.find((a) => a.activity === "hike");
    expect(hike).toMatchObject({
      completed: 2,
      km: { total: 28, tours: 2 },
      ascentM: { total: 900, tours: 1 },
      movingSeconds: { total: 18000, tours: 1 },
      pauseSeconds: { total: 3600, tours: 1 },
    });
    expect(insights.all.completed).toBe(3);
  });

  it("never turns a planned duration into moving time", () => {
    const { insights } = computeTourInsights(facts([tour({ routeKm: 10 })]));
    expect(insights.all.movingSeconds).toEqual({ total: 0, tours: 0 });
    expect(insights.all.pauseSeconds).toEqual({ total: 0, tours: 0 });
  });

  it("takes an undated recorded tour's day on its own clock, not in UTC (review I5)", () => {
    // 31 Dec 2025, 17:30 in California = 1 Jan 2026, 01:30 UTC.
    const start = new Date("2026-01-01T01:30:00Z");
    const f = tourFacts(
      tour({
        tourDate: null,
        zone: "America/Los_Angeles",
        tracks: [track({ startedAt: start, endedAt: new Date("2026-01-01T04:00:00Z") })],
      }),
      NOW
    );
    expect(f.day).toBe("2025-12-31");
    expect(f.year).toBe(2025);
  });

  it("keeps a climb unknown unless every recording of the tour measured it", () => {
    const f = tourFacts(tour({ tracks: [track(), track({ ascentM: null })] }), NOW);
    expect(f.ascentM).toBeNull();
    expect(f.km).toBe(36);
  });

  it("names records per activity: longest, most climb, highest point", () => {
    const high = tour({ name: "Gipfel", tracks: [track({ maxElevationM: 3100, ascentM: 1500 })] });
    const long = tour({ name: "Lang", tracks: [track({ distanceKm: 32, maxElevationM: 900 })] });
    const { insights } = computeTourInsights(facts([high, long]));
    const hike = insights.records.find((r) => r.activity === "hike");
    expect(hike?.longest).toMatchObject({ name: "Lang", value: 32, source: "track" });
    expect(hike?.mostAscent).toMatchObject({ name: "Gipfel", value: 1500 });
    expect(hike?.highest).toMatchObject({ name: "Gipfel", value: 3100 });
  });

  it("files first-time and repeated areas by country from the tour's point", () => {
    const { insights } = computeTourInsights(
      facts([
        tour({ tourDate: d("2024-05-01"), country: "AT" }),
        tour({ tourDate: d("2025-05-01"), country: "AT" }),
        tour({ tourDate: d("2025-07-01"), country: "IT" }),
        tour({ tourDate: d("2025-08-01"), country: null }),
      ])
    );
    expect(insights.rhythm.firstAreas.map((a) => a.country)).toEqual(["AT", "IT"]);
    expect(insights.rhythm.repeatedAreas).toEqual([{ country: "AT", tours: 2 }]);
    expect(insights.rhythm.withoutArea).toBe(1);
    expect(insights.rhythm.byYear).toEqual([
      { year: 2024, tours: 1 },
      { year: 2025, tours: 3 },
    ]);
  });

  it("counts a guided excursion as a tour on its trip — never a bus ride or driven km", () => {
    const { insights, items } = computeTourInsights(
      facts([
        tour({ activity: "excursion", routeKm: 80, tripId: "trip1", duringCruise: true }),
        tour({ activity: "excursion", tourDate: d("2027-01-01") }),
      ])
    );
    expect(insights.links.excursions).toEqual({ completed: 1, km: 80, planned: 1 });
    expect(insights.links.duringCruise).toBe(1);
    expect(insights.links.onTrip).toBe(1);
    expect(insights.planned).toBe(1);
    expect(totalsOf(items).tourDistanceKm.allTime).toBe(80);
  });
});

describe("tour links, areas and record holders as evidence (forgejo#264)", () => {
  const set = facts([
    tour({ tripId: "trip", duringCruise: true, tourDate: d("2024-06-01") }),
    tour({ anchorStopId: "s1", anchorRoadtripId: "rt", tourDate: d("2025-06-01") }),
    tour({ tripId: "trip", anchorStopId: "s2", anchorRoadtripId: "rt", country: "IT" }),
    tour({ country: null }),
    // Planned: counts in no link.
    tour({ tripId: "trip", tourDate: d("2027-01-01") }),
  ]);
  const { items } = computeTourInsights(set);
  const totals = totalsOf(items);

  it("lists each link's tours per year — overlapping, so never added up", () => {
    expect(totals.tourOnTripCount).toEqual({ allTime: 2, byYear: { "2024": 1, "2025": 1 } });
    expect(totals.tourFromRoadtripCount.allTime).toBe(2);
    expect(totals.tourDuringCruiseCount).toEqual({ allTime: 1, byYear: { "2024": 1 } });
    expect(totals.tourLinkedCount.allTime).toBe(3);
    expect(totals.tourStandaloneCount.allTime).toBe(1);
    // Every completed tour is either linked or standalone, exactly once.
    expect(totals.tourLinkedCount.allTime + totals.tourStandaloneCount.allTime).toBe(4);
  });

  it("counts the areas toured by the country at the start, and abstains without one", () => {
    expect(totals.tourCountriesCount.allTime).toBe(2);
    expect(items.tourCountriesCount.map((i) => i.credits)).not.toContainEqual([]);
  });

  it("lists the record-holding tours over all years", () => {
    expect(items.tourRecordTours.length).toBeGreaterThan(0);
    expect(items.tourRecordTours.every((i) => i.year === null)).toBe(true);
  });
});
