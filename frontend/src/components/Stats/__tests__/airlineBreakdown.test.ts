import { describe, it, expect } from "vitest";
import type { Flight } from "../../../types";
import type { AirlineResolvers } from "../../../shared/airlineNormalize";
import { buildAirlineBreakdown } from "../airlineBreakdown";

/**
 * The tile's airline count and the `airlineCount` evidence resolver must
 * agree, because the panel compares them and says "this figure has since
 * been recomputed" when they differ. The resolver folds by
 * `airlineGroupKey`; the page folded into a record keyed by the group's
 * LABEL, so two carriers whose catalogue names coincide became one row on
 * screen and stayed two on the server — a recomputation notice with nothing
 * recomputed, and one carrier missing from the list.
 */
const resolvers: AirlineResolvers = {
  // Both codes resolve to the SAME display name. Contrived, but this is
  // exactly the shape a regional subsidiary carrying its parent's catalogue
  // name has.
  nameForIata: (iata) => (iata === "LH" || iata === "CL" ? "Lufthansa" : null),
  iataForName: () => null,
  iataForIcao: () => null,
};

function flight(id: string, airlineIata: string): Flight {
  return {
    id,
    airline: null,
    airlineIata,
    airlineIcao: null,
    durationMinutes: 60,
  } as unknown as Flight;
}

describe("buildAirlineBreakdown", () => {
  it("keeps two carriers that share a display name apart", () => {
    const rows = buildAirlineBreakdown(
      [flight("f1", "LH"), flight("f2", "LH"), flight("f3", "CL")],
      resolvers,
      () => 1
    );

    // Two groups, both labelled "Lufthansa" — keyed by their codes, which is
    // what `airlineGroupKey` (and therefore the server) considers distinct.
    expect(Object.keys(rows).sort()).toEqual(["iata:CL", "iata:LH"]);
    expect(Object.keys(rows)).toHaveLength(2);
    expect(rows["iata:LH"].label).toBe("Lufthansa");
    expect(rows["iata:CL"].label).toBe("Lufthansa");
    expect(rows["iata:LH"].count).toBe(2);
    expect(rows["iata:CL"].count).toBe(1);
  });

  it("sums the caller's own duration rule per group, and keeps the member rows", () => {
    const rows = buildAirlineBreakdown(
      [flight("f1", "LH"), flight("f2", "LH")],
      resolvers,
      () => 1.5
    );
    expect(rows["iata:LH"].totalDuration).toBe(3);
    expect(rows["iata:LH"].flights.map((f) => f.id)).toEqual(["f1", "f2"]);
  });

  it("leaves a flight with no airline identity out of every group", () => {
    const rows = buildAirlineBreakdown(
      [flight("f1", "LH"), { id: "f2" } as unknown as Flight],
      resolvers,
      () => 1
    );
    expect(Object.keys(rows)).toEqual(["iata:LH"]);
    expect(rows["iata:LH"].flights.map((f) => f.id)).toEqual(["f1"]);
  });
});
