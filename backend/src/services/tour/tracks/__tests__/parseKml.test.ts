import { describe, expect, it } from "@jest/globals";

import { readKml } from "../parseKml";

function parseKml(xml: string) {
  const result = readKml(xml);
  return result.ok ? result.track : null;
}

/**
 * KML as the flight trackers export it (forgejo#312): FlightAware writes a
 * `gx:Track` of `<when>`/`<gx:coord>` pairs, Flightradar24 one timestamped
 * `<Point>` placemark per position beside an untimed `<LineString>` trail,
 * and a hand-drawn route is a bare `<LineString>`.
 */

const FLIGHTAWARE = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>DLH718</name>
    <Placemark>
      <name>DLH718 MUC-ICN</name>
      <gx:Track>
        <altitudeMode>absolute</altitudeMode>
        <when>2026-10-03T08:00:00Z</when>
        <when>2026-10-03T08:01:00Z</when>
        <when>2026-10-03T08:02:00Z</when>
        <gx:coord>11.786 48.354 450</gx:coord>
        <gx:coord>11.9 48.4 1800</gx:coord>
        <gx:coord>12.1 48.5 3200</gx:coord>
      </gx:Track>
    </Placemark>
  </Document>
</kml>`;

const FLIGHTRADAR = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Folder>
      <name>Route</name>
      <Placemark>
        <name>Trail</name>
        <LineString><coordinates>11.786,48.354,450 12.1,48.5,3200</coordinates></LineString>
      </Placemark>
    </Folder>
    <Folder>
      <name>Positions</name>
      <Placemark>
        <TimeStamp><when>2026-10-03T08:02:00Z</when></TimeStamp>
        <Point><coordinates>12.1,48.5,3200</coordinates></Point>
      </Placemark>
      <Placemark>
        <TimeStamp><when>2026-10-03T08:00:00Z</when></TimeStamp>
        <Point><coordinates>11.786,48.354,450</coordinates></Point>
      </Placemark>
      <Placemark>
        <TimeStamp><when>2026-10-03T08:01:00Z</when></TimeStamp>
        <Point><coordinates>11.9,48.4,1800</coordinates></Point>
      </Placemark>
    </Folder>
  </Document>
</kml>`;

const LINE_ONLY = `<kml><Placemark><LineString><coordinates>
  11.786,48.354
  12.1,48.5
  13,49
</coordinates></LineString></Placemark></kml>`;

describe("parseKml", () => {
  it("reads a FlightAware gx:Track with its times and altitudes", () => {
    const track = parseKml(FLIGHTAWARE);
    expect(track).not.toBeNull();
    expect(track!.points).toEqual([
      [11.786, 48.354],
      [11.9, 48.4],
      [12.1, 48.5],
    ]);
    expect(track!.elevations).toEqual([450, 1800, 3200]);
    expect(track!.startedAt?.toISOString()).toBe("2026-10-03T08:00:00.000Z");
    expect(track!.endedAt?.toISOString()).toBe("2026-10-03T08:02:00.000Z");
    expect(track!.segmentStarts).toEqual([0]);
    expect(track!.name).toBe("DLH718 MUC-ICN");
  });

  it("prefers Flightradar24's timed positions, in time order, over its untimed trail", () => {
    const track = parseKml(FLIGHTRADAR);
    expect(track!.points).toEqual([
      [11.786, 48.354],
      [11.9, 48.4],
      [12.1, 48.5],
    ]);
    expect(track!.times).toEqual([
      Date.parse("2026-10-03T08:00:00Z"),
      Date.parse("2026-10-03T08:01:00Z"),
      Date.parse("2026-10-03T08:02:00Z"),
    ]);
  });

  it("reads a bare LineString without times or altitudes", () => {
    const track = parseKml(LINE_ONLY);
    expect(track!.points).toHaveLength(3);
    expect(track!.startedAt).toBeNull();
    expect(track!.endedAt).toBeNull();
    expect(track!.elevations).toEqual([null, null, null]);
  });

  it("keeps two gx:Tracks as two recorded stretches", () => {
    const two = FLIGHTAWARE.replace(
      "</Placemark>",
      "</Placemark>" +
        FLIGHTAWARE.slice(
          FLIGHTAWARE.indexOf("<Placemark>"),
          FLIGHTAWARE.indexOf("</Placemark>") + "</Placemark>".length
        ).replace(/08:0/g, "09:0")
    );
    const track = parseKml(two);
    expect(track!.points).toHaveLength(6);
    expect(track!.segmentStarts).toEqual([0, 3]);
  });

  it("drops a position outside the globe rather than the whole file", () => {
    const track = parseKml(LINE_ONLY.replace("12.1,48.5", "212.1,48.5"));
    expect(track!.points).toHaveLength(2);
  });

  it.each([
    ["broken XML", "<kml><Placemark><LineString>", "kmlInvalid"],
    ["XML that is not KML", "<gpx><trk/></gpx>", "kmlInvalid"],
    [
      "KML with a single position",
      "<kml><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></kml>",
      "kmlNoTrack",
    ],
    ["KML with no geometry", "<kml><Document><name>empty</name></Document></kml>", "kmlNoTrack"],
    [
      "a gx:Track whose times and positions do not pair up",
      FLIGHTAWARE.replace("<when>2026-10-03T08:02:00Z</when>", ""),
      "kmlUnpaired",
    ],
  ])("refuses %s with its own reason", (_label, xml, reason) => {
    expect(readKml(xml)).toEqual({ ok: false, reason });
  });

  it("reads gx:Track lists that interleave <when> and <gx:coord>", () => {
    const interleaved = `<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Placemark><gx:Track>
      <when>2026-10-03T08:00:00Z</when><gx:coord>11.786 48.354 450</gx:coord>
      <when>2026-10-03T08:01:00Z</when><gx:coord>11.9 48.4 1800</gx:coord>
      <when>2026-10-03T08:02:00Z</when><gx:coord>12.1 48.5 3200</gx:coord>
    </gx:Track></Placemark></kml>`;
    const track = parseKml(interleaved);
    expect(track!.points).toEqual([
      [11.786, 48.354],
      [11.9, 48.4],
      [12.1, 48.5],
    ]);
    expect(track!.times![2]).toBe(Date.parse("2026-10-03T08:02:00Z"));
  });

  it("reads each gx:Track of a gx:MultiTrack as its own stretch", () => {
    const multi = FLIGHTAWARE.replace("<gx:Track>", "<gx:MultiTrack><gx:Track>").replace(
      "</gx:Track>",
      "</gx:Track><gx:Track><when>2026-10-03T09:00:00Z</when><when>2026-10-03T09:01:00Z</when><gx:coord>13 49 9000</gx:coord><gx:coord>13.2 49.1 9000</gx:coord></gx:Track></gx:MultiTrack>"
    );
    const track = parseKml(multi);
    expect(track!.points).toHaveLength(5);
    expect(track!.segmentStarts).toEqual([0, 3]);
  });

  it("reads a TimeSpan's begin as a position's time", () => {
    const span = FLIGHTRADAR.replace(
      /<TimeStamp><when>([^<]+)<\/when><\/TimeStamp>/g,
      "<TimeSpan><begin>$1</begin></TimeSpan>"
    );
    expect(parseKml(span)!.times).toEqual([
      Date.parse("2026-10-03T08:00:00Z"),
      Date.parse("2026-10-03T08:01:00Z"),
      Date.parse("2026-10-03T08:02:00Z"),
    ]);
  });

  it("joins lines that meet end to end into one stretch, and keeps a real gap", () => {
    const pieces = `<kml><Document>
      <Placemark><LineString><coordinates>1,50 2,50</coordinates></LineString></Placemark>
      <Placemark><LineString><coordinates>2,50 3,50</coordinates></LineString></Placemark>
      <Placemark><LineString><coordinates>5,50 6,50</coordinates></LineString></Placemark>
    </Document></kml>`;
    const track = parseKml(pieces);
    expect(track!.points).toEqual([
      [1, 50],
      [2, 50],
      [3, 50],
      [5, 50],
      [6, 50],
    ]);
    expect(track!.segmentStarts).toEqual([0, 3]);
  });

  describe("altitude", () => {
    const timedPoint = (when: string, coords: string, description = "") =>
      `<Placemark>${description}<TimeStamp><when>${when}</when></TimeStamp><Point><coordinates>${coords}</coordinates></Point></Placemark>`;

    it("takes an altitude the description states in feet over the coordinate, as metres", () => {
      const xml = `<kml><Folder>${timedPoint(
        "2026-10-03T08:00:00Z",
        "8,50,0",
        "<description><![CDATA[<b>Altitude:</b> 35,000 ft]]></description>"
      )}${timedPoint("2026-10-03T08:01:00Z", "8.1,50,0", "<description>Altitude: 1000 m</description>")}</Folder></kml>`;
      expect(parseKml(xml)!.elevations).toEqual([10668, 1000]);
    });

    it("reads coordinate altitudes as metres while they could be metres", () => {
      const xml = `<kml><Folder>${timedPoint("2026-10-03T08:00:00Z", "8,50,3000")}${timedPoint(
        "2026-10-03T08:01:00Z",
        "8.1,50,11000"
      )}</Folder></kml>`;
      expect(parseKml(xml)!.elevations).toEqual([3000, 11000]);
    });

    it("converts coordinate altitudes that cannot be metres from feet", () => {
      const xml = `<kml><Folder>${timedPoint("2026-10-03T08:00:00Z", "8,50,3000")}${timedPoint(
        "2026-10-03T08:01:00Z",
        "8.1,50,37000"
      )}</Folder></kml>`;
      const [low, high] = parseKml(xml)!.elevations!;
      expect(low).toBeCloseTo(914.4, 1);
      expect(high).toBeCloseTo(11277.6, 1);
    });
  });
});
