/**
 * forgejo#311 — one synthetic export per tracker, read into the rows the
 * preview expects. The fixtures carry no real person's data; their layouts
 * follow the sources cited at the top of each parser.
 */
import fs from "fs";
import path from "path";
import { parseOpenFlights } from "../openflights";
import { parseJetlog } from "../jetlog";
import { parseFlighty } from "../flighty";
import { parseAppInTheAir } from "../appInTheAir";
import { parseAirTrail } from "../airtrail";

const FIXTURES = path.join(__dirname, "../../../../__tests__/fixtures/trackers");
const fixture = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf-8");

describe("OpenFlights CSV", () => {
  const result = parseOpenFlights(fixture("openflights.csv"));

  it("reads every flight", () => {
    expect(result.parserErrors).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({
      date: "2023-05-04",
      depTimeLocal: "07:15:00",
      durationSeconds: 6000,
      fromIata: "FRA",
      toIata: "LHR",
      flightNumber: "LH900",
      airline: "Lufthansa",
      aircraft: "Airbus A320",
      registration: "D-AIZA",
      seatNumber: "12A",
      seatClass: "economy",
      category: "vacation",
      notes: "Synthetic, row one",
      source: "openflights",
      sourceRowIndex: 0,
    });
    expect(result.rows[1]).toMatchObject({
      date: "2023-05-11",
      fromIata: "EGLL",
      toIata: "EDDF",
      seatClass: "business",
      category: "business",
      sourceRowIndex: 1,
    });
    expect(result.rows[1].depTimeLocal).toBeUndefined();
    expect(result.rows[1].notes).toBeUndefined();
  });

  it("keeps a flight known only by its year, marked as such", () => {
    expect(result.rows[2]).toEqual({
      date: "2019-01-01",
      datePrecision: "year",
      fromIata: "JFK",
      toIata: "LAX",
      source: "openflights",
      sourceRowIndex: 2,
    });
  });

  it("accepts the US and European date spellings the format allows", () => {
    const csv =
      "Date,From,To,Flight_Number\n05/04/2023,FRA,LHR,LH1\n04.05.2023,FRA,LHR,LH2\n31.02.2023,FRA,LHR,LH3\n";
    const r = parseOpenFlights(csv);
    expect(r.rows.map((x) => x.date)).toEqual(["2023-05-04", "2023-05-04"]);
    expect(r.parserErrors).toEqual([
      expect.objectContaining({ rowIndex: 2, code: "invalidDate", value: "31.02.2023" }),
    ]);
  });

  it("names the missing column of a file that is not complete", () => {
    const r = parseOpenFlights("Date,From,Flight_Number\n2023-05-04,FRA,LH1\n");
    expect(r.rows).toEqual([]);
    expect(r.parserErrors).toEqual([
      expect.objectContaining({ rowIndex: -1, code: "missingHeader", value: "To" }),
    ]);
  });
});

describe("Jetlog CSV", () => {
  const result = parseJetlog(fixture("jetlog.csv"));

  it("reads all three flights, ICAO codes included", () => {
    expect(result.parserErrors).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({
      date: "2023-08-01",
      depTimeLocal: "10:05:00",
      arrTimeLocal: "12:50:00",
      durationSeconds: 525 * 60,
      fromIata: "EDDF",
      toIata: "KJFK",
      flightNumber: "LH400",
      airline: "Lufthansa",
      aircraft: "Boeing 747-8",
      registration: "D-ABYA",
      seatClass: "business",
      category: "business",
      notes: "Synthetic first line\nsecond line",
      source: "jetlog",
      sourceRowIndex: 0,
    });
  });

  it("keeps the arrival day and an airline the catalogue does not know", () => {
    expect(result.rows[1]).toMatchObject({
      arrDate: "2023-08-21",
      arrTimeLocal: "15:30:00",
      seatClass: "premium_economy",
      category: "vacation",
      airline: "ZZQ",
      flightNumber: "ZZ7",
    });
  });

  it("imports a flight that has nothing but a day and a route", () => {
    expect(result.rows[2]).toEqual({
      date: "2023-08-21",
      fromIata: "EGLL",
      toIata: "EDDF",
      source: "jetlog",
      sourceRowIndex: 2,
    });
  });

  it("names a time it cannot read", () => {
    const r = parseJetlog("date,origin,destination,departure_time\n2023-08-01,EDDF,KJFK,25:00\n");
    expect(r.parserErrors).toEqual([
      expect.objectContaining({ rowIndex: 0, code: "invalidTime", value: "25:00" }),
    ]);
  });
});

describe("Flighty CSV", () => {
  const result = parseFlighty(fixture("flighty.csv"));

  it("reads the actual gate times, the PNR and the cabin", () => {
    expect(result.rows[0]).toEqual({
      date: "2024-03-02",
      depTimeLocal: "10:12:00",
      arrDate: "2024-03-02",
      arrTimeLocal: "12:58:00",
      fromIata: "FRA",
      toIata: "JFK",
      flightNumber: "LH400",
      airline: "Lufthansa",
      aircraft: "Boeing 747-8",
      registration: "D-ABYA",
      seatNumber: "81K",
      seatClass: "premium_economy",
      category: "vacation",
      bookingReference: "SYN123",
      notes: "Synthetic note",
      source: "flighty",
      sourceRowIndex: 0,
    });
  });

  it("keeps a flight whose airline code the catalogue does not know", () => {
    expect(result.rows[1]).toMatchObject({
      airline: "XQZ",
      flightNumber: "XQZ77",
      depTimeLocal: "21:50:00",
      arrDate: "2024-03-06",
      arrTimeLocal: "16:05:00",
      seatClass: "economy",
      category: "business",
    });
  });

  it("skips a cancelled flight and says so", () => {
    expect(result.rows.map((r) => r.sourceRowIndex)).toEqual([0, 1, 3]);
    expect(result.parserErrors).toEqual([
      expect.objectContaining({ rowIndex: 2, code: "cancelled" }),
    ]);
  });

  it("records a diverted flight where it actually landed", () => {
    const diverted = result.rows[2];
    expect(diverted.toIata).toBe("MUC");
    expect(diverted.notes).toContain("LHR");
  });
});

describe("App in the Air export", () => {
  const text = fixture("app-in-the-air.txt");
  const result = parseAppInTheAir(text);
  const lineOf = (needle: string): number =>
    text.split(/\r?\n/).findIndex((l) => l.startsWith(needle)) + 1;

  it("reads the travel and the local clocks of each own flight", () => {
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      date: "2023-02-10",
      depTimeLocal: "10:00:00",
      arrDate: "2023-02-10",
      arrTimeLocal: "12:20:00",
      durationSeconds: 8 * 3600 + 20 * 60,
      fromIata: "FRA",
      toIata: "JFK",
      flightNumber: "LH400",
      airline: "Lufthansa",
      aircraft: "744",
      seatNumber: "4A",
      seatClass: "business",
      bookingReference: "SYN789",
      source: "app_in_the_air",
      sourceRowIndex: 0,
    });
    expect(result.rows[1]).toMatchObject({
      flightNumber: "ZQ77",
      seatClass: "economy",
      durationSeconds: 11 * 3600,
      arrDate: "2023-03-02",
      arrTimeLocal: "16:00:00",
    });
    expect(result.rows[1].seatNumber).toBeUndefined();
  });

  it("names the line it could not read and the flight that was someone else's", () => {
    expect(result.parserErrors).toEqual([
      expect.objectContaining({ code: "malformedEntry", line: lineOf("this;line;is;broken") }),
      expect.objectContaining({
        code: "notOwnFlight",
        line: lineOf("None;None;None;None;None;None;search;LH;100"),
      }),
    ]);
  });
});

describe("AirTrail JSON export", () => {
  const result = parseAirTrail(fixture("airtrail.json"));

  it("turns the stored instants back into the wall clocks at each airport", () => {
    expect(result.rows[0]).toEqual({
      date: "2024-06-01",
      depTimeLocal: "21:30:00",
      arrDate: "2024-06-02",
      arrTimeLocal: "15:10:00",
      durationSeconds: 42000,
      fromIata: "FRA",
      toIata: "HKG",
      flightNumber: "LH796",
      airline: "Lufthansa",
      aircraft: "Airbus A350-900",
      registration: "D-AIXA",
      seatNumber: "31A",
      seatClass: "premium_economy",
      category: "vacation",
      notes: "Synthetic AirTrail flight",
      source: "airtrail",
      sourceRowIndex: 0,
    });
  });

  it("keeps a flight with a bare code or an airport without IATA", () => {
    expect(result.rows[1]).toEqual({
      date: "2024-07-01",
      fromIata: "LIRF",
      toIata: "LIMC",
      seatClass: "business",
      category: "business",
      source: "airtrail",
      sourceRowIndex: 1,
    });
  });

  it("keeps a year-only flight with its precision", () => {
    expect(result.rows[2]).toEqual({
      date: "2019-01-01",
      datePrecision: "year",
      fromIata: "EDDF",
      toIata: "EGLL",
      source: "airtrail",
      sourceRowIndex: 2,
    });
  });

  it("names the entry it cannot read", () => {
    expect(result.rows).toHaveLength(3);
    expect(result.parserErrors).toEqual([
      expect.objectContaining({ code: "malformedEntry", entry: 4 }),
    ]);
  });

  it("says a broken JSON file is broken instead of reading nothing", () => {
    const r = parseAirTrail('{"flights": [');
    expect(r.rows).toEqual([]);
    expect(r.parserErrors).toEqual([
      expect.objectContaining({ rowIndex: -1, code: "invalidJson" }),
    ]);
  });
});
