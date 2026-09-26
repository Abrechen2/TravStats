import type { Request } from "express";

/**
 * The path a request was made to, for a log line: the FULL path (a router
 * sees only its own tail — `url: "/?limit=1"` told nobody which endpoint that
 * was) and NEVER the query string, which carries search terms, names and
 * booking references (`/flights?search=<PNR>`).
 */
export function requestPathForLog(req: Pick<Request, "originalUrl" | "url">): string {
  const raw = req.originalUrl || req.url || "";
  const cut = raw.search(/[?#]/);
  return cut === -1 ? raw : raw.slice(0, cut);
}
