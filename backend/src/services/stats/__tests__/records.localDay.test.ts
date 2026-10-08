import { buildTravelRecords, type RecordFlightInput } from "../records";

/**
 * Forgejo #255 — the busiest-day record, the longest-streak run and their dates
 * are read on the DEPARTURE AIRPORT'S calendar, the clock every other "which day
 * was that" figure on this server uses (`departureClockOf`). They used to cut
 * the stored instant at UTC midnight, which splits one Tokyo day in two.
 */
const flight = (over: Partial<RecordFlightInput> = {}): RecordFlightInput => ({
  id: "f1",
  flightNumber: "JL1",
  depIata: "NRT",
  arrIata: "KIX",
  depLat: 35.77,
  depLon: 140.39,
  arrLat: 34.43,
  arrLon: 135.24,
  departureTime: new Date("2026-09-01T23:30:00Z"),
  durationMinutes: 80,
  delayMinutes: null,
  routeDistance: null,
  status: "flown",
  depTimezone: "Asia/Tokyo",
  depTimeSemantics: "UTC",
  ...over,
});

const record = (flights: RecordFlightInput[], id: string) =>
  buildTravelRecords(flights).find((r) => r.id === id);

describe("busiest day — the departure airport's local day (forgejo#255)", () => {
  it("joins two departures either side of UTC midnight that share a Tokyo day", () => {
    // 23:30Z on 1 Sep and 01:30Z on 2 Sep are 08:30 and 10:30 JST on the 2nd.
    const rec = record(
      [
        flight({ id: "a", departureTime: new Date("2026-09-01T23:30:00Z") }),
        flight({ id: "b", departureTime: new Date("2026-09-02T01:30:00Z") }),
      ],
      "busiest-day"
    );
    expect(rec?.value).toBe(2);
    expect(rec?.date).toBe("2026-09-02");
  });

  it("splits two departures on the same UTC day that fall on different local days", () => {
    // 10:00Z is 19:00 JST on the 1st, 16:00Z is 01:00 JST on the 2nd.
    const records = buildTravelRecords([
      flight({ id: "a", departureTime: new Date("2026-09-01T10:00:00Z") }),
      flight({ id: "b", departureTime: new Date("2026-09-01T16:00:00Z") }),
    ]);
    expect(records.find((r) => r.id === "busiest-day")?.value).toBe(1);
    expect(records.find((r) => r.id === "longest-streak")?.value).toBe(2);
  });

  it("reads a western departure on its own clock too", () => {
    // 20:00Z and 01:30Z the next UTC day are 16:00 and 21:30 EDT on 1 Sep.
    const rec = record(
      [
        flight({
          id: "a",
          depIata: "JFK",
          depTimezone: "America/New_York",
          departureTime: new Date("2026-09-01T20:00:00Z"),
        }),
        flight({
          id: "b",
          depIata: "JFK",
          depTimezone: "America/New_York",
          departureTime: new Date("2026-09-02T01:30:00Z"),
        }),
      ],
      "busiest-day"
    );
    expect(rec?.value).toBe(2);
    expect(rec?.date).toBe("2026-09-01");
  });

  it("lists the legs of the local day in departure order", () => {
    const rec = record(
      [
        flight({ id: "b", arrIata: "ITM", departureTime: new Date("2026-09-02T01:30:00Z") }),
        flight({ id: "a", arrIata: "KIX", departureTime: new Date("2026-09-01T23:30:00Z") }),
      ],
      "busiest-day"
    );
    expect(rec?.legs).toEqual(["NRT", "KIX", "ITM"]);
  });

  it("keeps a date-only flight on its recorded date", () => {
    const rec = record(
      [
        flight({
          id: "a",
          departureTime: new Date("2026-09-02T12:00:00Z"),
          depTimeSemantics: "DATE_ONLY",
        }),
        flight({ id: "b", departureTime: new Date("2026-09-01T23:30:00Z") }),
      ],
      "busiest-day"
    );
    expect(rec?.value).toBe(2);
    expect(rec?.date).toBe("2026-09-02");
  });

  it.each([
    ["Auckland (UTC+12)", "AKL", "Pacific/Auckland"],
    ["Suva (UTC+12)", "SUV", "Pacific/Fiji"],
    ["Kiritimati (UTC+14)", "CXI", "Pacific/Kiritimati"],
  ])("keeps a date-only flight from %s on its stored date", (_name, iata, zone) => {
    // A date-only row is stored as 12:00Z of the recorded day. Read through a
    // zone east of UTC+12 that instant is already the NEXT local day.
    const dateOnly = (id: string, day: string) =>
      flight({
        id,
        depIata: iata,
        depTimezone: zone,
        depTimeSemantics: "DATE_ONLY",
        departureTime: new Date(`${day}T12:00:00Z`),
      });
    const rec = record(
      [dateOnly("a", "2026-09-02"), dateOnly("b", "2026-09-02"), dateOnly("c", "2026-09-04")],
      "busiest-day"
    );
    expect(rec?.value).toBe(2);
    expect(rec?.date).toBe("2026-09-02");
  });

  it("falls back to the stored (UTC) date when no zone is on file — as every other stat does", () => {
    const rec = record(
      [
        flight({
          id: "a",
          depTimezone: null,
          departureTime: new Date("2026-09-01T23:30:00Z"),
        }),
        flight({
          id: "b",
          depTimezone: null,
          departureTime: new Date("2026-09-02T01:30:00Z"),
        }),
      ],
      "busiest-day"
    );
    expect(rec?.value).toBe(1);
  });

  it("falls back the same way for a zone this runtime does not know", () => {
    const rec = record(
      [
        flight({
          id: "a",
          depTimezone: "Mars/Olympus",
          departureTime: new Date("2026-09-01T23:30:00Z"),
        }),
        flight({
          id: "b",
          depTimezone: "Mars/Olympus",
          departureTime: new Date("2026-09-02T01:30:00Z"),
        }),
      ],
      "busiest-day"
    );
    expect(rec?.value).toBe(1);
  });
});

describe("longest streak — consecutive LOCAL days (forgejo#255)", () => {
  it("dates a streak by local days", () => {
    // Local days 2, 3, 4 Sep in Tokyo: 23:30Z on 1 Sep is already the 2nd there.
    const rec = record(
      [
        flight({ id: "a", departureTime: new Date("2026-09-01T23:30:00Z") }),
        flight({ id: "b", departureTime: new Date("2026-09-02T23:30:00Z") }),
        flight({ id: "c", departureTime: new Date("2026-09-03T23:30:00Z") }),
      ],
      "longest-streak"
    );
    expect(rec?.value).toBe(3);
    expect(rec?.startDate).toBe("2026-09-02");
    expect(rec?.endDate).toBe("2026-09-04");
  });

  it("does not count two departures on one Tokyo day as a two-day streak", () => {
    // UTC days 1 and 2 look consecutive; locally both are the 2nd.
    const rec = record(
      [
        flight({ id: "a", departureTime: new Date("2026-09-01T23:30:00Z") }),
        flight({ id: "b", departureTime: new Date("2026-09-02T01:30:00Z") }),
      ],
      "longest-streak"
    );
    expect(rec?.value).toBe(1);
  });
});
