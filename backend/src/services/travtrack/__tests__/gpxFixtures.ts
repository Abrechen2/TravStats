/**
 * GPX files for the TravTrack import suites. Not a test file (no `.test.ts`
 * suffix).
 */

export type GpxFix = { t?: string; lat: number; lon: number; ele?: number };

/** A GPX 1.1 file with one `<trk>` and one `<trkseg>` per segment. */
export function gpxFile(segments: GpxFix[][], name = "Walk"): Buffer {
  const seg = (fixes: GpxFix[]) =>
    `<trkseg>${fixes
      .map(
        (f) =>
          `<trkpt lat="${f.lat}" lon="${f.lon}">` +
          (f.ele !== undefined ? `<ele>${f.ele}</ele>` : "") +
          (f.t ? `<time>${f.t}</time>` : "") +
          `</trkpt>`
      )
      .join("")}</trkseg>`;
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">` +
      `<trk><name>${name}</name>${segments.map(seg).join("")}</trk></gpx>`,
    "utf8"
  );
}

/** One fix a minute from `startIso`, stepping east. */
export function minuteFixes(startIso: string, count: number, lat = 37.5665, lon = 126.978) {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) => ({
    t: new Date(start + i * 60_000).toISOString(),
    lat,
    lon: Number((lon + i * 0.001).toFixed(6)),
  }));
}

/** The billion-laughs shape: entities expanding into entities. */
export const BILLION_LAUGHS = Buffer.from(
  `<?xml version="1.0"?>\n<!DOCTYPE gpx [\n<!ENTITY lol "lol">\n` +
    Array.from(
      { length: 9 },
      (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i === 0 ? "" : i};`.repeat(10)}">`
    ).join("\n") +
    `\n]>\n<gpx version="1.1"><trk><name>&lol9;</name><trkseg>` +
    `<trkpt lat="1" lon="1"><time>2026-10-12T01:00:00Z</time></trkpt>` +
    `<trkpt lat="1.1" lon="1.1"><time>2026-10-12T01:01:00Z</time></trkpt>` +
    `</trkseg></trk></gpx>`,
  "utf8"
);

/** An external entity pointing at a local file (XXE). */
export const XXE = Buffer.from(
  `<?xml version="1.0"?>\n<!DOCTYPE gpx [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n` +
    `<gpx version="1.1"><trk><name>&xxe;</name><trkseg>` +
    `<trkpt lat="1" lon="1"><time>2026-10-12T01:00:00Z</time></trkpt>` +
    `<trkpt lat="1.1" lon="1.1"><time>2026-10-12T01:01:00Z</time></trkpt>` +
    `</trkseg></trk></gpx>`,
  "utf8"
);
