/**
 * Read-only wrapper around the Dawarich REST API.
 *
 * Pinned to **Dawarich 1.9.2**, measured 2026-08-29 against the owner's own
 * running instance (`ct108-dawarich`) — not assumed. This is the ONLY file
 * that knows Dawarich's paths and payload shapes; when the contract shifts,
 * this file is the entire blast radius. Pull only — nothing here writes to
 * Dawarich.
 *
 * Four measured shapes that will silently corrupt data if missed:
 *  1. `GET /api/v1/points` answers with a BARE JSON array, not `{ points: [] }`.
 *  2. `latitude` / `longitude` come back as STRINGS. `[p.longitude, p.latitude]`
 *     without parsing yields a tuple of strings — every distance downstream
 *     becomes NaN or a concatenation, and nothing throws.
 *  3. `timestamp` is Unix SECONDS, not milliseconds.
 *  4. Points come back NEWEST FIRST. Handed onward in response order, a track
 *     built from them runs backwards in time — the same failure
 *     `adoptSegment`'s reversal case exists to prevent, arriving from a
 *     different direction. `getPoints` sorts ascending before returning.
 *
 * Auth: Dawarich accepts both `?api_key=` and `Authorization: Bearer <key>`.
 * This client only ever sends the header — a key in a query string lands in
 * access logs and proxy caches, which this repo already forbids for
 * sensitive values.
 *
 * `start_at` / `end_at` are the only window parameters Dawarich actually
 * reads; `from`/`to` and `start_date`/`end_date` are silently ignored and
 * the server answers with its newest points instead of an error. Do not
 * "simplify" these parameter names.
 *
 * Uses the global `fetch`, not axios (mirrors `services/fx/frankfurter.ts`),
 * so tests inject `fetch` directly and never touch the network.
 */
import logger from "../../utils/logger";
import { DawarichConnection, DawarichError } from "./errors";

const POINTS_PATH = "/api/v1/points";
const HEALTH_PATH = "/api/v1/health";
/** Measured: `per_page=100000` returned a full day (1243 rows) with no error,
 * so there is no small server-side ceiling — but a multi-day window is
 * unbounded on our end, so this client paginates anyway. */
const PAGE_SIZE = 1000;
/** Hard stop so a misbehaving server (or a huge window) can never spin us forever. */
const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 15_000;

export interface DawarichHealth {
  reachable: true;
  /** From the `x-dawarich-version` response header, e.g. "1.9.2". Null if absent. */
  version: string | null;
}

/** Inclusive on both ends, as Dawarich treats `start_at`/`end_at`. */
export interface DawarichPointsWindow {
  startAt: Date;
  endAt: Date;
}

export interface DawarichPoint {
  id: number;
  /** Parsed from Dawarich's string field. Guaranteed finite. */
  latitude: number;
  /** Parsed from Dawarich's string field. Guaranteed finite. */
  longitude: number;
  /** Milliseconds since epoch — converted from Dawarich's Unix SECONDS. */
  timestampMs: number;
  altitude: number | null;
  accuracy: number | null;
  velocity: number | null;
  trackId: number | null;
}

export interface DawarichPointsResult {
  /** Every point collected, sorted ASCENDING by timestamp. */
  points: DawarichPoint[];
  /**
   * `true` when the window held MORE points than `MAX_PAGES * PAGE_SIZE`
   * could collect — the result covers only the newest slice of the
   * requested window (Dawarich's measured newest-first ordering), never
   * the whole thing. Callers MUST propagate this rather than only logging
   * it — a stored track with `truncated: true` is a partial measurement,
   * not the complete one its `distanceKm` would otherwise imply.
   */
  truncated: boolean;
}

export interface DawarichClient {
  /** Unauthenticated reachability probe — `GET /api/v1/health`, no key needed. */
  checkHealth(): Promise<DawarichHealth>;
  /**
   * Every point in `[startAt, endAt]`, paginated, sorted ASCENDING by
   * timestamp regardless of the order Dawarich returned them in.
   */
  getPoints(window: DawarichPointsWindow): Promise<DawarichPointsResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Parse a Dawarich numeric field that may arrive as a string (latitude,
 * longitude, velocity) or a number (altitude, accuracy, id). REJECTS on the
 * parsed value itself (`Number.isFinite`), never on a comparison against the
 * raw input — comparing against `NaN` silently loses every branch, which is
 * exactly the trap this guards against.
 */
function toFiniteNumberOrNull(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toFiniteIntOrNull(value: unknown): number | null {
  const parsed = toFiniteNumberOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function toDawarichError(status: number, context: string): DawarichError {
  if (status === 401 || status === 403) {
    return new DawarichError("auth", "Dawarich rejected the API key", status);
  }
  if (status === 404) {
    return new DawarichError("notFound", `Dawarich resource not found (${context})`, status);
  }
  if (status >= 500) {
    return new DawarichError("unreachable", `Dawarich is unreachable (${context})`, status);
  }
  return new DawarichError("protocol", `Dawarich returned ${status} for ${context}`, status);
}

/**
 * A point with no usable coordinate or timestamp is unusable downstream —
 * drop it here (consistent with `immichClient.ts`'s `mapAsset`) rather than
 * fail the whole page for one bad row.
 */
function mapPoint(raw: unknown): DawarichPoint | null {
  if (!isRecord(raw) || typeof raw.id !== "number") return null;

  const latitude = toFiniteNumberOrNull(raw.latitude);
  const longitude = toFiniteNumberOrNull(raw.longitude);
  const timestampSeconds = toFiniteNumberOrNull(raw.timestamp);
  if (latitude === null || longitude === null || timestampSeconds === null) return null;

  return {
    id: raw.id,
    latitude,
    longitude,
    timestampMs: timestampSeconds * 1000,
    altitude: toFiniteNumberOrNull(raw.altitude),
    accuracy: toFiniteNumberOrNull(raw.accuracy),
    velocity: toFiniteNumberOrNull(raw.velocity),
    trackId: toFiniteIntOrNull(raw.track_id),
  };
}

export function createDawarichClient(conn: DawarichConnection): DawarichClient {
  const authHeaders = { Authorization: `Bearer ${conn.apiKey}` };

  async function request(path: string, params: URLSearchParams | null, withAuth: boolean) {
    const query = params ? `?${params.toString()}` : "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${conn.baseUrl}${path}${query}`, {
        headers: withAuth ? authHeaders : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      // Anything fetch throws here (connection refused, DNS failure, our own
      // abort on timeout) means the host never answered at all.
      logger.warn({
        message: "dawarich_client_unreachable",
        context: { endpoint: path, error: error instanceof Error ? error.message : error },
      });
      throw new DawarichError("unreachable", `Dawarich is unreachable (${path})`);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async checkHealth(): Promise<DawarichHealth> {
      const response = await request(HEALTH_PATH, null, false);
      const version = response.headers.get("x-dawarich-version");
      if (!response.ok) throw toDawarichError(response.status, "health");

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new DawarichError("protocol", "Dawarich health check returned no JSON body");
      }
      if (!isRecord(data) || data.status !== "ok") {
        throw new DawarichError(
          "protocol",
          "Dawarich health check returned an unexpected payload",
        );
      }
      return { reachable: true, version };
    },

    async getPoints({ startAt, endAt }: DawarichPointsWindow): Promise<DawarichPointsResult> {
      const collected: DawarichPoint[] = [];
      let truncated = false;

      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const params = new URLSearchParams({
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          page: String(page),
          per_page: String(PAGE_SIZE),
        });

        const response = await request(POINTS_PATH, params, true);
        if (!response.ok) throw toDawarichError(response.status, `points page=${page}`);

        let data: unknown;
        try {
          data = await response.json();
        } catch {
          throw new DawarichError("protocol", "Dawarich returned no JSON body for points");
        }
        if (!Array.isArray(data)) {
          throw new DawarichError(
            "protocol",
            "Dawarich returned an unexpected points payload — expected a bare array",
          );
        }

        for (const raw of data) {
          const mapped = mapPoint(raw);
          if (mapped) collected.push(mapped);
        }

        if (data.length < PAGE_SIZE) break;
        // Dawarich still had more to give, but we hit the hard cap — a
        // partial result served with the same confidence as a full one would
        // be a silent data-loss bug.
        if (page === MAX_PAGES) truncated = true;
      }

      if (truncated) {
        logger.warn({
          message: "dawarich_points_truncated",
          context: { maxPages: MAX_PAGES, collectedCount: collected.length },
        });
      }

      // Dawarich returns points NEWEST FIRST (measured). Every leg later
      // adopted from this array assumes chronological order, so sort
      // ascending here once rather than trust every caller to remember.
      const points = [...collected].sort((a, b) => a.timestampMs - b.timestampMs);
      return { points, truncated };
    },
  };
}
