import { describe, it, expect } from "vitest";
import { buildRoute, draftLegs, goalNights, nightsProblem, type RouteDraft } from "../routeDraft";
import { place } from "../../route/__tests__/routeFixture";

const home = place("Kassel", 51.3, 9.5),
  genova = place("Genova", 44.4, 8.9),
  palermo = place("Palermo", 38.1, 13.4);
const sicily: RouteDraft = {
  start: home,
  stops: [
    { place: genova, mode: "drive" },
    { place: palermo, mode: "ferry" },
  ],
  back: true,
};

describe("route draft", () => {
  it("retraces the way out on the way back, mode for mode", () => {
    expect(draftLegs(sicily).map((l) => `${l.from.name}>${l.mode}>${l.to.name}`)).toEqual([
      "Kassel>drive>Genova",
      "Genova>ferry>Palermo",
      "Palermo>ferry>Genova",
      "Genova>drive>Kassel",
    ]);
  });

  it("ties a placeholder to every ferry stage and gives the goal the trip's nights", () => {
    const built = buildRoute(sicily, { nights: 14, currency: "EUR", estimates: { 1: 320 } });
    expect(built.stations.map((s) => [s.title, s.nights])).toEqual([
      ["Kassel", 0],
      ["Genova", 0],
      ["Palermo", 14],
      ["Genova", 0],
      ["Kassel", 0],
    ]);
    expect(built.stages.map((g) => g.mode)).toEqual(["drive", "ferry", "ferry", "drive"]);
    expect(built.bookings).toHaveLength(2);
    const [out, home2] = built.bookings;
    expect(out).toMatchObject({
      kind: "ferry",
      title: "Genova → Palermo",
      placeholder: true,
      stageId: built.stages[1].id,
      estimate: { amount: 320, currency: "EUR" },
    });
    expect(home2).toMatchObject({ title: "Palermo → Genova", estimate: null });
    expect(built.stages[1].bookingId).toBe(out.id);
    expect(built.stages[0].bookingId).toBeNull();
    // Consecutive stages join consecutive stations.
    built.stages.forEach((g, i) => {
      expect(g.fromStationId).toBe(built.stations[i].id);
      expect(g.toStationId).toBe(built.stations[i + 1].id);
    });
  });

  it("without a way back the goal is the last station", () => {
    const built = buildRoute(
      { ...sicily, back: false },
      { nights: 3, currency: "EUR", estimates: {} }
    );
    expect(built.stations[built.stations.length - 1]).toMatchObject({
      title: "Palermo",
      nights: 3,
    });
    expect(built.stages).toHaveLength(2);
  });
});

describe("nights on the way and overnight crossings", () => {
  const roundTrip: RouteDraft = {
    start: home,
    stops: [
      { place: genova, mode: "drive", nights: 1 },
      { place: palermo, mode: "ferry", overnight: true },
    ],
    back: true,
  };

  it("gives each stop on the way its nights, the goal the rest, minus the nights on board", () => {
    const built = buildRoute(roundTrip, { nights: 14, currency: "EUR", estimates: {} });
    // 14 = 1 in Genova + 2 on board (out and back) + 11 in Palermo; the way back stops nowhere.
    expect(built.stations.map((s) => [s.title, s.nights])).toEqual([
      ["Kassel", 0],
      ["Genova", 1],
      ["Palermo", 11],
      ["Genova", 0],
      ["Kassel", 0],
    ]);
    expect(built.stages.map((g) => g.overnight)).toEqual([false, true, true, false]);
  });

  it("never gives the goal fewer than zero nights", () => {
    expect(goalNights(roundTrip, 2)).toBe(0);
  });
});

describe("nightsProblem", () => {
  const trip = (genovaNights: number): RouteDraft => ({
    start: home,
    stops: [
      { place: genova, mode: "drive", nights: genovaNights },
      { place: palermo, mode: "ferry", overnight: true },
    ],
    back: true,
  });
  it("refuses stops and nights on board that need more nights than the trip has", () => {
    expect(nightsProblem(trip(3), 4)).toBe("tooMany");
    expect(nightsProblem(trip(2), 4)).toBeNull();
  });
  it("refuses a goal that would hold more nights than one station may", () => {
    expect(nightsProblem(trip(0), 63)).toBe("goalTooLong");
    expect(nightsProblem(trip(0), 62)).toBeNull();
  });
});
