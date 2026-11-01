import { readFileSync } from "fs";
import { join } from "path";
import { parseTraewellingCsv, parseTraewellingJson } from "../travelling";
import { parseTravelynxJson } from "../travelynx";

/**
 * Fixtures follow the shape of the real upstream exports (see the header of
 * travelling.ts / travelynx.ts for file paths and commits); every person,
 * station and journey in them is synthetic.
 */
const fixture = (name: string) => readFileSync(join(__dirname, name), "utf8");

describe("Träwelling JSON (export shape: data[].checkin.origin/destination)", () => {
  const out = parseTraewellingJson(fixture("fixtures/traewelling-export.json"));

  it("reads the checkin object, position and EVA of the trip station, planned times", () => {
    expect(out.rides).toHaveLength(3);
    const [ice, u] = out.rides;
    expect(ice).toMatchObject({ mode: "rail", trainNumber: "901", notes: "Vollgepackt" });
    expect(ice.dep).toMatchObject({
      name: "Alpha Hbf",
      code: "8999001",
      lat: 52.5,
      lon: 13.4,
      time: { instant: new Date("2026-03-01T07:00:00Z") },
    });
    expect(ice.arr.time).toEqual({ instant: new Date("2026-03-01T09:30:00Z") });
    expect(u.mode).toBe("metro");
    expect(u.arr).toMatchObject({ name: "Gamma Platz", lat: 52.6, lon: 13.5 });
  });

  it("does not take a stopover's internal station id for an EVA number", () => {
    // origin.id is 11 in the fixture: five digits would pass for an EVA if it were read.
    const [, u] = out.rides;
    expect(u.dep.code).toBeUndefined();
  });

  it("falls back to the manual times and prefers the manual journey number", () => {
    const manual = out.rides[2];
    expect(manual).toMatchObject({ trainNumber: "12345", mode: "rail" });
    expect(manual.dep.time).toEqual({ instant: new Date("2026-03-04T08:00:00Z") });
    expect(manual.arr.time).toEqual({ instant: new Date("2026-03-04T09:00:00Z") });
  });

  it("shows every record it cannot read with a reason instead of dropping it", () => {
    expect(out.rejects).toEqual([
      { row: 3, label: "#3", reason: "not_a_journey" },
      expect.objectContaining({ row: 4, reason: "invalid_date" }),
    ]);
  });

  it("answers invalid_file for text that is not JSON, and for the old guessed `train` shape", () => {
    expect(parseTraewellingJson("<html>").rejects[0].reason).toBe("invalid_file");
    const old = parseTraewellingJson(JSON.stringify({ data: [{ train: { origin: {} } }] }));
    expect(old.rejects[0].reason).toBe("not_a_journey");
  });
});

describe("Träwelling CSV (ExportableColumn headings)", () => {
  const out = parseTraewellingCsv(fixture("fixtures/traewelling-machine.csv"));

  it("reads quoted cells, the one-cell coordinates and numbers rows by file line", () => {
    expect(out.rides).toHaveLength(2);
    expect(out.rides[0]).toMatchObject({ row: 2, mode: "rail", notes: "mit, Komma" });
    expect(out.rides[0].dep).toMatchObject({ name: "Alpha Hbf", lat: 52.5, lon: 13.4 });
    expect(out.rides[0].arr).toMatchObject({ lat: 53.5, lon: 10 });
  });

  it("falls back to the real time when no planned time exists", () => {
    expect(out.rides[1]).toMatchObject({ row: 4, mode: "bus" });
    expect(out.rides[1].dep.time).toEqual({ instant: new Date("2026-03-02T08:00:00Z") });
  });

  it("rejects a row without an arrival station with its line number", () => {
    expect(out.rejects).toEqual([
      expect.objectContaining({ row: 3, reason: "missing_arrival_station" }),
    ]);
  });

  it("reads the German headings of the human-readable CSV", () => {
    const de = parseTraewellingCsv(fixture("fixtures/traewelling-human-de.csv"));
    expect(de.rejects).toEqual([]);
    expect(de.rides[0]).toMatchObject({ mode: "rail", notes: "Hallo", trainNumber: "5" });
    expect(de.rides[0].dep).toMatchObject({ name: "Alpha Hbf", lat: 52.5 });
  });
});

describe("Träwelling CSV, hardening", () => {
  it("answers invalid_file for text whose header names no station column", () => {
    expect(parseTraewellingCsv("not json").rejects).toEqual([
      expect.objectContaining({ reason: "invalid_file" }),
    ]);
  });

  it("splits on the file's one delimiter, so a semicolon in a comma file stays in its cell", () => {
    const out = parseTraewellingCsv(
      'journey_type,origin_name,departure_planned,destination_name,body\nregional,Alpha Hbf,2026-03-01T08:00:00+01:00,Beta Hbf,"a;b"\nregional,Alpha; Hbf,2026-03-01T09:00:00+01:00,Beta Hbf,x'
    );
    expect(out.rides.map((r) => r.dep.name)).toEqual(["Alpha Hbf", "Alpha; Hbf"]);
  });
});

describe("travelynx account export (journeys_str rows)", () => {
  const out = parseTravelynxJson(fixture("fixtures/travelynx-export.json"));

  it("reads the flat journey rows: epoch seconds, names, positions, comment from user_data", () => {
    expect(out.rides.map((r) => r.mode)).toEqual(["rail", "tram"]);
    const [re] = out.rides;
    expect(re).toMatchObject({ trainNumber: "5", lineName: "RE5", notes: "Pünktlich" });
    expect(re.dep).toMatchObject({ name: "Alpha Hbf", lat: 52.5, lon: 13.4 });
    expect(re.dep.time).toEqual({ instant: new Date(1772352000 * 1000) });
    expect(re.arr.time).toEqual({ instant: new Date(1772358000 * 1000) });
  });

  it("uses *_eva as a station code only for the IRIS / DB backends", () => {
    expect(out.rides[0].dep.code).toBe("8999001");
    // A HAFAS journey's id is the backend's own, not an EVA number.
    expect(out.rides[1].dep.code).toBeUndefined();
  });

  it("does not read in_transit, and shows a cancelled or incomplete journey with its reason", () => {
    expect(out.rejects).toEqual([
      expect.objectContaining({ row: 3, reason: "cancelled" }),
      expect.objectContaining({ row: 4, reason: "missing_arrival_station" }),
    ]);
  });

  it("rejects an absurd epoch instead of aborting", () => {
    const bad = parseTravelynxJson(
      JSON.stringify([{ dep_name: "A", arr_name: "B", sched_dep_ts: 1e20 }])
    );
    expect(bad.rejects[0].reason).toBe("invalid_date");
  });
});
