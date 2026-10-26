import type { StoredPoint } from "./segments";

/**
 * A trip recording as GPX 1.1 (forgejo#316): the RAW points, every one with
 * its time, one `<trkseg>` per stretch — a gap stays a gap in any other
 * program too. Nothing is simplified: this is the copy of the record a person
 * takes away. The phone's accuracy has no GPX element of its own (`hdop` is a
 * dilution, not metres) and is left out rather than mislabelled.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function recordingToGpx(
  name: string,
  segments: readonly StoredPoint[][],
  opts: { desc?: string } = {}
): string {
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
    `    <name>${escapeXml(name)}</name>`,
    ...(opts.desc ? [`    <desc>${escapeXml(opts.desc)}</desc>`] : []),
    ...(first ? [`    <time>${new Date(first[0]).toISOString()}</time>`] : []),
    `  </metadata>`,
    `  <trk>`,
    `    <name>${escapeXml(name)}</name>`,
    ...body,
    `  </trk>`,
    `</gpx>`,
  ].join("\n");
}
