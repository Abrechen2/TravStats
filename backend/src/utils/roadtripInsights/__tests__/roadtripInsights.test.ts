import { computeRoadtripInsights, type InsightRoadtrip } from "..";
import type { InsightStation } from "../types";
import type { TourFacts } from "../../tourInsights/tourFacts";
import { totalsOf } from "../../../services/stats/insights/measureItems";
import { legPhase, stationPhase } from "../../../shared/tour/roadtripTimeline";

const NOW = new Date("2026-07-15T12:00:00Z");
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const resolver = { countryAt: (lat: number) => (lat > 57.8 ? "NO" : lat > 54.5 ? "DK" : "DE") };

function station(id: string, over: Partial<InsightStation> = {}): InsightStation {
  return {
    id,
    title: id,
    lat: 53.5,
    lon: 10,
    startDate: null,
    endDate: null,
    stopZone: "Europe/Berlin",
    overnight: false,
    viaPoint: false,
    lodgingStayId: null,
    lodgingStay: null,
    ...over,
  };
}

const leg = (from: string, to: string, km: number, mode = "road", source = "routed") => ({
  fromStopId: from,
  toStopId: to,
  distanceKm: km,
  mode,
  source,
});

function trip(stations: InsightStation[], legs: ReturnType<typeof leg>[]): InsightRoadtrip {
  return { id: "r1", name: "Nordkap", vehicle: "campervan", stations, legs };
}

describe("roadtrip timeline rule (forgejo#260)", () => {
  it("places a station and a leg on its own calendar: before today, today, ahead", () => {
    const yesterday = station("a", { startDate: d("2026-07-14") });
    const today = station("b", { startDate: d("2026-07-15") });
    const ahead = station("c", { startDate: d("2026-07-16") });
    expect(stationPhase(yesterday, NOW)).toBe("past");
    expect(stationPhase(today, NOW)).toBe("current");
    expect(stationPhase(ahead, NOW)).toBe("planned");
    expect(legPhase(yesterday, today, NOW)).toBe("current");
    expect(legPhase(today, ahead, NOW)).toBe("planned");
  });
});

describe("roadtrip insights", () => {
  it("keeps recorded, today's and planned kilometres apart and names the source", () => {
    const { insights, items } = computeRoadtripInsights(
      [
        trip(
          [
            station("a", { startDate: d("2026-07-12") }),
            station("b", {
              startDate: d("2026-07-13"),
              endDate: d("2026-07-15"),
              overnight: true,
              lat: 56,
            }),
            station("c", { startDate: d("2026-07-15"), lat: 58.5 }),
            station("d", { startDate: d("2026-07-18"), lat: 60 }),
          ],
          [leg("a", "b", 300, "road", "straight"), leg("b", "c", 120, "ferry"), leg("c", "d", 500)]
        ),
      ],
      [],
      resolver,
      NOW
    );
    const r = insights.roadtrips[0];
    expect(r.phase).toBe("current");
    expect(r.km).toEqual({ recorded: 300, current: 120, planned: 500, unplaced: 0 });
    expect(r.kmBySource).toEqual({ straight: 300 });
    expect(r.kmByMode).toEqual({ road: 300 });
    expect(r.countries).toEqual({ recorded: ["DE", "DK"], planned: ["NO"] });
    expect(r.roadKm).toEqual({ recorded: 300, current: 0, planned: 500, unplaced: 0 });
    expect(totalsOf(items).roadtripDrivenKm).toEqual({ allTime: 300, byYear: { "2026": 300 } });
    // Review I3: the evidence row carries the first station's real day.
    expect(items.roadtripDrivenKm[0].entry.date).toEqual({ value: "2026-07-12", precision: "day" });
  });

  it("drives a day on the road only: a long ferry crossing is never the longest driving day", () => {
    const { insights } = computeRoadtripInsights(
      [
        trip(
          [
            station("a", { startDate: d("2026-06-01"), endDate: d("2026-06-01") }),
            station("b", { startDate: d("2026-06-01"), endDate: d("2026-06-02") }),
            station("c", { startDate: d("2026-06-02"), endDate: d("2026-06-03") }),
            station("e", { startDate: d("2026-06-03") }),
          ],
          [
            // 1 June: 150 km of road, then a 600 km overnight-free ferry the same day.
            leg("a", "b", 150),
            // 2 June: ferry only — a day on board, no driving day at all.
            leg("b", "c", 600, "ferry"),
            leg("c", "e", 200),
          ]
        ),
      ],
      [],
      resolver,
      NOW
    );
    expect(insights.pace.dayStages).toBe(2);
    expect(insights.pace.longestDay).toMatchObject({ day: "2026-06-03", km: 200 });
    expect(insights.roadtrips[0].roadKm.recorded).toBe(350);
    expect(insights.roadtrips[0].km.recorded).toBe(950);
  });

  it("gives an undated roadtrip's evidence rows no date rather than an invented one", () => {
    const { items } = computeRoadtripInsights(
      [trip([station("a"), station("b")], [leg("a", "b", 50)])],
      [],
      resolver,
      NOW
    );
    expect(items.roadtripDrivenKm[0].entry.date).toBeNull();
    expect(items.roadtripDrivenKm[0].year).toBeNull();
  });

  it("reports ferry kilometres beside the road, never as driven", () => {
    const { insights, items } = computeRoadtripInsights(
      [
        trip(
          [
            station("a", { startDate: d("2026-06-01") }),
            station("b", { startDate: d("2026-06-01") }),
            station("c", { startDate: d("2026-06-02") }),
          ],
          [leg("a", "b", 200), leg("b", "c", 90, "ferry")]
        ),
      ],
      [],
      resolver,
      NOW
    );
    expect(insights.roadtrips[0].kmByMode).toEqual({ road: 200, ferry: 90 });
    expect(totalsOf(items).roadtripDrivenKm.allTime).toBe(200);
    expect(totalsOf(items).roadtripFerryKm.allTime).toBe(90);
  });

  it("reads a corrected route as one day stage, and counts rest days only on a fully dated trip", () => {
    const { insights } = computeRoadtripInsights(
      [
        trip(
          [
            station("a", { startDate: d("2026-06-01"), endDate: d("2026-06-01") }),
            station("via", { viaPoint: true }),
            station("b", { startDate: d("2026-06-01"), endDate: d("2026-06-04"), overnight: true }),
            station("c", { startDate: d("2026-06-04") }),
          ],
          [leg("a", "via", 100), leg("via", "b", 150), leg("b", "c", 80)]
        ),
      ],
      [],
      resolver,
      NOW
    );
    expect(insights.pace.dayStages).toBe(2);
    expect(insights.pace.longestDay).toMatchObject({ day: "2026-06-01", km: 250 });
    expect(insights.pace.medianDayKm).toBe(165);
    // 1 June and 4 June have stages; 2 and 3 June are rest days.
    expect(insights.roadtrips[0].restDays).toBe(2);
  });

  it("splits nights by where they were slept and counts a linked stay once", () => {
    const stay = {
      id: "s1",
      checkIn: d("2026-06-02"),
      checkOut: d("2026-06-04"),
      datePrecision: "DAY",
      nights: null,
      status: "completed",
      lodging: { type: "campsite", isoCountryCode: "DK" },
    };
    const { insights } = computeRoadtripInsights(
      [
        trip(
          [
            station("a", { startDate: d("2026-06-01"), endDate: d("2026-06-02"), overnight: true }),
            station("b", {
              startDate: d("2026-06-02"),
              overnight: true,
              lodgingStayId: "s1",
              lodgingStay: stay,
            }),
            station("b2", {
              startDate: d("2026-06-03"),
              overnight: true,
              lodgingStayId: "s1",
              lodgingStay: stay,
            }),
          ],
          []
        ),
      ],
      [],
      resolver,
      NOW
    );
    expect(insights.roadtrips[0].nightsByStyle).toEqual({ pitch: 1, campsite: 2, lodging: 0 });
    expect(insights.roadtrips[0].nights.recorded).toBe(3);
  });

  it("puts the day tours from its stations beside the driving, never into it", () => {
    const tour = (id: string, km: number, ascentM: number | null): TourFacts =>
      ({
        tour: { id, anchorStopId: "b", anchorRoadtripId: "r1" },
        state: "completed",
        km,
        ascentM,
      }) as unknown as TourFacts;
    const { insights } = computeRoadtripInsights(
      [
        trip(
          [
            station("a", { startDate: d("2026-06-01") }),
            station("b", { startDate: d("2026-06-01"), endDate: d("2026-06-04"), overnight: true }),
          ],
          [leg("a", "b", 100)]
        ),
      ],
      [tour("t1", 12, 800), tour("t2", 8, null)],
      resolver,
      NOW
    );
    const r = insights.roadtrips[0];
    expect(r.km.recorded).toBe(100);
    expect(r.tours).toEqual({ completed: 2, km: 20, ascentM: 800 });
  });
});
