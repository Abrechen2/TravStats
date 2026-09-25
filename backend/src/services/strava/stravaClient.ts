import type { ParsedTrack } from "../tour/tracks/parseGpx";
import { StravaError } from "./stravaErrors";

/**
 * The Strava HTTP API — only the four calls the integration needs.
 *
 * Global `fetch`, not axios, mirroring the Dawarich client, so tests inject
 * `fetch` and never touch the network. Every call is time-boxed: a hung
 * Strava must not hang the request that asked it.
 */

const API = "https://www.strava.com/api/v3";
const OAUTH = "https://www.strava.com/oauth";
const TIMEOUT_MS = 15_000;

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch seconds, as Strava sends it. */
  expiresAt: number;
  athleteId: string | null;
  scope: string | null;
}

export interface StravaActivitySummary {
  id: string;
  name: string;
  sportType: string;
  startDate: string;
  distanceKm: number;
  movingSeconds: number;
  ascentM: number | null;
  /** False for an indoor workout — nothing to draw, nothing to import. */
  hasRoute: boolean;
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new StravaError("unreachable", "Strava did not answer");
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res: Response): Promise<unknown> {
  if (res.status === 401 || res.status === 403) {
    throw new StravaError("auth", "Strava refused the credentials", res.status);
  }
  if (res.status === 404) throw new StravaError("notFound", "Not found on Strava", 404);
  if (res.status === 429) throw new StravaError("rateLimited", "Strava rate limit reached", 429);
  if (res.status >= 500) throw new StravaError("unreachable", "Strava failed", res.status);
  if (!res.ok) throw new StravaError("protocol", `Strava answered ${res.status}`, res.status);
  try {
    return await res.json();
  } catch {
    throw new StravaError("protocol", "Strava answered with unreadable JSON");
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toTokens(body: unknown): StravaTokens {
  if (
    !isRecord(body) ||
    typeof body.access_token !== "string" ||
    typeof body.refresh_token !== "string" ||
    typeof body.expires_at !== "number"
  ) {
    throw new StravaError("protocol", "Strava's token answer is missing fields");
  }
  const athlete = isRecord(body.athlete) ? body.athlete : null;
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_at,
    athleteId: athlete && athlete.id !== undefined ? String(athlete.id) : null,
    scope: typeof body.scope === "string" ? body.scope : null,
  };
}

export async function exchangeCode(
  client: { id: string; secret: string },
  code: string
): Promise<StravaTokens> {
  const res = await call(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: client.id,
      client_secret: client.secret,
      code,
      grant_type: "authorization_code",
    }),
  });
  return toTokens(await readJson(res));
}

export async function refreshTokens(
  client: { id: string; secret: string },
  refreshToken: string
): Promise<StravaTokens> {
  const res = await call(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: client.id,
      client_secret: client.secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  return toTokens(await readJson(res));
}

/** Best effort: a failed revoke must not keep the user connected locally. */
export async function deauthorize(accessToken: string): Promise<void> {
  try {
    await call(`${OAUTH}/deauthorize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // The local tokens are dropped either way; Strava forgets them on expiry.
  }
}

/** Activities in a window, newest first, one page of up to 50. */
export async function listActivities(
  accessToken: string,
  window: { after?: Date; before?: Date }
): Promise<StravaActivitySummary[]> {
  const params = new URLSearchParams({ per_page: "50" });
  if (window.after) params.set("after", String(Math.floor(window.after.getTime() / 1000)));
  if (window.before) params.set("before", String(Math.floor(window.before.getTime() / 1000)));
  const res = await call(`${API}/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await readJson(res);
  if (!Array.isArray(body))
    throw new StravaError("protocol", "Strava's activity list is not a list");
  return body.filter(isRecord).map((a) => {
    const map = isRecord(a.map) ? a.map : null;
    return {
      id: String(a.id),
      name: typeof a.name === "string" ? a.name : "",
      sportType: typeof a.sport_type === "string" ? a.sport_type : String(a.type ?? ""),
      startDate: typeof a.start_date === "string" ? a.start_date : "",
      distanceKm: typeof a.distance === "number" ? a.distance / 1000 : 0,
      movingSeconds: typeof a.moving_time === "number" ? a.moving_time : 0,
      ascentM: typeof a.total_elevation_gain === "number" ? a.total_elevation_gain : null,
      hasRoute: typeof map?.summary_polyline === "string" && map.summary_polyline.length > 0,
    };
  });
}

/**
 * One activity's recording as a `ParsedTrack` — the same shape a GPX file
 * becomes, so everything after it (raw distance, climb, moving time,
 * simplification) is the one pipeline every other source goes through.
 */
export async function fetchActivityTrack(
  accessToken: string,
  activityId: string
): Promise<{ track: ParsedTrack; name: string; sportType: string }> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const activity = await readJson(await call(`${API}/activities/${activityId}`, { headers }));
  if (!isRecord(activity) || typeof activity.start_date !== "string") {
    throw new StravaError("protocol", "Strava's activity answer is missing its start");
  }
  const streams = await readJson(
    await call(
      `${API}/activities/${activityId}/streams?keys=latlng,time,altitude&key_by_type=true`,
      { headers }
    )
  );
  const data = (key: string): unknown[] | null => {
    if (!isRecord(streams)) return null;
    const s = streams[key];
    return isRecord(s) && Array.isArray(s.data) ? s.data : null;
  };
  const latlng = data("latlng");
  if (!latlng || latlng.length < 2) {
    throw new StravaError("protocol", "This activity has no GPS route to import");
  }
  const time = data("time");
  const altitude = data("altitude");
  const start = Date.parse(activity.start_date);

  const points: Array<[number, number]> = [];
  const elevations: Array<number | null> = [];
  const times: Array<number | null> = [];
  latlng.forEach((p, i) => {
    if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number") return;
    points.push([p[1], p[0]]);
    const alt = altitude?.[i];
    elevations.push(typeof alt === "number" ? alt : null);
    const offset = time?.[i];
    times.push(typeof offset === "number" ? start + offset * 1000 : null);
  });
  // Strava's time stream is seconds since the start, in order. Without it the
  // activity's own elapsed time still places the recording in time.
  const known = times.filter((t): t is number => t !== null);
  const elapsed = typeof activity.elapsed_time === "number" ? activity.elapsed_time : 0;
  return {
    track: {
      points,
      segmentStarts: [0],
      startedAt: new Date(known.length ? known[0] : start),
      endedAt: new Date(known.length ? known[known.length - 1] : start + elapsed * 1000),
      name: typeof activity.name === "string" ? activity.name : null,
      elevations,
      times,
    },
    name: typeof activity.name === "string" ? activity.name : "",
    sportType: typeof activity.sport_type === "string" ? activity.sport_type : "",
  };
}
