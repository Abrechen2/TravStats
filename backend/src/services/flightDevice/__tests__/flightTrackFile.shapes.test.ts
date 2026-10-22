import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "@jest/globals";
import { strToU8, zipSync } from "fflate";

import { readFlightTrackFile, type FlightTrackFileResult } from "../flightTrackFile";
import { readKmz } from "../readKmz";

/**
 * The shapes the two flight trackers actually export (forgejo#312), read
 * through the flight page's upload reader. The fixtures keep the exporters'
 * structure — FlightAware's airport placemarks and styles beside one
 * `gx:Track`; Flightradar24's "Route" folder of timed positions beside a
 * "Trail" of colour-banded line pieces, and its CSV — with synthetic
 * coordinates (a Frankfurt → Munich line, 08:00–08:48Z, nine fixes).
 *
 * Altitude: the same nine fixes climb to 30,000 ft. FlightAware writes metres
 * (KML's unit), Flightradar24's CSV writes feet; both must store metres.
 */

const fixture = (name: string): Buffer => readFileSync(join(__dirname, "fixtures", name));

const FEET = [350, 4500, 14000, 24000, 30000, 30000, 22000, 9000, 1500];
const METRES = FEET.map((ft) => ft * 0.3048);

function track(result: FlightTrackFileResult) {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
}

function expectMetres(elevations: Array<number | null> | undefined) {
  expect(elevations).toHaveLength(METRES.length);
  elevations!.forEach((m, i) => expect(m).toBeCloseTo(METRES[i], 0));
}

const START = Date.parse("2026-10-03T08:00:00Z");
const TIMES = FEET.map((_, i) => START + i * 6 * 60_000);

describe("readFlightTrackFile — real export shapes", () => {
  it("FlightAware KML: the gx:Track is the track, the two airport points are not", async () => {
    const file = track(await readFlightTrackFile(fixture("flightaware-track.kml"), "x.kml"));
    expect(file.format).toBe("kml");
    expect(file.track.points).toHaveLength(9);
    expect(file.track.points[0]).toEqual([8.5706, 50.0333]);
    expect(file.track.points).not.toContainEqual([8.570556, 50.033333]);
    expect(file.track.times).toEqual(TIMES);
    expect(file.track.segmentStarts).toEqual([0]);
    expectMetres(file.track.elevations);
    expect(file.track.name).toBe("FlightAware ✈ DLH100 03-Oct-2026 (EDDF-EDDM)");
  });

  it("FlightAware KML with only the airports: no track, said so", async () => {
    const result = await readFlightTrackFile(fixture("flightaware-airports-only.kml"), "x.kml");
    expect(result).toEqual({ ok: false, reason: "kmlNoTrack" });
  });

  it("Flightradar24 KML: the timed positions, never the untimed trail", async () => {
    const file = track(await readFlightTrackFile(fixture("flightradar24-playback.kml"), "x.kml"));
    expect(file.format).toBe("kml");
    expect(file.track.points).toHaveLength(9);
    expect(file.track.times).toEqual(TIMES);
    expect(file.track.name).toBe("LH100/DLH100");
    expectMetres(file.track.elevations);
  });

  it("Flightradar24 KML: positions listed out of order are put in time order", async () => {
    const xml = fixture("flightradar24-playback.kml").toString("utf-8");
    const placemarks = xml.match(/<Placemark>[\s\S]*?<\/Placemark>/g)!.slice(0, 9);
    const from = xml.indexOf(placemarks[0]);
    const to = xml.indexOf(placemarks[8]) + placemarks[8].length;
    const shuffled = xml.slice(0, from) + [...placemarks].reverse().join("\n") + xml.slice(to);
    expect(shuffled).not.toBe(xml);
    const file = track(await readFlightTrackFile(Buffer.from(shuffled), "x.kml"));
    expect(file.track.times).toEqual(TIMES);
    expect(file.track.points[0]).toEqual([8.5706, 50.0333]);
  });

  it("Flightradar24 KML trail alone: one untimed line, no invented times", async () => {
    const xml = fixture("flightradar24-playback.kml")
      .toString("utf-8")
      .replace(/<TimeStamp>[\s\S]*?<\/TimeStamp>/g, "");
    const file = track(await readFlightTrackFile(Buffer.from(xml), "x.kml"));
    // Without times the Route points are skipped; the eight trail pieces join into one stretch.
    expect(file.track.points).toHaveLength(9);
    expect(file.track.segmentStarts).toEqual([0]);
    expect(file.track.times!.every((t) => t === null)).toBe(true);
    expect(file.track.startedAt).toBeNull();
  });

  it("Flightradar24 CSV: lat,lon swapped into place, feet stored as metres", async () => {
    const file = track(await readFlightTrackFile(fixture("flightradar24-track.csv"), "x.csv"));
    expect(file.format).toBe("csv");
    expect(file.track.points[0]).toEqual([8.5706, 50.0333]);
    expect(file.track.times).toEqual(TIMES);
    expect(file.track.name).toBe("DLH100");
    expectMetres(file.track.elevations);
  });

  it("Flightradar24 CSV is recognised by its header whatever the file is called", async () => {
    const file = track(await readFlightTrackFile(fixture("flightradar24-track.csv"), "export"));
    expect(file.format).toBe("csv");
  });

  it("Flightradar24 CSV rows out of order, with a BOM and CRLF, read in time order", async () => {
    const [header, ...rows] = fixture("flightradar24-track.csv")
      .toString("utf-8")
      .trim()
      .split("\n");
    const messy = "\uFEFF" + [header, ...rows.reverse()].join("\r\n");
    const file = track(await readFlightTrackFile(Buffer.from(messy), "x.csv"));
    expect(file.track.times).toEqual(TIMES);
  });

  it("falls back to the UTC column when Timestamp is empty", async () => {
    const csv = fixture("flightradar24-track.csv").toString("utf-8").replace(/^\d+,/gm, ",");
    const file = track(await readFlightTrackFile(Buffer.from(csv), "x.csv"));
    expect(file.track.times).toEqual(TIMES);
  });

  it("KMZ: the doc.kml inside is read like the KML", async () => {
    const kmz = Buffer.from(
      zipSync({
        "doc.kml": new Uint8Array(fixture("flightaware-track.kml")),
        "files/icon.png": strToU8("not really a png"),
      })
    );
    const file = track(await readFlightTrackFile(kmz, "DLH100.kmz"));
    expect(file.format).toBe("kml");
    expect(file.track.points).toHaveLength(9);
    expectMetres(file.track.elevations);
  });

  it("KMZ: prefers doc.kml over another KML entry", () => {
    const kmz = Buffer.from(
      zipSync({ "a.kml": strToU8("<kml>a</kml>"), "doc.kml": strToU8("<kml>doc</kml>") })
    );
    expect(readKmz(kmz)).toEqual({ ok: true, kml: "<kml>doc</kml>" });
  });

  describe("refusals, each with its own reason", () => {
    const cases: Array<[string, Buffer, string, string]> = [
      [
        "a ZIP without a KML",
        Buffer.from(zipSync({ "a.txt": strToU8("hi") })),
        "a.kmz",
        "kmzNoKml",
      ],
      [
        "a KMZ cut short",
        Buffer.from(
          zipSync({ "doc.kml": new Uint8Array(fixture("flightaware-track.kml")) }, { level: 0 })
        ).subarray(0, 400),
        "a.kmz",
        "kmzDamaged",
      ],
      ["a .kmz that is not a ZIP", Buffer.from("hello"), "a.kmz", "kmzDamaged"],
      ["a .kml that is not XML", Buffer.from("not xml at all"), "a.kml", "kmlInvalid"],
      [
        "a CSV with other columns",
        Buffer.from("Date,Flight\n2026-10-03,LH100\n"),
        "a.csv",
        "csvColumns",
      ],
      [
        "a Flightradar24 CSV with one usable row",
        Buffer.from(
          'Timestamp,UTC,Callsign,Position,Altitude,Speed,Direction\n1791014400,2026-10-03T08:00:00Z,DLH100,"50.0333,8.5706",350,140,250\n'
        ),
        "a.csv",
        "csvNoPositions",
      ],
      ["a JSON file", Buffer.from('{"points":[]}'), "track.json", "unsupported"],
      ["a .gpx that is not GPX", Buffer.from("garbage"), "a.gpx", "unreadable"],
    ];
    it.each(cases)("%s", async (_label, buffer, name, reason) => {
      expect(await readFlightTrackFile(buffer, name)).toEqual({ ok: false, reason });
    });

    it("a KMZ whose KML unpacks past the limit", () => {
      const kmz = Buffer.from(zipSync({ "doc.kml": new Uint8Array(4096) }));
      expect(readKmz(kmz, 1024)).toEqual({ ok: false, reason: "kmzTooLarge" });
    });
  });
});
