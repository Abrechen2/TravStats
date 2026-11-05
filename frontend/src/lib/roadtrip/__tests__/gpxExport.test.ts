import { describe, expect, it } from "vitest";

import { buildRoadtripGpx, gpxFileName } from "../gpxExport";
import { parseGpxStations } from "../startSources";
import type { RoadtripStation } from "../../../types/roadtrip";
import type { TourGeometry } from "../../../types/tour";

const station = (over: Partial<RoadtripStation>): RoadtripStation =>
  ({
    id: "s",
    title: "Hamburg",
    lat: 53.55,
    lon: 9.99,
    startDate: "2026-07-12T00:00:00.000Z",
    endDate: null,
    notes: null,
    order: 0,
    state: "pass",
    lodgingStayId: null,
    stay: null,
    ...over,
  }) as RoadtripStation;

const geometry: TourGeometry = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [9.99, 53.55],
          [10.5, 54],
        ],
      },
      properties: {
        legId: "l",
        source: "routed",
        mode: "drive",
        confidence: "high",
        distanceKm: 70,
      },
    },
  ],
} as never;

describe("roadtrip GPX export", () => {
  it("writes stations as waypoints and each leg's line as a track segment, in [lat, lon] order", () => {
    const gpx = buildRoadtripGpx(
      "Nord & Süd",
      [
        station({}),
        station({ id: "v", title: "", state: "via", lat: 1, lon: 1 }),
        station({ id: "k", title: "Kiel <Hafen>", lat: 54.3, lon: 10.1, state: "free" }),
      ],
      geometry
    );
    expect(gpx).toContain("<name>Nord &amp; Süd</name>");
    expect(gpx).toContain('<wpt lat="53.55" lon="9.99">');
    expect(gpx).toContain("<name>Kiel &lt;Hafen&gt;</name>");
    expect(gpx).toContain("<desc>2026-07-12</desc>");
    // A route correction is no stop.
    expect(gpx).not.toContain('lat="1" lon="1"');
    expect(gpx).toContain('<trkpt lat="54" lon="10.5"/>');
    expect(gpx.match(/<trkseg>/g)).toHaveLength(1);
  });

  it("reads back as the same stations through the importer", () => {
    const gpx = buildRoadtripGpx(
      "T",
      [station({}), station({ id: "k", title: "Kiel", lat: 54.3, lon: 10.1 })],
      geometry
    );
    expect(parseGpxStations(gpx)).toEqual({
      ok: true,
      from: "waypoints",
      points: [
        { title: "Hamburg", lat: 53.55, lon: 9.99 },
        { title: "Kiel", lat: 54.3, lon: 10.1 },
      ],
    });
  });

  it("omits the track when no leg has geometry, and makes a safe file name", () => {
    expect(buildRoadtripGpx("T", [station({})], null)).not.toContain("<trk>");
    expect(gpxFileName("Fjorde 2026 – Nord/Süd")).toBe("fjorde-2026-nordsud.gpx");
    expect(gpxFileName("…")).toBe("roadtrip.gpx");
  });
});
