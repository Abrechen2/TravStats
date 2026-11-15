import fs from "fs";
import path from "path";
import { TooManyRecordsError } from "../../checkinImport/types";
import { parseFlightLogCsv, dayOf, clockOf, iataIn } from "../csvFlightLog";
import { parsePolarsteps } from "../polarsteps";
import { parseTripit } from "../tripit";

/** Every fixture is SYNTHETIC — see the header of each reader. */
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("flight-log CSV readers (JetLovers, FlightMemory, Logmyflight)", () => {
  it("reads a JetLovers file and says why each unusable line is refused", () => {
    const out = parseFlightLogCsv("jetlovers", fixture("jetlovers.csv"));
    expect(out.flights.map((f) => f.flightNumber)).toEqual(["LH400", "NH6", "LH401", undefined]);
    expect(out.flights[0]).toMatchObject({
      row: 2,
      airline: "Lufthansa",
      depIata: "FRA",
      arrIata: "JFK",
      depLocal: "2026-03-01T10:05",
      arrLocal: "2026-03-01T12:20",
      registration: "D-ABYA",
      seat: "12A",
      seatClass: "business",
      category: "business",
    });
    expect(out.flights[1]).toMatchObject({ seatClass: "economy", category: "vacation" });
    // The arrival's DATE is not in the file: it is only a guess for the zones to move.
    expect(out.flights[2].arrDayGuessed).toBe(true);
    // A flight without a flight number is still a record here; the build step names it.
    expect(out.flights[3]).toMatchObject({ row: 5, depIata: "FRA" });
    expect(out.rejects.map((r) => [r.row, r.reason])).toEqual([
      [6, "missing_airport_code"], // "Lisboa" carries no IATA code
      [7, "invalid_date"],
    ]);
  });

  it("reads FlightMemory: semicolons, German headers, day-first dates, codes inside names", () => {
    const out = parseFlightLogCsv("flightmemory", fixture("flightmemory.csv"));
    expect(out.rejects).toEqual([]);
    expect(out.flights[0]).toMatchObject({
      flightNumber: "LH400",
      depIata: "FRA",
      arrIata: "JFK",
      depLocal: "2026-03-01T10:05",
      seatClass: "business",
      category: "business",
    });
    // FRA/EDDF -> FRA; no clock -> a day only
    expect(out.flights[1]).toMatchObject({ depIata: "FRA", dateOnly: "2026-03-04" });
    expect(out.flights[1].depLocal).toBeUndefined();
  });

  it("reads Logmyflight: month-first dates and AM/PM clocks", () => {
    const out = parseFlightLogCsv("logmyflight", fixture("logmyflight.csv"));
    expect(out.flights[0]).toMatchObject({
      flightNumber: "LH400",
      depLocal: "2026-03-01T10:05",
      arrLocal: "2026-03-01T12:20",
    });
    expect(out.flights[1]).toMatchObject({
      depLocal: "2026-03-22T18:30",
      arrLocal: "2026-03-22T07:45",
    });
  });

  it("refuses a file with none of the key columns instead of importing nothing silently", () => {
    const out = parseFlightLogCsv("jetlovers", fixture("no-key-columns.csv"));
    expect(out.flights).toEqual([]);
    expect(out.rejects).toEqual([
      { sheet: "flights", row: 1, label: "#1", reason: "invalid_file" },
    ]);
  });

  it("refuses an unreadable clock rather than treating the flight as untimed", () => {
    const out = parseFlightLogCsv(
      "jetlovers",
      "Date,From,To,Dep. Time\n2026-03-01,FRA,JFK,25:99\n"
    );
    expect(out.flights).toEqual([]);
    expect(out.rejects[0].reason).toBe("invalid_date");
  });

  it("refuses a file over the record cap before anything else", () => {
    const lines = ["Date,Flight,From,To"];
    for (let i = 0; i < 5001; i++) lines.push("2026-03-01,LH1,FRA,JFK");
    expect(() => parseFlightLogCsv("jetlovers", lines.join("\n"))).toThrow(TooManyRecordsError);
  });

  it("helpers read the odd cells", () => {
    expect(dayOf("03/04/2026", "mdy")).toBe("2026-03-04");
    expect(dayOf("03/04/2026", "dmy")).toBe("2026-04-03");
    expect(dayOf("13/04/2026", "mdy")).toBe("2026-04-13"); // only a day can be 13
    expect(dayOf("31.02.2026", "dmy")).toBeNull();
    expect(clockOf("12:05 AM")).toBe("00:05");
    expect(clockOf("7:45")).toBe("07:45");
    expect(clockOf("noon")).toBeNull();
    expect(iataIn("EDDF (FRA)")).toBe("FRA");
    expect(iataIn("Lisboa")).toBeUndefined();
  });
});

describe("TripIt", () => {
  it("reads flights, a stay, a rail segment and names what it does not import", () => {
    const out = parseTripit(fixture("tripit.json"));
    expect(out.flights).toHaveLength(1);
    expect(out.flights[0]).toMatchObject({
      airline: "Lufthansa",
      flightNumber: "LH400",
      depIata: "FRA",
      arrIata: "JFK",
      depLocal: "2026-03-01T10:05",
      arrLocal: "2026-03-01T12:20",
      seat: "12A",
      bookingReference: "ABC123",
    });
    expect(out.lodging[0].cells).toMatchObject({
      name: "Synthetic Grand Hotel",
      city: "New York",
      lat: "40.75",
    });
    expect(out.lodgingStays[0].cells).toEqual({
      lodgingId: "Synthetic Grand Hotel",
      checkIn: "2026-03-01",
      checkOut: "2026-03-05",
    });
    expect(out.rides[0]).toMatchObject({
      mode: "rail",
      trainNumber: "5",
      dep: { name: "Alpha Hbf", time: { wall: "2026-03-06T08:00" } },
    });
    expect(out.rejects.map((r) => r.reason).sort()).toEqual([
      "invalid_record",
      "unsupported_object:car",
    ]);
  });

  it("reads an iCal feed: flights with instants, stays, and says no to the rest", () => {
    const out = parseTripit(fixture("tripit.ics"));
    expect(out.flights).toHaveLength(1);
    expect(out.flights[0]).toMatchObject({ flightNumber: "LH400", depIata: "FRA", arrIata: "JFK" });
    expect(out.flights[0].depInstant?.toISOString()).toBe("2026-03-01T09:05:00.000Z");
    expect(out.lodgingStays[0].cells).toMatchObject({
      checkIn: "2026-03-01",
      checkOut: "2026-03-05",
    });
    expect(out.rejects.map((r) => r.reason).sort()).toEqual([
      "missing_airport_code",
      "unsupported_event",
    ]);
  });

  it("refuses text that is neither a TripIt document nor an iCal feed", () => {
    for (const bad of ["not json at all", "{}", '{"foo": 1}', "BEGIN:VCARD"]) {
      expect(parseTripit(bad).rejects[0]?.reason).toBe("invalid_file");
    }
  });
});

describe("Polarsteps", () => {
  it("turns steps into places with visits at the step's local clock", () => {
    const out = parsePolarsteps(fixture("polarsteps.json"));
    // two steps share one place -> one place, two visits
    expect(out.places).toHaveLength(1);
    expect(out.places[0].cells).toMatchObject({
      name: "Praça do Comércio",
      lat: "38.7078",
      country: "PT",
      visited: "true",
    });
    expect(out.placeVisits.map((v) => v.cells.visitedAt)).toEqual([
      "2026-03-09T13:00:00.000Z",
      "2026-03-10T13:00:00.000Z",
    ]);
    expect(out.rejects.map((r) => r.reason)).toEqual(["missing_coordinates", "invalid_record"]);
  });

  it("reads one trip per Polarsteps trip with its local days, from the steps when the dates are absent", () => {
    const out = parsePolarsteps(fixture("polarsteps.json"));
    expect(out.trips).toEqual([
      expect.objectContaining({
        name: "Synthetic Portugal",
        startDay: "2026-03-09",
        endDay: "2026-03-12",
      }),
    ]);
    const noDates = parsePolarsteps(
      JSON.stringify([
        {
          name: "B",
          all_steps: [{ name: "x", start_time: 1773061200, location: { lat: 1, lon: 2 } }],
        },
        { all_steps: [] },
      ])
    );
    expect(noDates.trips[0]).toMatchObject({
      name: "B",
      startDay: "2026-03-09",
      endDay: "2026-03-09",
    });
    expect(noDates.rejects.map((r) => [r.sheet, r.reason])).toContainEqual([
      "trips",
      "missing_name",
    ]);
  });

  it("takes a trip's days from each end step's own zone, so the last local day is not lost", () => {
    // 2026-03-10T20:00Z is already 03-11 in Tokyo; the first step is 03-09 in Lisbon.
    const out = parsePolarsteps(
      JSON.stringify({
        name: "Across zones",
        all_steps: [
          {
            name: "a",
            start_time: 1773061200,
            timezone_id: "Europe/Lisbon",
            location: { lat: 38.7, lon: -9.1 },
          },
          {
            name: "b",
            start_time: 1773172800,
            timezone_id: "Asia/Tokyo",
            location: { lat: 35.6, lon: 139.7 },
          },
        ],
      })
    );
    expect(out.trips[0]).toMatchObject({ startDay: "2026-03-09", endDay: "2026-03-11" });
  });

  it("refuses JSON that is not a trip, and text that is not JSON", () => {
    expect(parsePolarsteps(fixture("polarsteps-malformed.json")).rejects[0].reason).toBe(
      "invalid_file"
    );
    expect(parsePolarsteps("{{").rejects[0].reason).toBe("invalid_file");
  });
});

describe("review findings (Codex, forgejo#401)", () => {
  it("TripIt: every document of a list is read, not only the first", () => {
    const one = (n: string) => ({
      AirObject: {
        Segment: { start_airport_code: "FRA", end_airport_code: "JFK", marketing_flight_number: n },
      },
    });
    const out = parseTripit(JSON.stringify([one("1"), one("2")]));
    expect(out.flights.map((f) => f.flightNumber)).toEqual(["1", "2"]);
  });

  it("TripIt iCal: a TZID fixes the instant; an unknown TZID is refused, not read in the airport's zone", () => {
    const ics = (tz: string) =>
      `BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Flight (LH 400)\nLOCATION:Frankfurt (FRA) to New York (JFK)\nDTSTART;TZID=${tz}:20260301T100500\nEND:VEVENT\nEND:VCALENDAR`;
    expect(parseTripit(ics("Europe/Berlin")).flights[0].depInstant?.toISOString()).toBe(
      "2026-03-01T09:05:00.000Z"
    );
    const bad = parseTripit(ics("Mars/Olympus"));
    expect(bad.flights).toEqual([]);
    expect(bad.rejects[0].reason).toBe("invalid_date");
  });

  it("CSV: AM/PM survives in a combined datetime; an impossible arrival date is refused", () => {
    const ok = parseFlightLogCsv("jetlovers", "From,To,Departure\nFRA,JFK,2026-03-04 8:05 PM\n");
    expect(ok.flights[0].depLocal).toBe("2026-03-04T20:05");
    const bad = parseFlightLogCsv(
      "jetlovers",
      "From,To,Departure,Arrival\nFRA,JFK,2026-03-04T18:00,2026-02-30T20:00\n"
    );
    expect(bad.flights).toEqual([]);
    expect(bad.rejects[0].reason).toBe("invalid_date");
  });
});
