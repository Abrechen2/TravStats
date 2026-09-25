import { FitBaseType, FitEncoder } from "fit-file-parser";

import { detectTrackFormat, parseTrackFile } from "../parseTrackFile";

const TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-07-15T08:40:00Z</Id>
      <Lap StartTime="2026-07-15T08:40:00Z">
        <Track>
          <Trackpoint><Time>2026-07-15T08:40:00Z</Time><Position><LatitudeDegrees>58.9860</LatitudeDegrees><LongitudeDegrees>6.1900</LongitudeDegrees></Position><AltitudeMeters>270</AltitudeMeters></Trackpoint>
          <Trackpoint><Time>2026-07-15T08:41:00Z</Time><Position><LatitudeDegrees>58.9869</LatitudeDegrees><LongitudeDegrees>6.1900</LongitudeDegrees></Position><AltitudeMeters>300</AltitudeMeters></Trackpoint>
        </Track>
        <Track>
          <Trackpoint><Time>2026-07-15T09:40:00Z</Time><Position><LatitudeDegrees>58.9900</LatitudeDegrees><LongitudeDegrees>6.1900</LongitudeDegrees></Position><AltitudeMeters>500</AltitudeMeters></Trackpoint>
          <Trackpoint><Time>2026-07-15T09:41:00Z</Time><Position><LatitudeDegrees>58.9909</LatitudeDegrees><LongitudeDegrees>6.1900</LongitudeDegrees></Position><AltitudeMeters>604</AltitudeMeters></Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

/** Degrees → FIT semicircles. */
const semicircles = (deg: number) => Math.round((deg * 2 ** 31) / 180);

function buildFit(points: Array<{ lat: number; lon: number; alt: number; at: string }>): Buffer {
  const encoder = new FitEncoder();
  // file_id: type = activity (4). Parsers expect it first.
  encoder.writeMessage(0, [{ number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 }]);
  for (const p of points) {
    encoder.writeMessage(20, [
      {
        number: 253,
        size: 4,
        baseType: FitBaseType.Uint32,
        value: FitEncoder.toFitTimestamp(new Date(p.at)),
      },
      { number: 0, size: 4, baseType: FitBaseType.Sint32, value: semicircles(p.lat) },
      { number: 1, size: 4, baseType: FitBaseType.Sint32, value: semicircles(p.lon) },
      // enhanced_altitude: scale 5, offset 500.
      { number: 78, size: 4, baseType: FitBaseType.Uint32, value: Math.round((p.alt + 500) * 5) },
    ]);
  }
  return Buffer.from(encoder.close());
}

describe("detectTrackFormat", () => {
  it("decides by the bytes, not the file name", () => {
    const fit = buildFit([
      { lat: 58.98, lon: 6.19, alt: 100, at: "2026-07-15T08:00:00Z" },
      { lat: 58.981, lon: 6.19, alt: 110, at: "2026-07-15T08:01:00Z" },
    ]);
    expect(detectTrackFormat(fit, "renamed.gpx")).toBe("fit");
    expect(detectTrackFormat(Buffer.from(TCX), "export.xml")).toBe("tcx");
    expect(detectTrackFormat(Buffer.from('<?xml version="1.0"?><gpx version="1.1"></gpx>'))).toBe(
      "gpx"
    );
  });

  it("refuses a file that is none of the three", () => {
    expect(detectTrackFormat(Buffer.from("lat,lon\n1,2"), "points.csv")).toBeNull();
  });
});

describe("parseTrackFile — TCX", () => {
  it("reads points, elevations, times and one segment per <Track>", async () => {
    const result = await parseTrackFile(Buffer.from(TCX), "run.tcx");
    expect(result?.format).toBe("tcx");
    const track = result!.track;
    expect(track.points).toHaveLength(4);
    expect(track.points[0]).toEqual([6.19, 58.986]);
    expect(track.segmentStarts).toEqual([0, 2]);
    expect(track.elevations).toEqual([270, 300, 500, 604]);
    expect(track.startedAt?.toISOString()).toBe("2026-07-15T08:40:00.000Z");
    expect(track.endedAt?.toISOString()).toBe("2026-07-15T09:41:00.000Z");
    // The Activity Id is a timestamp, not a title.
    expect(track.name).toBeNull();
  });
});

describe("parseTrackFile — FIT", () => {
  it("reads positions in degrees, altitude in metres, and times", async () => {
    const fit = buildFit([
      { lat: 58.986, lon: 6.19, alt: 270, at: "2026-07-15T08:40:00Z" },
      { lat: 58.9869, lon: 6.19, alt: 300.4, at: "2026-07-15T08:41:00Z" },
      { lat: 58.9878, lon: 6.1905, alt: 330, at: "2026-07-15T08:42:00Z" },
    ]);
    const result = await parseTrackFile(fit, "watch.fit");
    expect(result?.format).toBe("fit");
    const track = result!.track;
    expect(track.points).toHaveLength(3);
    expect(track.points[0][0]).toBeCloseTo(6.19, 5);
    expect(track.points[0][1]).toBeCloseTo(58.986, 5);
    expect(track.elevations?.[1]).toBeCloseTo(300.4, 1);
    expect(track.startedAt?.toISOString()).toBe("2026-07-15T08:40:00.000Z");
    expect(track.endedAt?.toISOString()).toBe("2026-07-15T08:42:00.000Z");
  });

  it("returns null for a FIT file with no positions (an indoor workout)", async () => {
    const encoder = new FitEncoder();
    encoder.writeMessage(0, [{ number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 }]);
    const result = await parseTrackFile(Buffer.from(encoder.close()), "treadmill.fit");
    expect(result).toBeNull();
  });
});
