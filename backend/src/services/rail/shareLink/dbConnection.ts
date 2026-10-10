import { z } from "zod";

import logger from "../../../utils/logger";
import { RAIL_LOOKUP_TIMEOUT_MS, railUserAgent } from "../lookup/railHttp";
import type { ParsedRailBooking, ParsedRailLeg, RailTravelClassValue } from "../parser/types";

/**
 * Fetching the connection behind a bahn.de share link (forgejo#204).
 *
 * The request is the one bahn.de's own page makes
 * (`GET /web/api/angebote/verbindung/{vbid}`, JSON) — one plain request, with
 * no cookie replay and no browser imitation. The feasibility check of
 * 2026-10-06 found every such request answered `403 OPS_BLOCKED` by Akamai's
 * bot protection; getting past it would mean running the challenge script or
 * faking a browser, which is treated as breaking the site's terms. So the
 * likely outcome today is `blocked`, and that is reported AS blocked — the
 * user is never told the link "could not be found" when it was refused.
 *
 * Bounded: one request, `RAIL_LOOKUP_TIMEOUT_MS`, a body cap, and a strict
 * shape. No valid answer has been observed yet; the shape below is the one
 * bahn.de's web client reads (`verbindungsAbschnitte`). Anything else is
 * `unreadable`, never a half-read ride.
 */

export const DB_CONNECTION_URL = "https://www.bahn.de/web/api/angebote/verbindung/";
/** A connection is a few kB; a page this size is not one. */
export const MAX_BODY_BYTES = 512 * 1024;

export const SHARE_LINK_FAILURES = [
  /** Not a link at all, or a bahn.de link without a connection in it. */
  "invalidLink",
  /** A link to a site no reader exists for. */
  "unsupportedLink",
  /** bahn.de refused the request (bot protection) — the link may be fine. */
  "blocked",
  /** bahn.de does not know the connection (any more). */
  "expired",
  "rateLimited",
  /** bahn.de answered with an error of its own. */
  "providerError",
  "timeout",
  /** No answer at all: DNS, connection, TLS. */
  "unreachable",
  /** An answer, but not a connection this reader can read. */
  "unreadable",
  /** A connection without a single train in it (a walk only). */
  "noTrain",
] as const;
export type ShareLinkFailure = (typeof SHARE_LINK_FAILURES)[number];

const transport = z
  .object({
    name: z.string().max(60).optional(),
    kurzText: z.string().max(30).optional(),
    mittelText: z.string().max(60).optional(),
    nummer: z.string().max(20).optional(),
    typ: z.string().max(40).optional(),
  })
  .passthrough();

const DB_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?/;

const section = z
  .object({
    abfahrtsOrt: z.string().min(1).max(120),
    ankunftsOrt: z.string().min(1).max(120),
    abfahrtsZeitpunkt: z.string().regex(DB_TIME),
    ankunftsZeitpunkt: z.string().regex(DB_TIME).optional(),
    verkehrsmittel: transport.optional(),
  })
  .passthrough();

const connection = z
  .object({ verbindungsAbschnitte: z.array(section).min(1).max(30) })
  .passthrough();

const answerSchema = z.union([
  z.object({ verbindung: connection }).passthrough(),
  z.object({ verbindungen: z.array(connection).min(1) }).passthrough(),
  connection,
]);
type Connection = z.infer<typeof connection>;
type Section = z.infer<typeof section>;

const wallClock = (value: string): string => {
  const m = DB_TIME.exec(value)!;
  return `${m[1]}T${m[2]}`;
};

/** A walk, a transfer or a section without a vehicle is no train ride. */
function isTrain(s: Section): boolean {
  const t = s.verkehrsmittel;
  if (!t) return false;
  if (t.typ && /walk|fuss|transfer/i.test(t.typ)) return false;
  return Boolean(t.name || t.kurzText || t.nummer);
}

/** "ICE 578" → ICE / 578; a number only when printed — never invented. */
function trainOf(s: Section): { category: string | null; number: string | null } {
  const t = s.verkehrsmittel ?? {};
  const named = /^([A-Za-zÄÖÜäöü]{1,8})\s*(\d{1,6})$/.exec((t.name ?? "").trim());
  if (named) return { category: named[1], number: named[2] };
  return {
    category: t.kurzText?.trim() || null,
    number: t.nummer && /^\d{1,6}$/.test(t.nummer.trim()) ? t.nummer.trim() : null,
  };
}

function legOf(s: Section): ParsedRailLeg {
  const train = trainOf(s);
  return {
    depStationName: s.abfahrtsOrt.trim(),
    arrStationName: s.ankunftsOrt.trim(),
    departureLocal: wallClock(s.abfahrtsZeitpunkt),
    arrivalLocal: s.ankunftsZeitpunkt ? wallClock(s.ankunftsZeitpunkt) : null,
    trainCategory: train.category,
    trainNumber: train.number,
    coach: null,
    seat: null,
    direction: null,
  };
}

/**
 * The connection as a booking the rail review understands. A share link
 * carries a timetable connection, not a purchase: there is no booking
 * reference and no price, and none is made up. The class comes from the link.
 */
export function bookingFromConnection(
  c: Connection,
  travelClass: RailTravelClassValue | null
): ParsedRailBooking | null {
  const legs = c.verbindungsAbschnitte.filter(isTrain).map(legOf);
  if (legs.length === 0) return null;
  return {
    bookingReference: null,
    travelClass,
    tariff: null,
    price: null,
    currency: null,
    operator: null,
    legs,
    source: "db-share-link",
  };
}

export type DbFetchResult =
  { ok: true; connection: Connection } | { ok: false; reason: ShareLinkFailure };

function failureForStatus(status: number, body: string): ShareLinkFailure {
  if (status === 403 || /OPS_BLOCKED/.test(body)) return "blocked";
  if (status === 404 || status === 410) return "expired";
  if (status === 429) return "rateLimited";
  return "providerError";
}

async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  const buffer = await response.arrayBuffer();
  return buffer.byteLength > MAX_BODY_BYTES ? null : new TextDecoder().decode(buffer);
}

export async function fetchDbConnection(
  vbid: string,
  timeoutMs = RAIL_LOOKUP_TIMEOUT_MS
): Promise<DbFetchResult> {
  let response: Response;
  try {
    response = await fetch(`${DB_CONNECTION_URL}${encodeURIComponent(vbid)}`, {
      headers: { "User-Agent": railUserAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    logger.warn({
      operation: "rail_share_link",
      reason: timedOut ? "timeout" : "unreachable",
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: timedOut ? "timeout" : "unreachable" };
  }
  const body = await readCapped(response).catch(() => null);
  if (!response.ok) {
    const reason = failureForStatus(response.status, body ?? "");
    logger.warn({ operation: "rail_share_link", status: response.status, reason });
    return { ok: false, reason };
  }
  if (body === null) return { ok: false, reason: "unreadable" };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    logger.warn({ operation: "rail_share_link", reason: "not_json" });
    return { ok: false, reason: "unreadable" };
  }
  const parsed = answerSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn({
      operation: "rail_share_link",
      reason: "unexpected_shape",
      issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return { ok: false, reason: "unreadable" };
  }
  const data = parsed.data;
  const found =
    "verbindung" in data
      ? (data.verbindung as Connection)
      : "verbindungen" in data
        ? (data.verbindungen as Connection[])[0]
        : (data as Connection);
  return { ok: true, connection: found };
}
