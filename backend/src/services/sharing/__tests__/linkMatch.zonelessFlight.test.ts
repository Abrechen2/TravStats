/**
 * Sharing UAT 2 (2026-11-27, RC): on the owner's "Florida 2009" two numbered flights carry no
 * departure zone (LH428 MUC → CLT, UA906 ORD → MUC — old imports). Identical copies of them were
 * listed as "only here" AND "only there" in the dry run and stayed unlinked after the link,
 * because the matcher needs a zone to compute the local departure day and gave up without one.
 */
import { planLink, type LinkRow } from "../linkMatch";
import { sameFlight } from "../ownFlightMatch";

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
        flightNumber: "LH428",
        depIata: "MUC",
        depIcao: null,
        arrIata: "CLT",
        arrIcao: null,
        depTimezone: null,
        departureTime: new Date("2009-04-06T09:40:00.000Z"),
        ...facts,
      },
    },
  };
}

describe("linking numbered flights without a departure zone", () => {
  it("pairs the same flight when neither side knows the departure zone", () => {
    const plan = planLink([flight("here", {})], [flight("there", {})]);
    expect(plan.pairs.map((p) => [p.here.id, p.there.id])).toEqual([["here", "there"]]);
    expect(plan.onlyHere).toEqual([]);
    expect(plan.onlyThere).toEqual([]);
  });

  it("still tells two zoneless flights of one number on different days apart", () => {
    const plan = planLink(
      [flight("here", {})],
      [flight("there", { departureTime: new Date("2009-04-07T09:40:00.000Z") })]
    );
    expect(plan.pairs).toEqual([]);
  });

  it("pairs a zoneless departure with the same instant (the copy path's identity)", () => {
    const base = {
      flightNumber: "UA906",
      depIata: "ORD",
      depIcao: null,
      arrIata: "MUC",
      arrIcao: null,
      depTimezone: null,
    };
    const at = new Date("2009-04-15T23:01:00.000Z");
    expect(sameFlight({ ...base, departureTime: at }, { ...base, departureTime: at })).toBe(true);
  });
});
