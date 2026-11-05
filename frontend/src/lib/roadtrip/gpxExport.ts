import { escapeXml } from "../export";
import type { RoadtripStation } from "../../types/roadtrip";
import type { TourGeometry } from "../../types/tour";
import { dayKey } from "./roadtripView";

/**
 * A roadtrip as a GPX 1.1 file: its stations as waypoints (route corrections
 * are no stop and stay out), the legs' lines as one track segment per leg in
 * travel order. Coordinates are written as stored — nothing is rounded or
 * dropped, and a leg with no geometry is simply no segment.
 */
export function buildRoadtripGpx(
  name: string,
  stations: readonly RoadtripStation[],
  geometry: TourGeometry | null
): string {
  const wpts = stations
    .filter((s) => s.state !== "via" && s.lat !== null && s.lon !== null)
    .map((s) => {
      const day = dayKey(s.startDate);
      return [
        `  <wpt lat="${s.lat}" lon="${s.lon}">`,
        `    <name>${escapeXml(s.title)}</name>`,
        // The day, as text: a station is dated by calendar day, not by instant.
        ...(day ? [`    <desc>${day}</desc>`] : []),
        `    <type>${s.state}</type>`,
        `  </wpt>`,
      ].join("\n");
    });
  const segments = (geometry?.features ?? [])
    .filter((f) => f.geometry.coordinates.length > 0)
    .map((f) =>
      [
        `    <trkseg>`,
        ...f.geometry.coordinates.map(([lon, lat]) => `      <trkpt lat="${lat}" lon="${lon}"/>`),
        `    </trkseg>`,
      ].join("\n")
    );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="TravStats" xmlns="http://www.topografix.com/GPX/1/1">`,
    `  <metadata><name>${escapeXml(name)}</name></metadata>`,
    ...wpts,
    ...(segments.length > 0
      ? [`  <trk>`, `    <name>${escapeXml(name)}</name>`, ...segments, `  </trk>`]
      : []),
    `</gpx>`,
    ``,
  ].join("\n");
}

/** A file name from the roadtrip's name: letters, digits and dashes only. */
export function gpxFileName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `${slug || "roadtrip"}.gpx`;
}
