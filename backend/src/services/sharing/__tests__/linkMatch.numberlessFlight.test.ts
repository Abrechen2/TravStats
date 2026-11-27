/**
 * UAT 2026-11-27 (RC ↔ Beta): two helicopter rounds on the owner's Hawaii trip — no flight number,
 * LIH → LIH, departure to the minute the same on both sides — were listed as "only here" AND
 * "only there", because the link matcher required a flight number. The owner's account holds 11
 * such flights (sightseeing, charter, glider).
 */
import { planLink, type LinkRow } from "../linkMatch";

function flight(id: string, facts: Record<string, unknown>): LinkRow {
  return {
    entity: "flight",
    row: {
      id,
      userId: "u",
      tripId: "t",
      shareKey: null,
      label: id,
      zones: {},
      facts: {
        flightNumber: null,
        depIata: "LIH",
        depIcao: null,
        arrIata: "LIH",
        arrIcao: null,
        depTimezone: "Pacific/Honolulu",
        departureTime: new Date("2013-03-28T20:15:00.000Z"),
        ...facts,
      },
    },
  };
}

describe("linking flights without a flight number", () => {
  it("pairs the same numberless flight: same route, same departure instant", () => {
    const plan = planLink([flight("here", {})], [flight("there", {})]);
    expect(plan.pairs.map((p) => [p.here.id, p.there.id])).toEqual([["here", "there"]]);
    expect(plan.onlyHere).toEqual([]);
    expect(plan.onlyThere).toEqual([]);
  });

  it("does not pair numberless flights that leave at different times the same day", () => {
    const plan = planLink(
      [flight("here", {})],
      [flight("there", { departureTime: new Date("2013-03-28T23:15:00.000Z") })]
    );
    expect(plan.pairs).toEqual([]);
  });

  it("does not pair a numberless flight with a numbered one", () => {
    const plan = planLink([flight("here", {})], [flight("there", { flightNumber: "HA124" })]);
    expect(plan.pairs).toEqual([]);
  });
});
