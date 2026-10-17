import type { Request } from "express";

import { CALENDAR_TOKEN_PATTERN } from "../../services/calendarFeed/token";
import { SHARE_TOKEN_PATTERN } from "../../services/shareLinks/token";

/**
 * The path a request was made to, for a log line: the FULL path (a router
 * sees only its own tail — `url: "/?limit=1"` told nobody which endpoint that
 * was) and NEVER the query string, which carries search terms, names and
 * booking references (`/flights?search=<PNR>`).
 *
 * A public share token is redacted wherever it appears (forgejo#281). The
 * token travels in a URL fragment and a POST body, never in a path — this is
 * the second line, for a client that puts it somewhere it should not.
 *
 * A calendar feed token DOES travel in the path (forgejo#310) — a calendar app
 * subscribes to a plain URL and can send nothing else — so it is redacted here
 * on every request, not as a second line.
 */
export function requestPathForLog(req: Pick<Request, "originalUrl" | "url">): string {
  const raw = req.originalUrl || req.url || "";
  const cut = raw.search(/[?#]/);
  const path = cut === -1 ? raw : raw.slice(0, cut);
  if (path.startsWith("/api/v1/geo-server/assets/")) return "/api/v1/geo-server/assets/[resource]";
  return path
    .replace(SHARE_TOKEN_PATTERN, "ts_share_[redacted]")
    .replace(CALENDAR_TOKEN_PATTERN, "ts_cal_[redacted]");
}
