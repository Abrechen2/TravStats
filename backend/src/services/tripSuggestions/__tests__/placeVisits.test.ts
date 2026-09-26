import { describe, expect, it } from "@jest/globals";

import { composeSuggestions } from "../compose";
import { placeVisitProposals } from "../placeVisits";
import type { PlaceContext } from "../types";
import { AT, cruise, input, ride, stay, visit } from "./fixtures";

/**
 * "An diesem Tag warst du hier" — an own place the user slept, docked or
 * changed trains beside, on days it has no visit. Proposes, never ticks; only
 * travel that happened is evidence.
 */

const cafe = (over: Partial<PlaceContext> = {}): PlaceContext => ({
  id: "cafe",
  name: "Caffè Gilli",
  // 300 m from the Florence hotel fixture.
  lat: AT.FIRENZE.lat + 0.0027,
  lon: AT.FIRENZE.lon,
  visitDays: [],
  ...over,
});

const florence = (over = {}) => stay("f", AT.FIRENZE, "2025-05-03", "2025-05-06", "Florenz", over);

describe("placeVisitProposals", () => {
  it("offers a visit to an own place beside a stay, once per stay", () => {
    const out = placeVisitProposals([florence()], [cafe()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "place_visit",
      startDay: "2025-05-03",
      place: { id: "cafe" },
      anchor: { key: "lodging:f", domain: "lodging" },
    });
    expect(out[0].distanceM).toBeGreaterThan(250);
    expect(out[0].distanceM).toBeLessThan(350);
  });

  it("asks nothing when the place already has a visit during the stay", () => {
    expect(placeVisitProposals([florence()], [cafe({ visitDays: ["2025-05-05"] })])).toEqual([]);
  });

  it("asks nothing for a place two kilometres away", () => {
    const far = cafe({ lat: AT.FIRENZE.lat + 0.018 });
    expect(placeVisitProposals([florence()], [far])).toEqual([]);
  });

  it("takes no evidence from a stay that has not happened", () => {
    expect(placeVisitProposals([florence({ state: "planned" })], [cafe()])).toEqual([]);
  });

  it("reads cruise ports and stations too, but not a place visit as its own anchor", () => {
    const port = {
      id: "fort",
      name: "Akershus",
      lat: AT.OSLO.lat + 0.002,
      lon: AT.OSLO.lon,
      visitDays: [],
    };
    const station = {
      id: "station-cafe",
      name: "Bar Termini",
      lat: AT.ROMA.lat,
      lon: AT.ROMA.lon + 0.003,
      visitDays: [],
    };
    const entries = [
      cruise("c", [
        { at: AT.KIEL, day: "2025-07-01" },
        { at: AT.OSLO, day: "2025-07-03" },
        { at: AT.KIEL, day: "2025-07-05" },
      ]),
      ride(
        "rail",
        "r",
        AT.FIRENZE,
        AT.ROMA,
        { day: "2025-05-06", hour: 9 },
        { day: "2025-05-06", hour: 11 }
      ),
      visit("v", AT.COLOSSEUM, "2025-05-07"),
    ];
    const out = placeVisitProposals(entries, [
      port,
      station,
      { ...cafe(), id: "c2", lat: AT.COLOSSEUM.lat, lon: AT.COLOSSEUM.lon },
    ]);
    expect(out.map((p) => [p.place?.id, p.startDay]).sort()).toEqual([
      ["fort", "2025-07-03"],
      ["station-cafe", "2025-05-06"],
    ]);
  });

  it("does not come back once answered", () => {
    const [shown] = placeVisitProposals([florence()], [cafe()]);
    const answered = [
      { kind: "place_visit" as const, fingerprint: shown.id, targetId: "cafe", memberKeys: [] },
    ];
    expect(
      composeSuggestions(input({ entries: [florence()], places: [cafe()], answered }))
    ).toEqual([]);
  });
});

describe("composeSuggestions — a large account", () => {
  it("answers 2000 entries and 500 places in well under a second", () => {
    const entries = [];
    for (let week = 0; week < 400; week += 1) {
      const day = (offset: number) =>
        new Date(Date.UTC(2015, 0, 1) + (week * 7 + offset) * 86_400_000)
          .toISOString()
          .slice(0, 10);
      const where = { lat: 38 + (week % 20) * 0.5, lon: -9 + (week % 30) * 0.7 };
      entries.push(
        ride(
          "flight",
          `o${week}`,
          AT.MUC,
          where,
          { day: day(0), hour: 7 },
          { day: day(0), hour: 10 }
        ),
        stay(`s${week}`, where, day(0), day(2), `City ${week % 20}`),
        visit(`v${week}`, where, day(1)),
        stay(
          `t${week}`,
          { lat: where.lat + 0.1, lon: where.lon },
          day(2),
          day(3),
          `City ${week % 20}`
        ),
        ride(
          "flight",
          `r${week}`,
          where,
          AT.MUC,
          { day: day(3), hour: 12 },
          { day: day(3), hour: 15 }
        )
      );
    }
    const places = Array.from({ length: 500 }, (_, i) => ({
      id: `p${i}`,
      name: `Place ${i}`,
      lat: 38 + (i % 20) * 0.5 + 0.001,
      lon: -9 + (i % 30) * 0.7,
      visitDays: [],
    }));

    const started = performance.now();
    const out = composeSuggestions(input({ entries, places }));
    const elapsed = performance.now() - started;

    expect(entries).toHaveLength(2000);
    expect(out.filter((p) => p.kind === "new_trip")).toHaveLength(400);
    expect(elapsed).toBeLessThan(1000);
  });
});
