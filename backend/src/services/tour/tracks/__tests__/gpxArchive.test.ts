import { parseGpx } from "../parseGpx";
import { gpxFileName, readArchiveBlock, restoredTrackColumns, trackToGpx } from "../gpxArchive";

const TOUR = {
  id: "tour-1",
  name: "Preikestolen <Aussicht> & mehr",
  kind: "tour",
  activity: "hike",
  mode: "foot",
};
const TRACK = {
  id: "track-1",
  source: "strava",
  name: "Morgens hoch",
  externalRef: "strava:123",
  startedAt: new Date("2026-09-20T07:00:00Z"),
  endedAt: new Date("2026-09-20T10:42:00Z"),
  pointCount: 4210,
  distanceKm: 8.1,
  truncated: false,
  ascentM: 512,
  descentM: 498,
  movingSeconds: 13320,
  // Two recording segments: the watch lost its fix between them.
  geometry: [
    [6.19, 58.98],
    [6.2, 58.985],
    [6.21, 58.99],
    [6.22, 58.995],
  ],
  segmentStarts: [0, 2],
  cumulativeKm: [0, 2.1, 5.9, 8.1],
  elevations: [
    [0, 270],
    [4, 604],
    [8.1, 280],
  ],
};

describe("gpxArchive", () => {
  const xml = trackToGpx(TOUR, TRACK);

  it("writes a GPX any program reads: the stored line, its segments, the two known instants", () => {
    const parsed = parseGpx(xml);
    expect(parsed?.points).toEqual(TRACK.geometry);
    expect(parsed?.segmentStarts).toEqual([0, 2]);
    expect(parsed?.startedAt?.toISOString()).toBe("2026-09-20T07:00:00.000Z");
    expect(parsed?.endedAt?.toISOString()).toBe("2026-09-20T10:42:00.000Z");
    // No invented times between them.
    expect(xml.match(/<time>/g)).toHaveLength(3); // metadata + first + last
    expect(xml).toContain("Preikestolen &lt;Aussicht&gt; &amp; mehr");
  });

  it("restores every measured figure from its own file instead of re-measuring the simplified line", () => {
    const parsed = parseGpx(xml)!;
    const block = readArchiveBlock(xml)!;
    expect(block.tour).toMatchObject({ id: "tour-1", kind: "tour", activity: "hike" });
    expect(restoredTrackColumns(parsed, block)).toMatchObject({
      source: "strava",
      pointCount: 4210,
      distanceKm: 8.1,
      ascentM: 512,
      descentM: 498,
      movingSeconds: 13320,
      cumulativeKm: [0, 2.1, 5.9, 8.1],
      elevations: TRACK.elevations,
      geometry: TRACK.geometry,
      segmentStarts: [0, 2],
    });
  });

  it("drops a running-distance list that no longer lines up with an edited line", () => {
    const edited = xml.replace(/<trkpt lat="58.995"[^]*?<\/trkpt>/, "");
    const parsed = parseGpx(edited)!;
    const restored = restoredTrackColumns(parsed, readArchiveBlock(edited)!);
    expect(parsed.points).toHaveLength(3);
    expect(restored.cumulativeKm).not.toEqual([0, 2.1, 5.9, 8.1]);
  });

  it("reads no block from someone else's GPX, and none from a tampered one", () => {
    expect(
      readArchiveBlock(`<?xml version="1.0"?><gpx version="1.1"><trk><trkseg/></trk></gpx>`)
    ).toBeNull();
    expect(readArchiveBlock(xml.replace('"ascentM":512', '"ascentM":-5'))).toBeNull();
    expect(readArchiveBlock("not xml at all <")).toBeNull();
  });

  it("names the file by date and tour, safe for any filesystem", () => {
    expect(gpxFileName("Trolltunga / Tag 2: hin & zurück", new Date("2026-09-23T06:00:00Z"))).toBe(
      "2026-09-23_Trolltunga-Tag-2-hin-zuruck.gpx"
    );
  });
});
