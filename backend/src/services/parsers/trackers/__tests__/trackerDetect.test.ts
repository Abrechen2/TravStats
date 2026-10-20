/**
 * forgejo#311 — the format is recognised from the file, and a file nothing
 * recognises says what was expected instead of reading as "no flights".
 */
import fs from "fs";
import path from "path";
import { detectTrackerFormat, parseTrackerExport } from "..";

const FIXTURES = path.join(__dirname, "../../../../__tests__/fixtures");
const fixture = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf-8");

describe("tracker export detection", () => {
  it.each([
    ["trackers/openflights.csv", "openflights"],
    ["trackers/jetlog.csv", "jetlog"],
    ["trackers/flighty.csv", "flighty"],
    ["trackers/app-in-the-air.txt", "app_in_the_air"],
    ["trackers/airtrail.json", "airtrail"],
    ["fr24-sample.csv", "fr24"],
  ])("recognises %s as %s", (file, format) => {
    expect(detectTrackerFormat(fixture(file))).toBe(format);
  });

  it("reads a recognised file with that format's parser", () => {
    const result = parseTrackerExport(fixture("trackers/jetlog.csv"));
    expect(result.format).toBe("jetlog");
    expect(result.rows).toHaveLength(3);
    expect(result.expected).toBeUndefined();
  });

  it("refuses an unknown CSV and lists the columns each format is known by", () => {
    const result = parseTrackerExport("when,where\n2024-01-01,somewhere\n");
    expect(result.format).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.parserErrors).toEqual([
      expect.objectContaining({ rowIndex: -1, code: "unknownFormat" }),
    ]);
    expect(result.parserErrors[0].message).toContain("Flight_Number");
    expect(result.parserErrors[0].message).toContain("Gate Departure (Scheduled)");
    expect(result.expected?.jetlog).toContain("origin");
    expect(result.expected?.flighty).toContain("Flight");
  });

  it("refuses JSON that is not an AirTrail export", () => {
    const result = parseTrackerExport('{"trips": []}');
    expect(result.format).toBeNull();
    expect(result.parserErrors[0].code).toBe("unknownFormat");
  });

  it("says a truncated JSON file is broken", () => {
    const result = parseTrackerExport('{"users": [], "flights": [{"date": "2024');
    expect(result.format).toBe("airtrail");
    expect(result.parserErrors[0].code).toBe("invalidJson");
  });

  it("names the missing columns of a recognised but incomplete file", () => {
    const result = parseTrackerExport("Date,Flight_Number,From\n2024-01-01,LH1,FRA\n");
    expect(result.format).toBe("openflights");
    expect(result.parserErrors).toEqual([
      expect.objectContaining({ code: "missingHeader", value: "To" }),
    ]);
  });

  it("gives FR24 errors a code the UI can translate", () => {
    const result = parseTrackerExport(
      'Date,"Flight number",From,To,"Dep time","Arr time",Duration\n2024-02-30,LH1,"a (FRA/EDDF)","b (JFK/KJFK)",10:00:00,12:00:00,02:00:00\n'
    );
    expect(result.parserErrors).toEqual([
      expect.objectContaining({ code: "invalidDate", value: "2024-02-30" }),
    ]);
  });
});
