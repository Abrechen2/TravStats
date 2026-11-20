import { instanceTuning } from "../../instanceTuning";
import { fetchOpenData, isOpenDataEnabled, type OpenDataFailure } from "../../openData/http";
import { elementGeometry } from "../marketVisits/osm";
import { contains, type MarketArea } from "../marketVisits/geometry";
import type { CatalogStore } from "../marketVisits/catalog";
import { marketCatalogStore } from "../marketVisits/catalogStore";
import logger from "../../../utils/logger";
import { venueName, type VenueElement, type VenueEvidence, type VenueState } from "./venueRank";

/**
 * The OSM outlines and tags around a stay — the I/O half of building
 * recognition (see `venueRank.ts` for what they are used for).
 *
 * One Overpass question per stay card: "which buildings and named venue areas
 * contain these points" (`is_in` + `pivot`, so the answer is the few outlines
 * that matter, not every building within 300 m) plus the tags of the Photon
 * candidates by id. It goes through the same instance-tunable endpoint
 * (`marketOverpassUrl`), the same open-data switch and the same shared daily
 * budget / lease / back-off as the market scan (`marketCatalogStore`), and
 * requests are serialised so a screenful of cards cannot hammer Overpass.
 *
 * Caches: per OSM id (tags + outline) and per point cell (which outlines
 * contain it). Only a clean answer is cached — an outage is never remembered
 * as "no venues"; the failure reaches the caller as a fixed `VenueState`.
 */

const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";
const TIMEOUT_MS = 20_000;
const MAX_ELEMENTS = 400;
const CACHE_TTL_MS = 24 * 3_600_000;
const CACHE_MAX = 2_000;
/** Point cell: 5 decimals is about 1 m — containment stays exact enough. */
const CELL_DECIMALS = 5;
const RATE_LIMIT_BACKOFF_MS = 60_000;
const FAILURE_BACKOFF_MS = 30_000;

interface Timed<T> {
  value: T;
  expiresAt: number;
}
const elementCache = new Map<string, Timed<VenueElement>>();
const pointCache = new Map<string, Timed<{ refs: string[]; skipped: number }>>();

/** Test seam. */
export function clearVenueCaches(): void {
  elementCache.clear();
  pointCache.clear();
  tail = Promise.resolve();
}

/** Test seam: an outline evicted while its point entry lives on. */
export function clearElementCacheOnly(): void {
  elementCache.clear();
}

function remember<T>(cache: Map<string, Timed<T>>, key: string, value: T): void {
  if (cache.size >= CACHE_MAX && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function recall<T>(cache: Map<string, Timed<T>>, key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

const snap = (v: number): number => Number(v.toFixed(CELL_DECIMALS));
const cellKey = (p: { lat: number; lon: number }): string => `${snap(p.lat)},${snap(p.lon)}`;

type Raw = Record<string, unknown>;
const isRaw = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);

/** Overpass elements to venue elements; `skipped` counts outlines that could not be built. */
export function parseVenueElements(body: unknown): { elements: VenueElement[]; skipped: number } {
  if (!isRaw(body) || !Array.isArray(body.elements) || body.remark)
    throw new Error("Incomplete Overpass response");
  const elements: VenueElement[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const raw of body.elements) {
    if (!isRaw(raw) || !["node", "way", "relation"].includes(String(raw.type))) continue;
    if (!Number.isSafeInteger(raw.id)) continue;
    const ref = `${raw.type}/${raw.id}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const tags: Record<string, string> = {};
    if (isRaw(raw.tags))
      for (const [k, v] of Object.entries(raw.tags)) if (typeof v === "string") tags[k] = v;
    if (raw.type === "node") {
      const lat = Number(raw.lat),
        lon = Number(raw.lon);
      elements.push({
        ref,
        tags,
        area: null,
        point: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
      });
      continue;
    }
    try {
      const area: MarketArea = {
        id: ref,
        name: venueName(tags) || ref,
        sourceUrl: `https://www.openstreetmap.org/${ref}`,
        geometry: elementGeometry(raw),
      };
      elements.push({ ref, tags, area, point: null });
    } catch (error) {
      skipped++;
      logger.warn(
        { operation: "stay_venue_geometry_skipped", osmRef: ref, reason: (error as Error).message },
        "OSM outline skipped: geometry is incomplete"
      );
      elements.push({ ref, tags, area: null, point: null });
    }
  }
  return { elements, skipped };
}

const AREA_FILTERS = [
  `["building"]`,
  `["building:part"]`,
  `["name"][~"^(shop|amenity|tourism|leisure|office|craft|healthcare)$"~"."]`,
];

/** The Overpass QL for the given points and candidate ids. */
export function venueQuery(points: { lat: number; lon: number }[], refs: string[]): string {
  const parts: string[] = [`[out:json][timeout:15];`];
  const union: string[] = [];
  if (points.length > 0) {
    points.forEach((p, i) => parts.push(`is_in(${snap(p.lat)},${snap(p.lon)})->.a${i};`));
    parts.push(`(${points.map((_, i) => `.a${i};`).join("")})->.all;`);
    for (const filter of AREA_FILTERS)
      union.push(`way(pivot.all)${filter};`, `relation(pivot.all)${filter};`);
  }
  for (const type of ["node", "way", "relation"]) {
    const ids = refs.filter((r) => r.startsWith(`${type}/`)).map((r) => r.slice(type.length + 1));
    if (ids.length > 0) union.push(`${type}(id:${ids.join(",")});`);
  }
  parts.push(`(${union.join("")});`, `out tags geom ${MAX_ELEMENTS};`);
  return parts.join("\n");
}

const STATE_OF_FAILURE: Record<OpenDataFailure, VenueState> = {
  timeout: "timeout",
  rateLimited: "rateLimited",
  unavailable: "unavailable",
};

/** One request at a time, process-wide: the shared budget is per call, not per card. */
let tail: Promise<unknown> = Promise.resolve();
function serialised<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job);
  tail = run.catch(() => undefined);
  return run;
}

export interface VenueCandidateRef {
  /** `osm:node/1` as Photon names it, or undefined. */
  externalRef?: string;
  lat: number;
  lon: number;
}

const OSM_REF = /^osm:((?:node|way|relation)\/\d+)$/;
export const osmRefOf = (externalRef: string | undefined): string | null =>
  externalRef?.match(OSM_REF)?.[1] ?? null;

async function askOverpass(
  points: { lat: number; lon: number }[],
  refs: string[],
  store: CatalogStore
): Promise<
  | { ok: true; elements: VenueElement[]; skipped: number; truncated: boolean }
  | { ok: false; state: VenueState }
> {
  let token: Date | null;
  try {
    token = await store.claim(new Date());
  } catch (error) {
    logger.warn({ error }, "stay venues: the shared Overpass budget could not be read");
    return { ok: false, state: "unavailable" };
  }
  if (!token) return { ok: false, state: "budget" };
  let backoff = 0;
  let bytes = 0;
  try {
    const result = await fetchOpenData(
      "overpass",
      instanceTuning().marketOverpassUrl ?? DEFAULT_ENDPOINT,
      {
        form: { data: venueQuery(points, refs) },
        timeoutMs: TIMEOUT_MS,
      }
    );
    if (!result.ok) {
      backoff = result.failure === "rateLimited" ? RATE_LIMIT_BACKOFF_MS : FAILURE_BACKOFF_MS;
      return { ok: false, state: STATE_OF_FAILURE[result.failure] };
    }
    bytes = JSON.stringify(result.body).length;
    try {
      const parsed = parseVenueElements(result.body);
      // `out … N` cuts silently at N: containers may be missing from a full answer.
      return { ok: true, ...parsed, truncated: parsed.elements.length >= MAX_ELEMENTS };
    } catch {
      // A 200 with a `remark` is Overpass saying the query ran out of time or memory.
      backoff = FAILURE_BACKOFF_MS;
      return { ok: false, state: "unavailable" };
    }
  } finally {
    try {
      await store.complete(token, bytes, backoff);
    } catch (error) {
      logger.warn({ error }, "stay venues: releasing the shared Overpass lease failed");
    }
  }
}

/**
 * The outlines and tags around a stay point and its candidates. Never throws
 * for an upstream problem: it answers with the reason as `state` and no
 * elements, and the ranking falls back to what it had before.
 */
export async function fetchVenueEvidence(
  point: { lat: number; lon: number },
  candidates: VenueCandidateRef[],
  store: CatalogStore = marketCatalogStore
): Promise<VenueEvidence> {
  if (!(await isOpenDataEnabled())) return { state: "off", elements: [] };

  const refByCandidate = candidates.map((c) => osmRefOf(c.externalRef));
  // Points whose containing outlines matter: the stay and every candidate node.
  const points = [point, ...candidates.filter((c) => !c.externalRef?.match(/\/(way|relation)\//))];
  const unique = [...new Map(points.map((p) => [cellKey(p), p])).values()];
  const refs = [...new Set(refByCandidate.filter((r): r is string => r !== null))];

  const run = async (): Promise<VenueEvidence> => {
    // A cached point is only good while every outline it names is still cached.
    const intact = (p: { lat: number; lon: number }): boolean => {
      const entry = recall(pointCache, cellKey(p));
      return entry !== null && entry.refs.every((r) => recall(elementCache, r) !== null);
    };
    const missingPoints = unique.filter((p) => !intact(p));
    const missingRefs = refs.filter((r) => recall(elementCache, r) === null);
    let state: VenueState = "ok";
    const wanted = new Set<string>(refs);
    if (missingPoints.length > 0 || missingRefs.length > 0) {
      const answer = await askOverpass(missingPoints, missingRefs, store);
      if (!answer.ok) return { state: answer.state, elements: [] };
      for (const el of answer.elements) remember(elementCache, el.ref, el);
      if (answer.truncated) state = "partial";
      // A cut answer is shown but not remembered as the full set of containers.
      for (const p of answer.truncated ? [] : missingPoints) {
        const containers = answer.elements
          .filter((el) => el.area && contains(el.area, snap(p.lon), snap(p.lat)))
          .map((el) => el.ref);
        remember(pointCache, cellKey(p), { refs: containers, skipped: answer.skipped });
      }
      if (answer.skipped > 0) state = "partial";
      if (answer.truncated)
        for (const p of missingPoints)
          for (const el of answer.elements)
            if (el.area && contains(el.area, snap(p.lon), snap(p.lat))) wanted.add(el.ref);
    }
    for (const p of unique) {
      const entry = recall(pointCache, cellKey(p));
      if (entry === null) continue;
      entry.refs.forEach((r) => wanted.add(r));
      if (entry.skipped > 0) state = "partial";
    }
    const elements: VenueElement[] = [];
    for (const ref of wanted) {
      const el = recall(elementCache, ref);
      if (el) elements.push(el);
    }
    return { state, elements };
  };
  return serialised(run);
}
