// Where a new roadtrip can start from besides an empty form: a GPX file or a
// Google / Apple Maps link. Both are read here as plain data; the dialog adds
// the user-facing words. Every refusal carries its REASON, so the dialog says
// what was wrong with the file or the link instead of "could not read".

/** The most stations a roadtrip holds (the server's station list cap). */
export const MAX_START_STATIONS = 300;

/** A point a source named; `title` is "" when the source gave no name. */
export interface StartPoint {
  title: string;
  lat: number;
  lon: number;
}

/** A waypoint the link names but gives no coordinates for — it must be looked up. */
export interface NamedWaypoint {
  name: string;
}

export type GpxFailure = "notXml" | "notGpx" | "noPoints" | "tooMany";

export type GpxResult =
  | { ok: true; points: StartPoint[]; from: "route" | "waypoints" | "track" }
  | { ok: false; reason: GpxFailure; count?: number };

const validPoint = (lat: number, lon: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

function pointsOf(doc: Document, tag: string): StartPoint[] {
  const out: StartPoint[] = [];
  for (const el of Array.from(doc.getElementsByTagName(tag))) {
    const lat = Number(el.getAttribute("lat"));
    const lon = Number(el.getAttribute("lon"));
    if (!validPoint(lat, lon)) continue;
    // Only the point's own <name>, not a child's.
    const nameEl = Array.from(el.children).find((c) => c.tagName === "name");
    out.push({ title: nameEl?.textContent?.trim() ?? "", lat, lon });
  }
  return out;
}

/**
 * The stations a GPX file describes: a planned route (`rte`) first, else its
 * waypoints (`wpt`), else — a recorded track — where the track starts and ends.
 * A file with none of them says so; a file over the station cap is refused
 * rather than cut, because a cut roadtrip would look complete.
 */
export function parseGpxStations(text: string): GpxResult {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return { ok: false, reason: "notXml" };
  if (doc.documentElement.tagName !== "gpx") return { ok: false, reason: "notGpx" };

  let from: "route" | "waypoints" | "track" = "route";
  let points = pointsOf(doc, "rtept");
  if (points.length === 0) {
    from = "waypoints";
    points = pointsOf(doc, "wpt");
  }
  if (points.length === 0) {
    from = "track";
    const track = pointsOf(doc, "trkpt");
    if (track.length >= 2) points = [track[0], track[track.length - 1]];
    else points = track;
  }
  if (points.length === 0) return { ok: false, reason: "noPoints" };
  if (points.length > MAX_START_STATIONS) {
    return { ok: false, reason: "tooMany", count: points.length };
  }
  return { ok: true, points, from };
}

export type MapsLinkFailure = "notALink" | "notMaps" | "shortLink" | "noWaypoints" | "tooMany";

export type MapsLinkWaypoint = StartPoint | NamedWaypoint;

export type MapsLinkResult =
  { ok: true; waypoints: MapsLinkWaypoint[] } | { ok: false; reason: MapsLinkFailure };

const COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** "48.1,11.5" → a point; any other text → a name to look up; empty → nothing. */
function asWaypoint(raw: string): MapsLinkWaypoint | null {
  const text = raw.replace(/\+/g, " ").trim();
  if (text === "") return null;
  const m = COORD.exec(text);
  if (m) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (validPoint(lat, lon)) return { title: "", lat, lon };
  }
  return { name: text };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

const SHORT_HOSTS = new Set(["goo.gl", "maps.app.goo.gl", "g.co", "maps.apple"]);

/** Waypoints named in the query: Google `origin/waypoints/destination`, either's `saddr/daddr`. */
function fromQuery(params: URLSearchParams): MapsLinkWaypoint[] {
  const parts: string[] = [];
  const origin = params.get("origin") ?? params.get("saddr");
  if (origin) parts.push(origin);
  const via = params.get("waypoints");
  if (via) parts.push(...via.split("|"));
  const dest = params.get("destination") ?? params.get("daddr");
  // Apple writes several stops into one daddr: "A to:B to:C".
  if (dest) parts.push(...dest.split(/\s+to:/i));
  return parts.map(asWaypoint).filter((w): w is MapsLinkWaypoint => w !== null);
}

/** Google's `/maps/dir/A/B/C/` path: every segment before `@…` or `data=…` is a stop. */
function fromDirPath(pathname: string): MapsLinkWaypoint[] {
  const m = /\/maps\/dir\/(.*)$/.exec(pathname);
  if (!m) return [];
  return m[1]
    .split("/")
    .filter((seg) => seg !== "" && !seg.startsWith("@") && !seg.startsWith("data="))
    .map((seg) => asWaypoint(safeDecode(seg)))
    .filter((w): w is MapsLinkWaypoint => w !== null);
}

/**
 * The precise coordinates Google writes into `data=`: `!3d<lat>!4d<lon>` for a
 * place, `!1d<lon>!2d<lat>` for a route stop, in order of appearance. Used only
 * when their number equals the number of stops — anything else (a viewport
 * also writes `!1d`) is not trusted.
 */
function fromData(text: string): StartPoint[] {
  const out: StartPoint[] = [];
  const num = "(-?\\d+(?:\\.\\d+)?)";
  const re = new RegExp(`!3d${num}!4d${num}|!1d${num}!2d${num}`, "g");
  for (const m of text.matchAll(re)) {
    const lat = Number(m[1] ?? m[4]);
    const lon = Number(m[2] ?? m[3]);
    if (validPoint(lat, lon)) out.push({ title: "", lat, lon });
  }
  return out;
}

/** A single place: `/maps/place/Name/@lat,lon`, `?ll=`, `?q=lat,lon`, `?q=Name&ll=`. */
function fromPlace(url: URL): MapsLinkWaypoint[] {
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url.pathname);
  const placeName = /\/maps\/place\/([^/@]+)/.exec(url.pathname);
  const name = placeName ? safeDecode(placeName[1]) : (url.searchParams.get("q") ?? "");
  const ll = url.searchParams.get("ll") ?? url.searchParams.get("center");
  const coords = ll ? asWaypoint(ll) : at ? asWaypoint(`${at[1]},${at[2]}`) : null;
  if (coords && "lat" in coords) {
    const named = asWaypoint(name);
    return [{ ...coords, title: named && "name" in named ? named.name : "" }];
  }
  const q = url.searchParams.get("q");
  const w = q ? asWaypoint(q) : null;
  return w ? [w] : [];
}

/**
 * The waypoints a Google or Apple Maps link carries, read generically from the
 * URL: the route form (`dir/A/B`, `origin/destination/waypoints`, `saddr/daddr`)
 * with the exact points of `data=` replacing named stops where the counts
 * agree, else a single place. A short link (`maps.app.goo.gl/…`) cannot be read
 * — the browser may not follow it and the address is not in the text — and says
 * so; so does a link with no waypoint in it.
 */
export function parseMapsLink(input: string): MapsLinkResult {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: "notALink" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { ok: false, reason: "notALink" };
  const host = url.hostname.replace(/^www\./, "");
  if (SHORT_HOSTS.has(host) || (host === "maps.apple.com" && url.pathname.startsWith("/p/"))) {
    return { ok: false, reason: "shortLink" };
  }
  const google = /(^|\.)google\.[a-z.]+$/.test(host) && url.pathname.startsWith("/maps");
  const apple = host === "maps.apple.com";
  if (!google && !apple) return { ok: false, reason: "notMaps" };

  let waypoints: MapsLinkWaypoint[] = fromQuery(url.searchParams);
  if (waypoints.length === 0) waypoints = fromDirPath(url.pathname);
  if (waypoints.length > 0) {
    // The exact points of `data=` beat a typed name, one per stop, in order.
    const exact = fromData(url.pathname + url.search);
    if (exact.length === waypoints.length) {
      waypoints = waypoints.map((w, i) => ("name" in w ? { ...exact[i], title: w.name } : w));
    }
  } else {
    waypoints = fromPlace(url);
    if (waypoints.length === 0) {
      const exact = fromData(url.pathname + url.search);
      waypoints = exact.length > 0 ? exact : [];
    }
  }
  if (waypoints.length === 0) return { ok: false, reason: "noWaypoints" };
  if (waypoints.length > MAX_START_STATIONS) return { ok: false, reason: "tooMany" };
  return { ok: true, waypoints };
}
