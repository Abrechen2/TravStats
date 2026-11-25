import { describe, it, expect } from "vitest";
import { buildRoute, draftLegs, type RouteDraft } from "../routeDraft";
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
