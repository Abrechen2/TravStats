/**
 * Trip auto-detection — runs heuristics over a user's existing trip-less
 * flights and groups them into trips. Designed for bulk-import flows
 * (xlsx, CSV, AI-agent batch) and as a recovery path for legacy data.
 *
 * Philosophy (since the trip-selection overhaul): a Trip is a container
 * for a real JOURNEY, not a mirror of a booking. A plain out-and-back
 * booking (2 legs) does not need a trip — flights are first-class
 * without one. Every heuristic therefore only proposes clusters of at
 * least MIN_TRIP_FLIGHTS (3) flights ("Rule of Three"); smaller groups
 * stay trip-less. Users can always create a trip manually.
 *
 * Heuristic stack (in order — first match wins per flight):
 *   1. PNR cluster — flights sharing `bookingReference`, group span <= 30
 *      days. The 30-day cap drops frequent-flyer-IDs (e.g. literal
 *      "WITTKE" appearing on a year of unrelated bookings) that the
 *      original /flights/batch heuristic would falsely glue together.
 *      → AUTO-LINK (intent is unambiguous: shared PNR = shared booking).
 *
 *   2. Home loop — sequences that start and end at the user's home
 *      airport (using `getHomeAirportAt(date)` so historical home moves
 *      are respected). Catches the Hawaii 2013 case (HNL→LIH→KOA→OGG
 *      over 3 weeks with separate carriers and PNRs but a clear MUC→…→MUC
 *      shape).
 *      → PROPOSE (caller decides whether to commit).
 *
 *   3. Continuity sliding window — consecutive flights where the previous
 *      arrival IATA equals (or is co-located with, "open jaw") the next
 *      departure IATA, and the ground gap is <= 7 days. 7d is the
 *      conservative midpoint between Gemini's 3-7d recommendation and
 *      the Hawaii loop's 3-day inter-island layovers.
 *      → PROPOSE.
 *
 * Cancelled-leg suppression: rows with the same (dep_iata, departure
 * date) as another row in the cluster are de-duplicated before grouping
 * — typically these are rebooked legs the user logged twice.
 *
 * Orphan cleanup: at the end, trips with zero linked flights are
 * deleted in the same transaction. Catches state from earlier failed
 * import iterations that left empty trips behind.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { TRIP_COLORS } from "../schemas/trip";
import { calculateDistance } from "../utils/geo";
import { type HomeAirportEntry, getHomeAirportAt, normalizeHistory } from "../utils/homeAirport";
import logger from "../utils/logger";
import { fillTripDatesFromSegments, recomputeTripStatus } from "./tripStatusService";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PNR_MAX_SPAN_DAYS = 30;
const CONTINUITY_GAP_DAYS = 7;
const OPEN_JAW_KM = 200; // arr-IATA → next-dep-IATA same metro area
// "Rule of Three": a simple out-and-back booking (2 legs) is a booking,
// not a journey — never propose a trip for it. Only multi-leg clusters
// (>= 3 flights) are journey-shaped enough to suggest a trip container.
const MIN_TRIP_FLIGHTS = 3;

interface FlightLite {
  id: string;
  bookingReference: string | null;
  departureTime: Date | null;
  depIata: string | null;
  arrIata: string | null;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  flightNumber: string | null;
  status: string;
}

/** One leg of a proposed trip, surfaced so the review UI can expand a
 *  detected trip into its constituent flights. */
export interface ProposedTripLeg {
  date: string;
  flightNumber: string | null;
  depIata: string | null;
  arrIata: string | null;
  status: string;
}

export interface ProposedTrip {
  source: "pnr" | "home_loop" | "continuity";
  flightIds: string[];
  pnr: string | null;
  origin: string;
  destination: string;
  span: { from: string; to: string };
  suggestedName: string;
  /** Per-leg detail for the review modal's expandable card. Ordered by
   *  departure time. */
  legs: ProposedTripLeg[];
}

export interface DetectionResult {
  proposed: ProposedTrip[];
  /** Filled only when committed (dryRun === false). */
  created: Array<{ tripId: string; flightIds: string[]; pnr: string | null }>;
  orphansRemoved: number;
}

/** Caller-supplied proposal for the review-flow commit path: the user
 *  may keep the auto-suggested name or override it, and may also
 *  rearrange flightIds (filtering / re-grouping). The server still
 *  enforces ownership + tripId=null in the transaction. */
export interface ReviewProposal {
  flightIds: string[];
  name: string;
  pnr?: string | null;
  source?: ProposedTrip["source"];
}

interface DetectOptions {
  userId: string;
  dryRun: boolean;
  /** When provided in commit mode (dryRun=false), commit ONLY these
   *  proposals (with the supplied names) — do not re-run detection.
   *  When omitted in commit mode, fall back to legacy "commit all
   *  auto-detected proposals" behaviour. */
  selectedProposals?: ReviewProposal[];
}

/** Public entry point. */
export async function detectTrips(opts: DetectOptions): Promise<DetectionResult> {
  const { userId, dryRun, selectedProposals } = opts;

  // Review-flow commit: trust the client's selection (server still
  // enforces ownership inside the transaction). Skip re-running
  // detection entirely so renamed proposals don't get clobbered.
  if (!dryRun && selectedProposals) {
    const proposals: ProposedTrip[] = selectedProposals.map((p) => ({
      source: p.source ?? "continuity",
      flightIds: p.flightIds,
      pnr: p.pnr ?? null,
      origin: "?",
      destination: "?",
      span: { from: "", to: "" },
      suggestedName: p.name,
      legs: [],
    }));
    const committed = await commitProposals(userId, proposals);
    return await finalizeWithCleanup(committed, userId, dryRun);
  }

  const dbFlights = await prisma.flight.findMany({
    where: { userId, tripId: null },
    orderBy: { departureTime: "asc" },
    select: {
      id: true,
      bookingReference: true,
      departureTime: true,
      depIata: true,
      arrIata: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      flightNumber: true,
      status: true,
    },
  });

  // Re-sort same-day flights by chain coherence so the home-loop and
  // continuity heuristics see DATE_ONLY return-day legs in the order
  // the user actually flew them, not in the order their default UTC
  // timestamps happen to fall. See `chainCoherentSort` for the full
  // rationale (issue #104).
  const flights = chainCoherentSort(dbFlights);

  if (flights.length === 0) {
    return await finalizeWithCleanup({ proposed: [], created: [], orphansRemoved: 0 }, userId, dryRun);
  }

  const homeHistory = await loadHomeHistory(userId);

  const claimed = new Set<string>();
  const proposed: ProposedTrip[] = [];

  // Stage 1 — PNR cluster (auto-linkable)
  const pnrGroups = groupByPnr(flights);
  for (const [pnr, group] of pnrGroups) {
    if (group.length < MIN_TRIP_FLIGHTS) continue;
    const dedup = dropCancelledDuplicates(group);
    if (dedup.length < MIN_TRIP_FLIGHTS) continue;
    const span = spanDays(dedup);
    if (span > PNR_MAX_SPAN_DAYS) {
      logger.info({
        operation: "trip_detect_pnr_skip",
        message: `Dropped PNR ${pnr} — span ${span}d > ${PNR_MAX_SPAN_DAYS}d (likely frequent-flyer ID, not a booking)`,
        context: { userId, pnr, flightCount: dedup.length, spanDays: span },
      });
      continue;
    }
    proposed.push(makeProposal("pnr", dedup, pnr));
    dedup.forEach((f) => claimed.add(f.id));
  }

  // Stage 2 — Home loop (propose). Sub-threshold loops stay unclaimed
  // so their flights remain visible to stage 3 (where they still can't
  // form a >= MIN_TRIP_FLIGHTS cluster on their own, but may extend one).
  const remaining1 = flights.filter((f) => !claimed.has(f.id));
  for (const cluster of findHomeLoops(remaining1, homeHistory)) {
    if (cluster.length < MIN_TRIP_FLIGHTS) continue;
    proposed.push(makeProposal("home_loop", cluster, null));
    cluster.forEach((f) => claimed.add(f.id));
  }

  // Stage 3 — Continuity sliding window (propose)
  const remaining2 = flights.filter((f) => !claimed.has(f.id));
  for (const cluster of findContinuityClusters(remaining2)) {
    if (cluster.length < MIN_TRIP_FLIGHTS) continue;
    proposed.push(makeProposal("continuity", cluster, null));
    cluster.forEach((f) => claimed.add(f.id));
  }

  let result: DetectionResult = { proposed, created: [], orphansRemoved: 0 };

  if (!dryRun) {
    result = await commitProposals(userId, proposed);
  }

  return await finalizeWithCleanup(result, userId, dryRun);
}

// ─── Helpers (exported for unit tests) ────────────────────────────────

export const _internals = {
  PNR_MAX_SPAN_DAYS,
  CONTINUITY_GAP_DAYS,
  OPEN_JAW_KM,
  MIN_TRIP_FLIGHTS,
  groupByPnr,
  dropCancelledDuplicates,
  spanDays,
  findHomeLoops,
  findContinuityClusters,
  chainCoherentSort,
};

function groupByPnr(flights: FlightLite[]): Map<string, FlightLite[]> {
  const out = new Map<string, FlightLite[]>();
  for (const f of flights) {
    const pnr = f.bookingReference?.trim();
    if (!pnr) continue;
    const list = out.get(pnr) ?? [];
    list.push(f);
    out.set(pnr, list);
  }
  return out;
}

/**
 * Drop entries that share `(dep_iata, departure-date)` — typically a
 * cancelled-then-rebooked leg the user logged twice. Keeps the earliest
 * one (lowest id, deterministic) so the heuristic doesn't generate
 * 0-min "stopovers" that break continuity windowing.
 */
function dropCancelledDuplicates(flights: FlightLite[]): FlightLite[] {
  const seen = new Map<string, FlightLite>();
  for (const f of flights) {
    const key = `${f.depIata}-${f.departureTime ? toYmd(f.departureTime) : "?"}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()];
}

function spanDays(flights: FlightLite[]): number {
  const dates = flights.map((f) => f.departureTime?.getTime()).filter((t): t is number => typeof t === "number");
  if (dates.length === 0) return 0;
  return Math.round((Math.max(...dates) - Math.min(...dates)) / MS_PER_DAY);
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Find sequences of flights that start AND end at the user's home airport
 * (looked up at each flight's date — so historical home-moves are
 * respected). Returns each loop as a contiguous slice; flights between
 * loops are left for stage 3.
 */
function findHomeLoops(flights: FlightLite[], history: HomeAirportEntry[] | null): FlightLite[][] {
  const loops: FlightLite[][] = [];
  let current: FlightLite[] = [];
  let loopHome: string | null = null;

  for (const f of flights) {
    if (!f.departureTime || !f.depIata || !f.arrIata) continue;
    const home = getHomeAirportAt(history, toYmd(f.departureTime));
    if (!home) continue;

    if (current.length === 0) {
      if (f.depIata === home) {
        current = [f];
        loopHome = home;
      }
      continue;
    }

    current.push(f);
    if (f.arrIata === loopHome) {
      // Loop closes
      loops.push(current);
      current = [];
      loopHome = null;
    }
  }

  return loops;
}

/**
 * Sliding-window continuity grouping. A cluster grows while:
 *   - next.depIata === prev.arrIata (exact match), OR
 *   - the IATA pair is within OPEN_JAW_KM coord distance (open-jaw
 *     allowance — user took ground transport between two same-metro
 *     airports), AND
 *   - departure-to-departure gap (next.dep - prev.dep) <= CONTINUITY_GAP_DAYS.
 *     We measure dep-to-dep because arrivalTime is not always populated
 *     (DATE_ONLY rows leave it equal to departureTime); a 7-day window
 *     is generous enough that the dep-vs-arr difference doesn't matter.
 */
function findContinuityClusters(flights: FlightLite[]): FlightLite[][] {
  const out: FlightLite[][] = [];
  let current: FlightLite[] = [];

  for (const f of flights) {
    if (!f.departureTime) continue;
    if (current.length === 0) {
      current = [f];
      continue;
    }
    const prev = current[current.length - 1];
    if (!prev.departureTime || !prev.arrIata || !f.depIata) {
      out.push(current);
      current = [f];
      continue;
    }

    const sameOrOpenJaw =
      prev.arrIata === f.depIata ||
      calculateDistance(prev.arrLat, prev.arrLon, f.depLat, f.depLon) <= OPEN_JAW_KM;

    const gapDays = (f.departureTime.getTime() - prev.departureTime.getTime()) / MS_PER_DAY;

    if (sameOrOpenJaw && gapDays <= CONTINUITY_GAP_DAYS) {
      current.push(f);
    } else {
      out.push(current);
      current = [f];
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Re-order same-day flights by chain coherence.
 *
 * `findMany` orders by `departureTime asc`, which is correct when the
 * timestamps are accurate. For DATE_ONLY rows, manually entered
 * round-trips can have default times that don't reflect the within-day
 * chain — e.g. Norberts MUC↺RAK on 2009-09-21 stores RAK→MAD with
 * `dep=12:00 UTC` and MAD→MUC with `dep=10:00 UTC`, so a raw timestamp
 * sort puts the connecting anchor BEFORE the return leg. The home-loop
 * walker then closes the loop early and orphans the return (issue #104).
 *
 * Fix: within each calendar date, run Kahn's topological sort using
 * arr→dep airport matches as the chain dependency. Multi-day order is
 * preserved; days with no chain ambiguity (single flight, or chain
 * already in timestamp order) are unaffected. Flights without a
 * departureTime stay at the end, mirroring the existing heuristics.
 */
function chainCoherentSort<T extends FlightLite>(flights: T[]): T[] {
  const withTime = flights.filter((f) => f.departureTime != null);
  const withoutTime = flights.filter((f) => f.departureTime == null);

  const byDay = new Map<string, T[]>();
  for (const fl of withTime) {
    const key = toYmd(fl.departureTime as Date);
    const arr = byDay.get(key) ?? [];
    arr.push(fl);
    byDay.set(key, arr);
  }

  const out: T[] = [];
  for (const day of [...byDay.keys()].sort()) {
    out.push(...sortDayByChain(byDay.get(day) as T[]));
  }
  out.push(...withoutTime);
  return out;
}

function sortDayByChain<T extends FlightLite>(day: T[]): T[] {
  if (day.length <= 1) return day;

  const n = day.length;
  const inDegree = new Array<number>(n).fill(0);
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (
        day[i].arrIata &&
        day[j].depIata &&
        day[i].arrIata === day[j].depIata
      ) {
        adj[i].push(j);
        inDegree[j]++;
      }
    }
  }

  const byDepTime = (a: number, b: number): number =>
    (day[a].departureTime?.getTime() ?? 0) -
    (day[b].departureTime?.getTime() ?? 0);

  // Initial frontier: in-degree-0 nodes sorted by depTime (stable tiebreak
  // for two unrelated chains starting on the same day).
  const ready: number[] = [];
  for (let i = 0; i < n; i++) if (inDegree[i] === 0) ready.push(i);
  ready.sort(byDepTime);

  const visited = new Set<number>();
  const result: T[] = [];

  while (ready.length > 0) {
    const i = ready.shift() as number;
    if (visited.has(i)) continue;
    visited.add(i);
    result.push(day[i]);

    // Walk this chain to completion before starting the next: prepend
    // newly-ready chain neighbours, sorted, ahead of any pending starts.
    const chainNext: number[] = [];
    for (const j of adj[i]) {
      if (visited.has(j)) continue;
      inDegree[j]--;
      if (inDegree[j] === 0) chainNext.push(j);
    }
    chainNext.sort(byDepTime);
    ready.unshift(...chainNext);
  }

  // Defensive: if a cycle slipped past (real flights cannot form one,
  // but malformed input could), append any remaining nodes in original
  // order so we never silently drop data.
  for (let i = 0; i < n; i++) {
    if (!visited.has(i)) result.push(day[i]);
  }

  return result;
}

function makeProposal(
  source: ProposedTrip["source"],
  flights: FlightLite[],
  pnr: string | null,
): ProposedTrip {
  const sorted = [...flights].sort(
    (a, b) => (a.departureTime?.getTime() ?? 0) - (b.departureTime?.getTime() ?? 0),
  );
  const origin = sorted[0]?.depIata ?? "?";
  const lastArrival = sorted[sorted.length - 1]?.arrIata ?? "?";
  // Round-trip detection: a trip is a "loop" when it ends where it
  // started — that's true for home_loop by construction, and frequently
  // true for PNR clusters (a single booking with both legs). For loops
  // the identity is the *furthest* airport, not the trivial origin
  // repetition. For one-way (origin !== lastArrival) we name by the
  // final arrival, which feels more natural than picking the middle leg.
  const isLoop = source === "home_loop" || origin === lastArrival;
  const destination = isLoop ? furthestFromOrigin(sorted, origin) : lastArrival;
  const from = sorted[0]?.departureTime
    ? toYmd(sorted[0].departureTime)
    : "";
  const to = sorted[sorted.length - 1]?.departureTime
    ? toYmd(sorted[sorted.length - 1].departureTime as Date)
    : "";
  const month = sorted[0]?.departureTime
    ? sorted[0].departureTime.toLocaleDateString("en", { month: "short", year: "numeric" })
    : "";
  // Round-trip arrow for loops, en-dash for one-way. The arrow is a
  // light visual cue that the trip starts and ends at home.
  const separator = isLoop ? "↺" : "–";
  return {
    source,
    flightIds: sorted.map((f) => f.id),
    pnr,
    origin,
    destination,
    span: { from, to },
    suggestedName: `${origin} ${separator} ${destination} · ${month}`,
    legs: sorted.map((f) => ({
      date: f.departureTime ? toYmd(f.departureTime) : "",
      flightNumber: f.flightNumber,
      depIata: f.depIata,
      arrIata: f.arrIata,
      status: f.status,
    })),
  };
}

/**
 * Return the IATA of the cluster's furthest airport from `origin` by
 * great-circle distance. Falls back to the last leg's arrival when the
 * cluster has no usable lat/lon.
 */
function furthestFromOrigin(flights: FlightLite[], origin: string): string {
  const homeFlight = flights.find((f) => f.depIata === origin);
  if (!homeFlight) return flights[flights.length - 1]?.arrIata ?? "?";
  const homeLat = homeFlight.depLat;
  const homeLon = homeFlight.depLon;

  let bestIata: string | null = null;
  let bestDist = -1;
  for (const f of flights) {
    if (!f.arrIata || f.arrIata === origin) continue;
    const d = calculateDistance(homeLat, homeLon, f.arrLat, f.arrLon);
    if (d > bestDist) {
      bestDist = d;
      bestIata = f.arrIata;
    }
  }
  return bestIata ?? flights[flights.length - 1]?.arrIata ?? "?";
}

async function commitProposals(
  userId: string,
  proposals: ProposedTrip[],
): Promise<DetectionResult> {
  if (proposals.length === 0) {
    return { proposed: proposals, created: [], orphansRemoved: 0 };
  }

  // Tighter transaction timeout than Prisma's 5 s default — a first-time
  // bulk import can produce 50+ proposals, each doing trip.create +
  // optional booking.create + updateMany. Default would time out
  // mid-commit and leave zero trips linked.
  const created = await prisma.$transaction(
    async (tx) => {
      const out: DetectionResult["created"] = [];
      const tripCount = await tx.trip.count({ where: { userId } });

      for (let i = 0; i < proposals.length; i++) {
        const p = proposals[i];
        const color = TRIP_COLORS[(tripCount + i) % TRIP_COLORS.length];
        const trip = await tx.trip.create({
          data: { userId, name: p.suggestedName, color },
        });
        let bookingId: string | null = null;
        if (p.pnr) {
          const booking = await tx.booking.create({
            data: { userId, tripId: trip.id, pnr: p.pnr },
          });
          bookingId = booking.id;
        }
        // TOCTOU guard: between snapshot and commit, a concurrent request
        // could have linked some of these flights to another trip.
        // updateMany skips rows whose tripId is no longer null. If the
        // resulting cluster shrinks below 2 legs, abandon this proposal —
        // a single-flight "trip" is noise, and the bookkeeping done above
        // (trip + optional booking) gets rolled back via finalize cleanup
        // (orphan delete) and the booking cascade in the schema.
        const result = await tx.flight.updateMany({
          where: { id: { in: p.flightIds }, userId, tripId: null },
          data: { tripId: trip.id, bookingId },
        });
        if (result.count < 2) {
          // Drop the empty-or-singleton trip + any booking so the orphan
          // cleanup downstream still has clean state.
          if (bookingId) {
            await tx.booking.delete({ where: { id: bookingId } });
          }
          await tx.trip.delete({ where: { id: trip.id } });
          continue;
        }
        out.push({ tripId: trip.id, flightIds: p.flightIds, pnr: p.pnr });
      }
      return out;
    },
    { timeout: 30_000, maxWait: 5_000 },
  );

  // Now that the transaction has committed, derive each newly-created
  // trip's status from its just-linked flights (spec 2026-07-17-status-
  // from-dates) — reading inside the still-open tx would see pre-link
  // (tripId=null) rows since the trip creation and the linking updateMany
  // both happened in that same transaction.
  for (const c of created) {
    await fillTripDatesFromSegments(c.tripId);
    await recomputeTripStatus(c.tripId);
  }

  return { proposed: proposals, created, orphansRemoved: 0 };
}

async function finalizeWithCleanup(
  result: DetectionResult,
  userId: string,
  dryRun: boolean,
): Promise<DetectionResult> {
  if (dryRun) return result;

  // Atomic orphan cleanup — drop trips that have zero flights linked.
  // Uses a single delete-where-not-in to avoid an N+1 round-trip.
  const orphans = await prisma.trip.findMany({
    where: { userId, flights: { none: {} } },
    select: { id: true },
  });
  if (orphans.length > 0) {
    await prisma.trip.deleteMany({
      where: { id: { in: orphans.map((o) => o.id) } },
    });
  }
  return { ...result, orphansRemoved: orphans.length };
}

// ─── Home history loader ──────────────────────────────────────────────

async function loadHomeHistory(userId: string): Promise<HomeAirportEntry[] | null> {
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const data = settings?.data as Prisma.JsonObject | null | undefined;
  if (!data) return null;
  const raw = data["homeAirportHistory"];
  // `normalizeHistory` validates + sorts; entries with bad shape are dropped.
  return normalizeHistory(raw);
}
