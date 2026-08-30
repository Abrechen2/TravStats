import { describe, it, expect } from "@jest/globals";

import { parseGpx } from "../parseGpx";

/**
 * Task 2 (Phase 3b tour tracks): a pure GPX -> ParsedTrack parser. No file
 * system, no database, no network — XML string in, structure out.
 *
 * `startedAt`/`endedAt` are nullable by controller ruling (see
 * task-2-brief.md): a GPX with no `<time>` elements still parses
 * successfully with both fields `null`. Refusing to STORE a timestamp-less
 * track is task 3's job (`ingestTrack`), not this parser's.
 */

describe("parseGpx", () => {
  it("case 1: a single trkseg with timestamped trkpt — points in [lon, lat] order, startedAt/endedAt from the timestamps", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Morning Ride</name>
    <trkseg>
      <trkpt lat="52.5200" lon="13.4050">
        <ele>34.2</ele>
        <time>2026-06-01T08:00:00Z</time>
      </trkpt>
      <trkpt lat="52.5300" lon="13.4100">
        <time>2026-06-01T08:05:00Z</time>
      </trkpt>
      <trkpt lat="52.5400" lon="13.4150">
        <time>2026-06-01T08:10:00Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

    const result = parseGpx(xml);

    expect(result).not.toBeNull();
    expect(result?.points).toEqual([
      [13.405, 52.52],
      [13.41, 52.53],
      [13.415, 52.54],
    ]);
    expect(result?.startedAt).toEqual(new Date("2026-06-01T08:00:00Z"));
    expect(result?.endedAt).toEqual(new Date("2026-06-01T08:10:00Z"));
    expect(result?.name).toBe("Morning Ride");
  });

  it("case 2: multiple trkseg inside ONE trk join into one ordered point list — a naive first-segment-only parser fails this", () => {
    const xml = `<gpx>
  <trk>
    <trkseg>
      <trkpt lat="10" lon="20"><time>2026-01-01T00:00:00Z</time></trkpt>
      <trkpt lat="10.1" lon="20.1"><time>2026-01-01T00:01:00Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="11" lon="21"><time>2026-01-01T00:10:00Z</time></trkpt>
      <trkpt lat="11.1" lon="21.1"><time>2026-01-01T00:11:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

    const result = parseGpx(xml);

    expect(result).not.toBeNull();
    // All four points, from both segments, in file order — not just the first segment's two.
    expect(result?.points).toEqual([
      [20, 10],
      [20.1, 10.1],
      [21, 11],
      [21.1, 11.1],
    ]);
    expect(result?.startedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(result?.endedAt).toEqual(new Date("2026-01-01T00:11:00Z"));
  });

  it("case 3: rte/rtept only, no trk at all, is also accepted", () => {
    const xml = `<gpx>
  <rte>
    <name>Planned Route</name>
    <rtept lat="48.1" lon="11.5"></rtept>
    <rtept lat="48.2" lon="11.6"></rtept>
  </rte>
</gpx>`;

    const result = parseGpx(xml);

    expect(result).not.toBeNull();
    expect(result?.points).toEqual([
      [11.5, 48.1],
      [11.6, 48.2],
    ]);
    expect(result?.name).toBe("Planned Route");
    expect(result?.startedAt).toBeNull();
    expect(result?.endedAt).toBeNull();
  });

  it("case 4: trkpt elements with NO <time> still parse — startedAt and endedAt both null, points intact", () => {
    const xml = `<gpx>
  <trk>
    <trkseg>
      <trkpt lat="1" lon="2"></trkpt>
      <trkpt lat="3" lon="4"></trkpt>
    </trkseg>
  </trk>
</gpx>`;

    const result = parseGpx(xml);

    expect(result).not.toBeNull();
    expect(result?.points).toEqual([
      [2, 1],
      [4, 3],
    ]);
    expect(result?.startedAt).toBeNull();
    expect(result?.endedAt).toBeNull();
    expect(result?.name).toBeNull();
  });

  it("case 5: malformed XML returns null and never throws", () => {
    const unclosedTag = `<gpx><trk><trkseg><trkpt lat="1" lon="2"><trkpt></trkseg></trk></gpx>`;
    const notXmlAtAll = `{{{ not xml at all`;

    expect(() => parseGpx(unclosedTag)).not.toThrow();
    expect(parseGpx(unclosedTag)).toBeNull();

    expect(() => parseGpx(notXmlAtAll)).not.toThrow();
    expect(parseGpx(notXmlAtAll)).toBeNull();
  });

  it("case 6: an empty track, or a track with exactly one point, is null — one point is not a geometry", () => {
    const emptyTrack = `<gpx>
  <trk>
    <trkseg>
    </trkseg>
  </trk>
</gpx>`;
    const onePointTrack = `<gpx>
  <trk>
    <trkseg>
      <trkpt lat="1" lon="2"><time>2026-01-01T00:00:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

    expect(parseGpx(emptyTrack)).toBeNull();
    expect(parseGpx(onePointTrack)).toBeNull();
  });

  it("case 7: a trkpt with missing, non-numeric, or out-of-range lat/lon is dropped — the rest of the file survives", () => {
    const xml = `<gpx>
  <trk>
    <trkseg>
      <trkpt lat="10" lon="20"><time>2026-01-01T00:00:00Z</time></trkpt>
      <trkpt lat="abc" lon="20.5"><time>2026-01-01T00:01:00Z</time></trkpt>
      <trkpt lon="20.6"><time>2026-01-01T00:02:00Z</time></trkpt>
      <trkpt lat="95" lon="20.7"><time>2026-01-01T00:03:00Z</time></trkpt>
      <trkpt lat="10.5" lon="200"><time>2026-01-01T00:04:00Z</time></trkpt>
      <trkpt lat="11" lon="21"><time>2026-01-01T00:05:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

    const result = parseGpx(xml);

    expect(result).not.toBeNull();
    // Only the two well-formed points survive; the four bad rows are dropped, not the whole file.
    expect(result?.points).toEqual([
      [20, 10],
      [21, 11],
    ]);
    expect(result?.startedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(result?.endedAt).toEqual(new Date("2026-01-01T00:05:00Z"));
  });

  it("case 8: TWO top-level <trk> elements (merged/concatenated exports) join into one ordered point list", () => {
    const xml = `<gpx>
  <trk>
    <trkseg>
      <trkpt lat="1" lon="2"><time>2026-01-01T00:00:00Z</time></trkpt>
      <trkpt lat="1.1" lon="2.1"><time>2026-01-01T00:01:00Z</time></trkpt>
    </trkseg>
  </trk>
  <trk>
    <trkseg>
      <trkpt lat="5" lon="6"><time>2026-01-01T01:00:00Z</time></trkpt>
      <trkpt lat="5.1" lon="6.1"><time>2026-01-01T01:01:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

    const result = parseGpx(xml);

    expect(result).not.toBeNull();
    // Content AND order, not just a length check — a parser that only reads
    // the first <trk> would silently drop the second track's two points.
    expect(result?.points).toEqual([
      [2, 1],
      [2.1, 1.1],
      [6, 5],
      [6.1, 5.1],
    ]);
    expect(result?.startedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(result?.endedAt).toEqual(new Date("2026-01-01T01:01:00Z"));
  });

  it("case 9: a point count past the Math.min/max spread argument ceiling still computes the correct time window, not null", () => {
    const POINT_COUNT = 200_000;
    const baseMs = Date.parse("2026-01-01T00:00:00Z");

    // Two out-of-order timestamps planted mid-file (not first, not last) so
    // this cannot pass by accident via a first/last shortcut either — only a
    // real min/max over the whole array satisfies it.
    const MIN_INDEX = 50_000;
    const MAX_INDEX = 150_000;

    const trkptParts: string[] = new Array(POINT_COUNT);
    let expectedMinMs = Infinity;
    let expectedMaxMs = -Infinity;

    for (let i = 0; i < POINT_COUNT; i++) {
      let timeMs = baseMs + i * 1000;
      if (i === MIN_INDEX) timeMs = baseMs - 10_000_000_000;
      if (i === MAX_INDEX) timeMs = baseMs + 10_000_000_000;
      if (timeMs < expectedMinMs) expectedMinMs = timeMs;
      if (timeMs > expectedMaxMs) expectedMaxMs = timeMs;

      const lat = 50 + (i % 1000) * 0.0001;
      const lon = 10 + (i % 1000) * 0.0001;
      trkptParts[i] = `<trkpt lat="${lat}" lon="${lon}"><time>${new Date(timeMs).toISOString()}</time></trkpt>`;
    }

    const xml = `<gpx><trk><trkseg>${trkptParts.join("")}</trkseg></trk></gpx>`;

    const result = parseGpx(xml);

    expect(result).not.toBeNull();
    expect(result?.points.length).toBe(POINT_COUNT);
    expect(result?.startedAt).toEqual(new Date(expectedMinMs));
    expect(result?.endedAt).toEqual(new Date(expectedMaxMs));
  }, 30_000);
});
