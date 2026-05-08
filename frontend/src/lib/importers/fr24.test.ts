import { describe, it, expect } from "vitest";
import { parseFr24 } from "./fr24";

const SAMPLE = `
Date,"Flight number",From,To,"Dep time","Arr time",Duration,Airline,Aircraft,Registration,"Seat number","Seat type","Flight class","Flight reason",Note,Dep_id,Arr_id,Airline_id,Aircraft_id
2023-03-15,LH401,"Frankfurt am Main / Frankfurt (FRA/EDDF)","New York / John F Kennedy International (JFK/KJFK)",10:30:00,13:25:00,08:55:00,"Lufthansa (LH/DLH)","Boeing 747-8 (B748)",D-ABYD,41A,1,1,1,Spring break trip,524,2670,1102,1842
2023-03-22,QF12,"Los Angeles / Los Angeles (LAX/KLAX)","Sydney / Kingsford Smith (SYD/YSSY)",22:30:00,06:25:00,14:55:00,"Qantas (QF/QFA)","Airbus A380-800 (A388)",VH-OQB,14K,1,3,1,"Honeymoon, leg 1",1726,2934,156,2104
`;

describe("parseFr24", () => {
  it("skips the leading blank line and parses 2 rows", () => {
    const result = parseFr24(SAMPLE);
    expect(result.parserErrors).toEqual([]);
    expect(result.rows).toHaveLength(2);
  });

  it("extracts IATA from embedded `(IATA/ICAO)` strings", () => {
    const r = parseFr24(SAMPLE).rows[0];
    expect(r.fromIata).toBe("FRA");
    expect(r.toIata).toBe("JFK");
  });

  it("converts Duration HH:MM:SS to durationSeconds", () => {
    const r = parseFr24(SAMPLE).rows[0]; // 08:55:00
    expect(r.durationSeconds).toBe(8 * 3600 + 55 * 60);
  });

  it("preserves quoted commas in Note", () => {
    const r = parseFr24(SAMPLE).rows[1];
    expect(r.notes).toBe("Honeymoon, leg 1");
  });

  it("maps numeric Flight reason 1 → vacation", () => {
    const r = parseFr24(SAMPLE).rows[0];
    expect(r.category).toBe("vacation");
  });

  it("maps numeric Flight class 3 → business", () => {
    const r = parseFr24(SAMPLE).rows[1];
    expect(r.seatClass).toBe("business");
  });

  it("rejects malformed Date — surfaces as ParserError", () => {
    const broken = `\nDate,"Flight number",From,To,"Dep time","Arr time",Duration,Airline,Aircraft,Registration,"Seat number","Seat type","Flight class","Flight reason",Note,Dep_id,Arr_id,Airline_id,Aircraft_id\n2024-13-99,LH1,(FRA/EDDF),(JFK/KJFK),10:00:00,12:00:00,02:00:00,a,b,c,1A,1,1,1,,1,2,3,4`;
    const result = parseFr24(broken);
    expect(result.rows).toHaveLength(0);
    expect(result.parserErrors[0].field).toBe("Date");
  });

  it("rejects file lacking the FR24 header signature", () => {
    const result = parseFr24("not a fr24 file\n1,2,3");
    expect(result.parserErrors[0].message).toMatch(/header/i);
  });
});
