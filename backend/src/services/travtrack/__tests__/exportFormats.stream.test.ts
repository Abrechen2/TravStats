import { PassThrough } from "stream";

import { describe, it, expect } from "@jest/globals";

import { jsonChunks, pipeTextToResponse } from "../../export/jsonStream";
import type { StoredPoint } from "../../tripRecording/segments";
import { travTrackExportGpx, travTrackExportJson, type TravTrackExport } from "../exportFormats";

/** The pre-forgejo#357 implementation, verbatim, as the reference the stream must equal. */
function oldJson(window: { fromMs: number; untilMs: number }, built: TravTrackExport) {
  const { read } = built;
  return {
    version: 1 as const,
    origin: "travtrack" as const,
    from: new Date(window.fromMs).toISOString(),
    to: new Date(window.untilMs).toISOString(),
    coverage: built.coverage,
    next: built.next,
    cursor: built.cursor,
    points: read.segments.flatMap((segment, index) =>
      segment.map((p) => {
        const row = read.rowOf(p);
        return {
          t: new Date(p[0]).toISOString(),
          lat: p[1],
          lon: p[2],
          accuracy: p[3],
          altitude: row?.altitudeM ?? null,
          speed: row?.speedMps ?? null,
          course: row?.course ?? null,
          deviceId: row?.deviceId ?? null,
          origin: row?.origin ?? null,
          purpose: row?.purpose ?? "everyday",
          segment: index,
        };
      })
    ),
    gaps: read.paused.map((g) => ({
      from: new Date(g.fromMs).toISOString(),
      to: new Date(g.untilMs).toISOString(),
      reason: g.reason,
      deviceId: g.deviceId,
    })),
    deletedRanges: read.deleted.map((d) => ({
      from: new Date(d.fromMs).toISOString(),
      to: new Date(d.untilMs).toISOString(),
    })),
  };
}

/** The pre-forgejo#357 recordingToGpx, verbatim (array of lines joined by newline). */
function oldGpx(name: string, segments: StoredPoint[][], desc: string): string {
  const first = segments[0]?.[0];
  const body = segments.map((segment) => {
    const points = segment.map(
      ([t, lat, lon]) =>
        `      <trkpt lat="${lat}" lon="${lon}"><time>${new Date(t).toISOString()}</time></trkpt>`
    );
    return `    <trkseg>\n${points.join("\n")}\n    </trkseg>`;
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="TravStats" xmlns="http://www.topografix.com/GPX/1/1">`,
    `  <metadata>`,
    `    <name>${name}</name>`,
    `    <desc>${desc}</desc>`,
    ...(first ? [`    <time>${new Date(first[0]).toISOString()}</time>`] : []),
    `  </metadata>`,
    `  <trk>`,
    `    <name>${name}</name>`,
    ...body,
    `  </trk>`,
    `</gpx>`,
  ].join("\n");
}

const T0 = Date.UTC(2026, 9, 12, 3, 0);
const seg1: StoredPoint[] = [
  [T0, 37.5, 127, 5],
  [T0 + 60_000, 37.51, 127.01, null],
];
const seg2: StoredPoint[] = [[T0 + 3 * 3_600_000, 35.1, 129, 8]];
const rows = new Map<StoredPoint, Record<string, unknown>>([
  [
    seg1[0],
    {
      altitudeM: 12,
      speedMps: 1.5,
      course: 90,
      deviceId: "p1",
      origin: "companion:p1",
      purpose: "trip",
    },
  ],
]);

const built = {
  read: {
    segments: [seg1, seg2],
    rowOf: (p: StoredPoint) => rows.get(p),
    circles: [],
    deleted: [{ fromMs: T0 + 100, untilMs: T0 + 200 }],
    paused: [{ fromMs: T0 + 300, untilMs: T0 + 400, deviceId: "p1", reason: 'perm "x"' }],
    next: null,
    cursor: null,
  },
  coverage: "complete" as const,
  next: null,
  cursor: null,
} as unknown as TravTrackExport;
const window = { fromMs: T0, untilMs: T0 + 24 * 3_600_000 };

async function text(source: Iterable<string> | AsyncIterable<string>) {
  let out = "";
  for await (const piece of source) out += piece;
  return out;
}

describe("TravTrack export formats stream without changing (forgejo#357)", () => {
  it("JSON: the streamed text equals the old JSON.stringify of the old structure", async () => {
    const streamed = await text(jsonChunks(travTrackExportJson(window, built)));
    expect(streamed).toBe(JSON.stringify(oldJson(window, built)));
  });

  it("GPX: the streamed pieces concatenate to the old single string", async () => {
    const old = oldGpx(
      "TravTrack 2026-10-12",
      built.read.segments,
      "origin=travtrack; coverage=complete"
    );
    expect(await text(travTrackExportGpx("TravTrack 2026-10-12", built))).toBe(old);
    expect(old).toContain('<trkpt lat="37.5" lon="127">');
  });

  it("GPX: a failure mid-stream aborts the response instead of ending it cleanly", async () => {
    function* broken() {
      yield "<gpx>";
      throw new Error("boom");
    }
    const res = new PassThrough();
    res.resume();
    await expect(pipeTextToResponse(broken(), res)).rejects.toThrow("boom");
    expect(res.destroyed).toBe(true);
  });
});
