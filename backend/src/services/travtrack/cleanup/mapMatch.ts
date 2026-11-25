import { boundedFetch, BoundedFetchError, type FetchLike } from "../../egress/boundedFetch";
import { decodePolyline } from "../../rail/railGeometryMath";
import type { StoredPoint } from "../../tripRecording/segments";
import type { ZoneCircle } from "../classify";
import { privacyCutBy } from "../privacyCut";

/**
 * Map matching of a sparse road stretch through the router the admin
 * configured (rc46 extras, part C2): a self-hosted Valhalla
 * (`trace_attributes`) or GraphHopper (`/match`). Nothing is preconfigured.
 *
 * - Privacy zones are cut out BEFORE anything is sent; each piece left is
 *   matched on its own, so no request carries a fix inside a zone, nor a
 *   chord across one.
 * - Only the stretch's own points go, never the day.
 * - A match below `MIN_CONFIDENCE` is not used: the stretch stays as
 *   recorded and the answer says why.
 * - The request goes through `boundedFetch` with the admin's LAN allowance
 *   (an admin-configured server, like the global Immich): DNS pinned per
 *   socket, no redirects, a time and a size cap.
 */

export const MIN_CONFIDENCE = 0.6;
export const MATCH_TIMEOUT_MS = 20_000;
const MATCH_MAX_BYTES = 4 * 1024 * 1024;
/** Fewer than this many fixes in a piece cannot be matched to a road. */
const MIN_PIECE_POINTS = 3;

export type MatchEngine = "valhalla" | "graphhopper";

export type MatchFailure =
  | "timeout"
  | "unreachable"
  | "privateTarget"
  | "invalidUrl"
  | "tooLarge"
  | "badResponse"
  | "lowConfidence"
  | "tooFewPoints";

export class MapMatchError extends Error {
  constructor(readonly reason: MatchFailure) {
    super(`Map matching failed: ${reason}`);
    this.name = "MapMatchError";
  }
}

export type MatchedPiece = { coordinates: [number, number][]; confidence: number };

/** The points that may leave: the stretch, privacy zones cut out, pieces too short dropped. */
export function pointsToSend(
  points: readonly StoredPoint[],
  circles: readonly ZoneCircle[]
): StoredPoint[][] {
  return privacyCutBy([points.slice()], circles, (p) => [p[2], p[1]]).filter(
    (piece) => piece.length >= MIN_PIECE_POINTS
  );
}

function requestFor(
  engine: MatchEngine,
  baseUrl: string,
  piece: readonly StoredPoint[]
): { url: string; body: string; headers: Record<string, string> } {
  const base = baseUrl.replace(/\/+$/, "");
  if (engine === "valhalla") {
    return {
      url: `${base}/trace_attributes`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shape: piece.map(([t, lat, lon]) => ({ lat, lon, time: Math.round(t / 1000) })),
        costing: "auto",
        shape_match: "map_snap",
        filters: { attributes: ["shape", "confidence_score"], action: "include" },
      }),
    };
  }
  const gpx =
    `<?xml version="1.0"?><gpx version="1.1" creator="TravStats"><trk><trkseg>` +
    piece
      .map(
        ([t, lat, lon]) =>
          `<trkpt lat="${lat}" lon="${lon}"><time>${new Date(t).toISOString()}</time></trkpt>`
      )
      .join("") +
    `</trkseg></trk></gpx>`;
  return {
    url: `${base}/match?profile=car&type=json&points_encoded=false`,
    headers: { "content-type": "application/gpx+xml" },
    body: gpx,
  };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null;

export function parseMatch(engine: MatchEngine, raw: unknown): MatchedPiece {
  if (!isObj(raw)) throw new MapMatchError("badResponse");
  if (engine === "valhalla") {
    const shape = raw.shape;
    const confidence = raw.confidence_score;
    if (typeof shape !== "string" || typeof confidence !== "number") {
      throw new MapMatchError("badResponse");
    }
    return { coordinates: decodePolyline(shape, 6), confidence };
  }
  const path = Array.isArray(raw.paths) ? raw.paths[0] : undefined;
  const coords = isObj(path) && isObj(path.points) ? path.points.coordinates : undefined;
  const mm = raw.map_matching;
  if (!Array.isArray(coords) || !isObj(mm)) throw new MapMatchError("badResponse");
  const d = Number(mm.distance);
  const od = Number(mm.original_distance);
  if (!Number.isFinite(d) || !Number.isFinite(od) || Math.max(d, od) <= 0) {
    throw new MapMatchError("badResponse");
  }
  // GraphHopper has no score; how far the matched length strays from the recorded one stands in.
  return {
    coordinates: coords
      .filter(
        (c): c is [number, number] =>
          Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number"
      )
      .map((c) => [c[0], c[1]]),
    confidence: Math.min(d, od) / Math.max(d, od),
  };
}

export async function matchPiece(
  engine: MatchEngine,
  baseUrl: string,
  piece: readonly StoredPoint[],
  fetchImpl?: FetchLike
): Promise<MatchedPiece> {
  const req = requestFor(engine, baseUrl, piece);
  let response;
  try {
    response = await boundedFetch(
      req.url,
      {
        method: "POST",
        headers: req.headers,
        body: req.body,
        // Admin-configured, like the global Immich: the LAN is where a self-hosted router lives.
        policy: { allowPrivate: true },
        timeoutMs: MATCH_TIMEOUT_MS,
        maxBytes: MATCH_MAX_BYTES,
      },
      fetchImpl
    );
  } catch (error) {
    if (error instanceof BoundedFetchError) throw new MapMatchError(error.reason);
    throw error;
  }
  if (response.status < 200 || response.status >= 300) throw new MapMatchError("badResponse");
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body.toString("utf8"));
  } catch {
    throw new MapMatchError("badResponse");
  }
  const match = parseMatch(engine, parsed);
  if (match.coordinates.length < 2) throw new MapMatchError("badResponse");
  return match;
}
