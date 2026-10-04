import { railListSummary, rentalListSummary } from "../listSummary";

/**
 * The strip figures over the whole filtered rail and rental lists. The cases
 * moved here from the browser's tests when the counting moved to the server
 * (the lists are paged; the browser only ever held one page).
 */
const leg = (operator: string | null, dep: string | null, arr: string | null) => ({
  operator,
  depStationName: dep,
  arrStationName: arr,
});

describe("railListSummary", () => {
  it("counts trains, recorded operators and the stations at both ends", () => {
    expect(
      railListSummary([
        leg("DB Fernverkehr", "Köln Hbf", "Augsburg Hbf"),
        leg("ÖBB", "Wien Hbf", "Zürich HB"),
        leg("DB Fernverkehr", "Augsburg Hbf", "Köln Hbf"),
      ])
    ).toEqual({ journeys: 3, operators: 2, withoutOperator: 0, stations: 4 });
  });

  it("treats the same operator or station written differently as one", () => {
    const s = railListSummary([
      leg("DB Fernverkehr", "Köln Hbf", "Bonn Hbf"),
      leg(" db fernverkehr ", "köln hbf", "BONN HBF"),
    ]);
    expect(s.operators).toBe(1);
    expect(s.stations).toBe(2);
  });

  it("names trains without an operator instead of guessing one", () => {
    const s = railListSummary([leg(null, "A", "B"), leg("  ", "B", "C"), leg("SNCF", "C", "D")]);
    expect(s).toMatchObject({ operators: 1, withoutOperator: 2 });
  });

  it("adds no empty-string station for a missing end, and copes with nothing", () => {
    expect(railListSummary([leg("X", null, "B")]).stations).toBe(1);
    expect(railListSummary([])).toEqual({
      journeys: 0,
      operators: 0,
      withoutOperator: 0,
      stations: 0,
    });
  });
});

describe("rentalListSummary", () => {
  const at = (iso: string) => new Date(iso);
  const rental = (provider: string, status: string, from: string, to: string) => ({
    provider,
    status,
    pickupTime: at(from),
    returnTime: at(to),
    pickupTimezone: "Europe/Berlin",
    returnTimezone: "Europe/Berlin",
  });

  it("counts rentals, days on the station's calendar and providers ignoring case", () => {
    expect(
      rentalListSummary([
        rental("Sixt", "completed", "2026-05-01T08:00:00Z", "2026-05-04T08:00:00Z"),
        rental("sixt", "completed", "2026-06-01T08:00:00Z", "2026-06-02T08:00:00Z"),
        rental("Avis", "planned", "2026-07-01T08:00:00Z", "2026-07-06T08:00:00Z"),
      ])
    ).toEqual({ rentals: 3, days: 9, providers: 2 });
  });

  it("does not count a cancelled booking's span as rental days", () => {
    const s = rentalListSummary([
      rental("Sixt", "cancelled", "2026-05-01T08:00:00Z", "2026-05-10T08:00:00Z"),
      rental("Avis", "completed", "2026-06-01T08:00:00Z", "2026-06-02T08:00:00Z"),
    ]);
    expect(s).toEqual({ rentals: 2, days: 1, providers: 2 });
  });
});
