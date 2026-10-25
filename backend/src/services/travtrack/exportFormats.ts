import { recordingToGpx } from "../tripRecording/gpx";
import { formatSafeCursor, readSafeTravTrack, type SafeCursor, type Span } from "./readSafe";

/**
 * TravTrack's history of a span as a file the owner takes away (TravTrack plan
 * T6): GPX 1.1 with one `<trkseg>` per stretch, or TravTrack's JSON —
 * `{ version: 1, origin: "travtrack", coverage, points, gaps, deletedRanges }`.
 * Both privacy-cut (`readSafe.ts`): what a zone hides is not in the file.
 *
 * Bounded at `EXPORT_POINT_CAP` points. Beyond it the answer says
 * `coverage: "truncated"` and names `next`, the first instant left out, and
 * `cursor`, the last point given, so a client asks again for `[next, to)`
 * after that cursor instead of taking a part for the whole — the route says
 * all three as headers, so a GPX part can be followed too.
 */

export const EXPORT_POINT_CAP = 200_000;

export type TravTrackExport = Awaited<ReturnType<typeof buildTravTrackExport>>;

export async function buildTravTrackExport(
  userId: string,
  window: Span,
  after: SafeCursor | null = null,
  cap: number = EXPORT_POINT_CAP
) {
  const read = await readSafeTravTrack(userId, window, cap, after);
  return {
    read,
    coverage: read.next ? ("truncated" as const) : ("complete" as const),
    next: read.next ? read.next.toISOString() : null,
    cursor: read.cursor ? formatSafeCursor(read.cursor) : null,
  };
}

export function travTrackExportJson(window: Span, built: TravTrackExport) {
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

export function travTrackExportGpx(name: string, built: TravTrackExport): string {
  return recordingToGpx(name, built.read.segments, {
    desc: `origin=travtrack; coverage=${built.coverage}`,
  });
}
