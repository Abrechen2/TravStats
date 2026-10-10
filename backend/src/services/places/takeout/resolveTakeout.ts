import { getApiKey } from "../../apiKeyResolver";
import { photonRequest, type PlaceResult } from "../../geo/photon";
import type { ReportProgress } from "../../jobs/jobRegistry";
import type {
  PlaceImportResolution,
  PositionReason,
  ResolveRow,
  ResolvedPosition,
  ResolvedRow,
  TakeoutTrip,
} from "../../../schemas/placeImportResolve";
import { cidFromRef, lookupPlaceByCid, type CidLookup } from "./googleCidLookup";
import { classifyTakeoutKind, suggestTreatment } from "./takeoutKind";
import {
  countryOfListName,
  photoVisitDay,
  soleTripIntoCountry,
  stayAtPosition,
} from "./takeoutTrip";

/**
 * Resolve a Google Takeout list for the place import preview (#358).
 *
 * Runs as a background job (`placeImport.resolve`): 350 rows of Google lookups
 * and photo searches outlast the browser's ten-second request, and a timeout
 * reported as "failed" while the server finishes is the defect the job
 * registry exists to end.
 *
 * Bounded on every axis: at most `GOOGLE_CONCURRENCY` Google requests at once,
 * each with its own deadline; the keyless name search one at a time, spaced
 * for Photon's fair use and capped at `MAX_NAME_SEARCHES` per run. A refused
 * key or an exhausted quota stops further Google calls — every remaining row
 * carries that same reason rather than 300 more refusals.
 *
 * Nothing here writes. Each answer is a suggestion with its source, or a
 * reason it is missing, for the preview to show.
 */

export const GOOGLE_CONCURRENCY = 4;
/** One run's ceiling on keyless name searches — about five minutes of Photon. */
export const MAX_NAME_SEARCHES = 300;
const PHOTON_MIN_INTERVAL_MS = 1_100;
const PHOTON_LIMIT = 10;

/** Reasons after which asking Google again cannot help this run. */
const STOP_REASONS: ReadonlySet<PositionReason> = new Set(["auth", "quota"]);

export type NameSearch = (name: string) => Promise<PlaceResult[] | null>;

export interface ResolveDeps {
  /** Injected for tests; defaults to Place Details with the instance key. */
  lookupCid?: (cid: string, key: string) => Promise<CidLookup>;
  /** Injected for tests; defaults to a throttled Photon search. */
  searchName?: NameSearch;
  googleKey?: string | null;
}

function throttledPhotonSearch(): NameSearch {
  let last = -Infinity;
  let queue: Promise<unknown> = Promise.resolve();
  return (name) => {
    const run = queue.then(async () => {
      const wait = last + PHOTON_MIN_INTERVAL_MS - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = performance.now();
      return photonRequest("search", { q: name }, PHOTON_LIMIT);
    });
    queue = run.catch(() => undefined);
    return run;
  };
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

interface PositionAnswer {
  position: ResolvedPosition | null;
  cidReason: PositionReason | null;
  positionReason: PositionReason | null;
  googleTypes: string[] | null;
  osmType: string | null;
}

export async function resolveTakeoutList(
  userId: string,
  listName: string | null,
  rows: readonly ResolveRow[],
  reportProgress: ReportProgress = () => undefined,
  deps: ResolveDeps = {}
): Promise<PlaceImportResolution> {
  const key = deps.googleKey !== undefined ? deps.googleKey : await getApiKey("googlePlaces");
  const lookupCid = deps.lookupCid ?? ((cid: string, k: string) => lookupPlaceByCid(cid, k));
  const searchName = deps.searchName ?? throttledPhotonSearch();

  const listCountry = countryOfListName(listName);
  const { trip, reason: tripReason } = await soleTripIntoCountry(userId, listCountry);

  let googleStopped: PositionReason | null = null;
  let nameSearches = 0;

  const viaCid = async (row: ResolveRow): Promise<CidLookup> => {
    const cid = cidFromRef(row.externalRef);
    if (!cid) return { ok: false, reason: "no_cid" };
    if (!key) return { ok: false, reason: "no_key" };
    if (googleStopped) return { ok: false, reason: googleStopped };
    const answer = await lookupCid(cid, key);
    if (!answer.ok && STOP_REASONS.has(answer.reason)) googleStopped = answer.reason;
    return answer;
  };

  const viaName = async (
    row: ResolveRow
  ): Promise<{ hit: PlaceResult | null; reason: PositionReason | null }> => {
    // "Inside the list's country" is the only thing that makes a name search
    // safe: unbounded, "Hotel St. Martin" lands in Rome for a Bavarian list.
    if (!listCountry) return { hit: null, reason: "no_country" };
    if (nameSearches >= MAX_NAME_SEARCHES) return { hit: null, reason: "limit_reached" };
    nameSearches += 1;
    const results = await searchName(row.name);
    if (results === null) return { hit: null, reason: "geocoder_unavailable" };
    const hit = results.find((r) => r.countryCode?.toUpperCase() === listCountry) ?? null;
    return { hit, reason: hit ? null : "not_in_country" };
  };

  const locate = async (row: ResolveRow): Promise<PositionAnswer> => {
    const cid = await viaCid(row);
    if (cid.ok) {
      const p = cid.place;
      return {
        position: {
          lat: p.lat,
          lon: p.lon,
          source: "google_cid",
          address: p.address,
          city: p.city,
          country: p.country,
        },
        cidReason: null,
        positionReason: null,
        googleTypes: p.types,
        osmType: null,
      };
    }
    const named = await viaName(row);
    if (!named.hit) {
      return {
        position: null,
        cidReason: cid.reason,
        positionReason: named.reason,
        googleTypes: null,
        osmType: null,
      };
    }
    const h = named.hit;
    return {
      position: {
        lat: h.lat,
        lon: h.lon,
        source: "name_search",
        address: h.address ?? null,
        city: h.city ?? null,
        country: h.country ?? null,
      },
      cidReason: cid.reason,
      positionReason: null,
      googleTypes: null,
      osmType: h.type ?? null,
    };
  };

  let done = 0;
  reportProgress(0, rows.length);

  const resolveOne = async (row: ResolveRow): Promise<ResolvedRow> => {
    const own =
      typeof row.lat === "number" && typeof row.lon === "number"
        ? { lat: row.lat, lon: row.lon }
        : null;
    // A row that already carries a position is not looked up again: the file
    // said where it is, and a lookup could only contradict it.
    const located: PositionAnswer = own
      ? { position: null, cidReason: null, positionReason: null, googleTypes: null, osmType: null }
      : await locate(row);
    const where = own ?? located.position;
    const kind = classifyTakeoutKind({
      name: row.name,
      googleTypes: located.googleTypes,
      osmType: located.osmType,
    });
    const day = await photoVisitDay(userId, trip, where);
    const matchedStay =
      kind === "lodging" && trip && where ? await stayAtPosition(userId, trip.id, where) : null;
    done += 1;
    reportProgress(done, rows.length);
    return {
      sourceRowIndex: row.sourceRowIndex,
      position: located.position,
      cidReason: located.cidReason,
      positionReason: located.positionReason,
      kind,
      suggestedTreatment: suggestTreatment(kind, {
        hasTrip: trip !== null,
        hasMatchedStay: matchedStay !== null,
      }),
      visitDay: day.visitDay,
      visitDayReason: day.reason,
      matchedStay,
    };
  };

  const resolved = await mapLimit(rows, GOOGLE_CONCURRENCY, resolveOne);
  return {
    listCountry,
    trip: trip satisfies TakeoutTrip | null,
    tripReason,
    googleConfigured: key !== null,
    rows: resolved,
  };
}
