import { describe, expect, it } from "vitest";

import type { RoadtripStation } from "../../../types/roadtrip";
import type { TourLeg } from "../../../types/tour";
import { dayPlan } from "../dayPlan";

const st = (
  id: string,
  state: RoadtripStation["state"],
  start: string | null,
  end: string | null = null
): RoadtripStation => ({
  id,
  title: id,
  lat: 60,
  lon: 5,
  startDate: start ? `${start}T00:00:00.000Z` : null,
  endDate: end ? `${end}T00:00:00.000Z` : null,
  notes: null,
  order: 0,
  state,
  lodgingStayId: null,
  stay: null,
});
const leg = (
  from: string,
  to: string,
  source: TourLeg["source"],
  km: number,
  minutes: number | null,
  mode: TourLeg["mode"] = "road"
): TourLeg => ({
  id: `${from}-${to}`,
  fromStopId: from,
  toStopId: to,
  distanceKm: km,
  source,
  mode,
  confidence: "high",
  waypoints: null,
  drivingMinutes: minutes,
});

/** forgejo#243: a roadtrip day by day, and nothing invented about the road. */
describe("dayPlan", () => {
  const stations = [
    st("Hamburg", "pass", "2026-07-10"),
    st("Hirtshals", "free", "2026-07-10", "2026-07-11"),
    st("bend", "via", null),
    st("Lysefjord", "pass", null),
    st("Bergen", "free", "2026-07-11", "2026-07-14"),
    st("Flåm", "free", "2026-07-14", "2026-07-15"),
  ];
  const legs = [
    leg("Hamburg", "Hirtshals", "routed", 480, 330),
    leg("Hirtshals", "bend", "straight", 120, null, "ferry"),
    leg("bend", "Lysefjord", "track", 60, null),
    leg("Lysefjord", "Bergen", "routed", 150, 120),
    leg("Bergen", "Flåm", "routed", 160, 150),
  ];
  const days = dayPlan(stations, legs, "2026-07-10T00:00:00.000Z");

  it("bundles start, destination, stops and the night per day", () => {
    expect(days.map((d) => [d.number, d.start?.id ?? null, d.destination.id])).toEqual([
      [1, "Hamburg", "Hirtshals"],
      [2, "Hirtshals", "Bergen"],
      [5, "Bergen", "Flåm"],
    ]);
    // The undated pass-through happens on the way to where its day ends; the
    // route correction is no stop at all.
    expect(days[1].stops.map((s) => s.id)).toEqual(["Lysefjord"]);
    expect(days[1].overnight).toMatchObject({ nights: 3 });
    expect(days[1].stayOnDays).toBe(2);
  });

  it("names where each kilometre comes from, ferry included, legs through a correction counted", () => {
    expect(days[1].legs).toMatchObject({
      totalKm: 330,
      kmBySource: { straight: 120, track: 60, routed: 150 },
      kmByMode: { ferry: 120, road: 210 },
    });
  });

  it("gives a driving time only when every piece of the day carries one", () => {
    expect(days[0].legs?.drivingMinutes).toBe(330);
    expect(days[1].legs?.drivingMinutes).toBeNull();
    expect(days[2].legs?.drivingMinutes).toBe(150);
  });

  // Review M7: a time typed on a leg is not one the router computed.
  it("tells a routed driving time from one typed on a leg", () => {
    expect(days[0].legs?.drivingRouted).toBe(true);
    const typed = dayPlan(
      [st("A", "pass", "2026-07-10"), st("B", "free", "2026-07-10", "2026-07-11")],
      [leg("A", "B", "straight", 50, 45)],
      null
    );
    expect(typed[0].legs).toMatchObject({ drivingMinutes: 45, drivingRouted: false });
  });

  it("says when a stretch has no stored leg, instead of a shorter distance as if complete", () => {
    const partial = dayPlan(stations, legs.slice(0, 4), null);
    expect(partial[2].legs).toMatchObject({ missingLeg: true, drivingMinutes: null, totalKm: 0 });
    expect(partial[2].number).toBeNull();
  });

  it("leaves the number of nights open when the departure is not known", () => {
    const open = dayPlan([st("A", "pass", "2026-07-10"), st("B", "free", "2026-07-10")], [], null);
    expect(open[0].overnight).toMatchObject({ nights: null });
  });

  it("puts stations no date places into a group of their own", () => {
    const undated = dayPlan([st("A", "pass", null), st("B", "free", null)], [], null);
    expect(undated).toHaveLength(1);
    expect(undated[0]).toMatchObject({ day: null, start: { id: "A" }, destination: { id: "B" } });
  });
});
