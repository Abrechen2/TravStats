import { describe, it, expect } from "vitest";
import { parseGenericCsv, type GenericMapping } from "./genericCsv";

const CSV = `My Date,FlightNum,Origin,Dest,Departure,Arrival,Notes
2024-01-15,LH400,FRA,JFK,10:30:00,13:25:00,test
2024-02-10,SQ938,SIN,NRT,23:55:00,07:55:00,red-eye
`;

describe("parseGenericCsv", () => {
  it("maps user columns to TravStats fields", () => {
    const mapping: GenericMapping = {
      date: "My Date",
      depTimeLocal: "Departure",
      arrTimeLocal: "Arrival",
      fromIata: "Origin",
      toIata: "Dest",
      flightNumber: "FlightNum",
      notes: "Notes",
    };
    const r = parseGenericCsv(CSV, mapping);
    expect(r.parserErrors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].fromIata).toBe("FRA");
    expect(r.rows[1].notes).toBe("red-eye");
  });

  it("rejects mapping that omits required fields (date, fromIata, toIata)", () => {
    const mapping: GenericMapping = {
      // date missing
      fromIata: "Origin",
      toIata: "Dest",
    };
    const r = parseGenericCsv(CSV, mapping);
    expect(r.parserErrors[0].message).toMatch(/required.*date/i);
  });

  it("rejects mapping that points to a non-existent column", () => {
    const mapping: GenericMapping = {
      date: "DoesNotExist",
      fromIata: "Origin",
      toIata: "Dest",
    };
    const r = parseGenericCsv(CSV, mapping);
    expect(r.parserErrors[0].message).toMatch(/column.*not found/i);
  });

  it("rejects rows with malformed Date or Time at parser level", () => {
    const broken = `Date,From,To,Dep,Arr\n2024-13-99,FRA,JFK,25:00:00,99:00:00`;
    const mapping: GenericMapping = {
      date: "Date",
      depTimeLocal: "Dep",
      arrTimeLocal: "Arr",
      fromIata: "From",
      toIata: "To",
    };
    const r = parseGenericCsv(broken, mapping);
    expect(r.rows).toHaveLength(0);
    expect(r.parserErrors.length).toBeGreaterThan(0);
  });
});
