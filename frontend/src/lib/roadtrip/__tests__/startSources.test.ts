import { describe, expect, it } from "vitest";

import { MAX_START_STATIONS, parseGpxStations, parseMapsLink } from "../startSources";

const gpx = (body: string): string =>
  `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;

describe("roadtrip start from a GPX file", () => {
  it("takes a planned route's points before waypoints, with their names", () => {
    const r = parseGpxStations(
      gpx(
        `<wpt lat="1" lon="1"><name>Poi</name></wpt>` +
          `<rte><rtept lat="48.1" lon="11.5"><name>München</name></rtept><rtept lat="45.4" lon="9.2"/></rte>`
      )
    );
    expect(r).toEqual({
      ok: true,
      from: "route",
      points: [
        { title: "München", lat: 48.1, lon: 11.5 },
        { title: "", lat: 45.4, lon: 9.2 },
      ],
    });
  });

  it("falls back to waypoints, then to where a recorded track starts and ends", () => {
    const w = parseGpxStations(gpx(`<wpt lat="50" lon="8"><name>A</name></wpt>`));
    expect(w.ok && w.from).toBe("waypoints");
    const t = parseGpxStations(
      gpx(
        `<trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/><trkpt lat="5" lon="6"/></trkseg></trk>`
      )
    );
    expect(t).toEqual({
      ok: true,
      from: "track",
      points: [
        { title: "", lat: 1, lon: 2 },
        { title: "", lat: 5, lon: 6 },
      ],
    });
  });

  it("says why a file cannot start a roadtrip instead of starting an empty one", () => {
    expect(parseGpxStations("not xml <").ok).toBe(false);
    expect(parseGpxStations("<kml/>")).toEqual({ ok: false, reason: "notGpx" });
    expect(parseGpxStations("<html/>")).toEqual({ ok: false, reason: "notGpx" });
    expect(parseGpxStations(gpx(""))).toEqual({ ok: false, reason: "noPoints" });
    // A point outside the globe is dropped, not clamped.
    expect(parseGpxStations(gpx(`<wpt lat="95" lon="1"/>`))).toEqual({
      ok: false,
      reason: "noPoints",
    });
  });

  it("drops a point with a missing or empty coordinate instead of placing it at 0,0", () => {
    expect(parseGpxStations(gpx(`<wpt lat="" lon="5"/><wpt lon="5"/>`))).toEqual({
      ok: false,
      reason: "noPoints",
    });
    const r = parseGpxStations(
      gpx(`<wpt lat="" lon="5"/><wpt lat="50" lon="8"><name>Ok</name></wpt>`)
    );
    expect(r.ok && r.points).toEqual([{ title: "Ok", lat: 50, lon: 8 }]);
  });

  it("refuses a file over the station cap rather than cutting it", () => {
    const many = Array.from(
      { length: MAX_START_STATIONS + 1 },
      (_, i) => `<wpt lat="${(i % 80) + 1}" lon="1"/>`
    ).join("");
    expect(parseGpxStations(gpx(many))).toEqual({
      ok: false,
      reason: "tooMany",
      count: MAX_START_STATIONS + 1,
    });
  });
});

describe("roadtrip start from a Google or Apple Maps link", () => {
  it("reads origin, waypoints and destination of a Google directions link", () => {
    const r = parseMapsLink(
      "https://www.google.com/maps/dir/?api=1&origin=48.1,11.5&waypoints=Verona|45.0,10.0&destination=Rom"
    );
    expect(r).toEqual({
      ok: true,
      waypoints: [
        { title: "", lat: 48.1, lon: 11.5 },
        { name: "Verona" },
        { title: "", lat: 45, lon: 10 },
        { name: "Rom" },
      ],
    });
  });

  it("reads the stops of a /maps/dir/ path and prefers the exact points of data=", () => {
    const r = parseMapsLink(
      "https://www.google.com/maps/dir/M%C3%BCnchen/Rom/@44,11,6z/data=!4m4!4m3!2m2!1d11.57!2d48.13!2m2!1d12.49!2d41.89"
    );
    expect(r).toEqual({
      ok: true,
      waypoints: [
        { title: "München", lat: 48.13, lon: 11.57 },
        { title: "Rom", lat: 41.89, lon: 12.49 },
      ],
    });
  });

  it("reads Apple's saddr/daddr with several stops and a single Google place", () => {
    expect(parseMapsLink("https://maps.apple.com/?saddr=48.1,11.5&daddr=45,9+to:44,8")).toEqual({
      ok: true,
      waypoints: [
        { title: "", lat: 48.1, lon: 11.5 },
        { title: "", lat: 45, lon: 9 },
        { title: "", lat: 44, lon: 8 },
      ],
    });
    expect(parseMapsLink("https://www.google.com/maps/place/Camping+Alpe/@46.5,11.2,15z")).toEqual({
      ok: true,
      waypoints: [{ title: "Camping Alpe", lat: 46.5, lon: 11.2 }],
    });
  });

  it("takes a place's own coordinates from data= over the viewport centre in @", () => {
    expect(
      parseMapsLink(
        "https://www.google.com/maps/place/Camping+Alpe/@46.5,11.2,15z/data=!3m1!4b1!4m6!3m5!8m2!3d46.51!4d11.31"
      )
    ).toEqual({ ok: true, waypoints: [{ title: "Camping Alpe", lat: 46.51, lon: 11.31 }] });
  });

  it("says why a link is no use: not a link, not Maps, a short link, no waypoint", () => {
    expect(parseMapsLink("München nach Rom")).toEqual({ ok: false, reason: "notALink" });
    expect(parseMapsLink("https://example.org/maps")).toEqual({ ok: false, reason: "notMaps" });
    expect(parseMapsLink("https://maps.app.goo.gl/abc123")).toEqual({
      ok: false,
      reason: "shortLink",
    });
    expect(parseMapsLink("https://www.google.com/maps")).toEqual({
      ok: false,
      reason: "noWaypoints",
    });
  });
});
