/**
 * The logbook's time windows, one explicit adapter per domain (TravTrack plan
 * E7; E10 labels days with them). `AVAILABLE_DOMAINS` only NAMES domains — it
 * reads nothing — so every domain is classified here: an adapter that reads
 * its own table's columns on its own clock, or a stated reason why the domain
 * has no time window. A key of `DOMAIN_KEYS` without either fails the type
 * (`Record<DomainKey, …>`) and `unclassifiedDomains`' test, the
 * `DOMAIN_SHARING` pattern.
 *
 * Each adapter also says whether its window COVERS movement: a ride, a
 * crossing, a cruise, a rental and a roadtrip are the logbook holding the
 * journey; a stay or a place visit is the logbook holding where the user was,
 * not how they got there.
 *
 * Windows are `[fromMs, untilMs]` instants. A window that cannot be stated —
 * an undated roadtrip, a ride without a time — is left out, never guessed.
 */
import { prisma, type DbTransaction } from "../../../db";
import { AVAILABLE_DOMAINS, type DomainKey } from "../../../shared/domains";
import { startOfDayAt } from "../../../shared/time/legacyValues";
import { fromDbDate, toDbDate } from "../../../shared/time/localDate";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { now } from "../../../shared/time/clock";
import { roadtripAttestedSpan } from "../../stats/roadtripEvidence";
import { tripSpanInstantsIn } from "../../tripRecording/bounds";
import { FLIGHT_WINDOW_SELECT, flightRecorderWindow } from "../../tripRecording/bounds";
import type { ReadWindow } from "../../locationProvider/types";

export type EntryWindow = { domain: DomainKey; id: string; fromMs: number; untilMs: number };

type Read = (userId: string, window: ReadWindow, db?: DbTransaction) => Promise<EntryWindow[]>;

export type EntryWindowAdapter =
  { read: Read; movement: true } | { read: Read; movement: { no: string } } | { none: string };

const DAY_MS = 86_400_000;
/** A ride or a booking is looked for this far before the window: a long one starts earlier. */
const LOOKBACK_MS = 3 * DAY_MS;

const overlaps = (w: { fromMs: number; untilMs: number }, window: ReadWindow) =>
  w.fromMs < window.untilMs && w.untilMs >= window.fromMs;

const nextDay = (day: string) => fromDbDate(new Date(toDbDate(day).getTime() + DAY_MS));

/** Rail, bus and ferry share their columns: departure to arrival, the actual times first. */
type RideRow = {
  id: string;
  departureTime: Date;
  arrivalTime: Date | null;
  actualDepartureTime: Date | null;
  actualArrivalTime: Date | null;
};
const RIDE_SELECT = {
  id: true,
  departureTime: true,
  arrivalTime: true,
  actualDepartureTime: true,
  actualArrivalTime: true,
} as const;

function rideWindows(domain: DomainKey, rows: RideRow[], window: ReadWindow): EntryWindow[] {
  return rows
    .map((r) => {
      const from = (r.actualDepartureTime ?? r.departureTime).getTime();
      const until = (r.actualArrivalTime ?? r.arrivalTime)?.getTime() ?? from;
      return { domain, id: r.id, fromMs: from, untilMs: Math.max(from, until) };
    })
    .filter((w) => overlaps(w, window));
}

const rideWhere = (userId: string, window: ReadWindow) => ({
  userId,
  status: { not: "cancelled" },
  departureTime: { gte: new Date(window.fromMs - LOOKBACK_MS), lt: new Date(window.untilMs) },
});

const readFlights: Read = async (userId, window, db = prisma) => {
  const flights = await db.flight.findMany({
    where: {
      userId,
      status: { not: "cancelled" },
      departureTime: { gte: new Date(window.fromMs - LOOKBACK_MS), lt: new Date(window.untilMs) },
    },
    select: { id: true, ...FLIGHT_WINDOW_SELECT },
  });
  const out: EntryWindow[] = [];
  for (const f of flights) {
    const w = await flightRecorderWindow(f);
    if (w) out.push({ domain: "flight", id: f.id, fromMs: w[0], untilMs: w[1] });
  }
  return out.filter((w) => overlaps(w, window));
};

const readRail: Read = async (userId, window, db = prisma) =>
  rideWindows(
    "rail",
    await db.railJourney.findMany({ where: rideWhere(userId, window), select: RIDE_SELECT }),
    window
  );

const readBus: Read = async (userId, window, db = prisma) =>
  rideWindows(
    "bus",
    await db.busJourney.findMany({ where: rideWhere(userId, window), select: RIDE_SELECT }),
    window
  );

const readFerry: Read = async (userId, window, db = prisma) =>
  rideWindows(
    "ferry",
    await db.ferryJourney.findMany({ where: rideWhere(userId, window), select: RIDE_SELECT }),
    window
  );

/** A cruise's days on its own clock (`tripSpanInstantsIn`, as a trip's). */
const readCruises: Read = async (userId, window, db = prisma) => {
  const [rows, profile] = await Promise.all([
    db.cruise.findMany({
      where: { userId, status: { not: "cancelled" } },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        startDay: true,
        endDay: true,
        startZone: true,
        endZone: true,
      },
    }),
    profileZoneOf(userId, db),
  ]);
  return rows.flatMap((c) => {
    const span = tripSpanInstantsIn(c, profile.zone);
    if (!span) return [];
    const w = { domain: "cruise" as const, id: c.id, fromMs: span.fromMs, untilMs: span.untilMs };
    return overlaps(w, window) ? [w] : [];
  });
};

const readRentals: Read = async (userId, window, db = prisma) => {
  const rows = await db.rentalBooking.findMany({
    where: {
      userId,
      status: { not: "cancelled" },
      pickupTime: { lt: new Date(window.untilMs + DAY_MS) },
      returnTime: { gte: new Date(window.fromMs - DAY_MS) },
    },
    select: {
      id: true,
      pickupTime: true,
      returnTime: true,
      actualPickupTime: true,
      actualReturnTime: true,
    },
  });
  return rows
    .map((r) => ({
      domain: "rental" as const,
      id: r.id,
      fromMs: (r.actualPickupTime ?? r.pickupTime).getTime(),
      untilMs: (r.actualReturnTime ?? r.returnTime).getTime(),
    }))
    .filter((w) => overlaps(w, window));
};

/**
 * A roadtrip's attested days (`roadtripAttestedSpan` — no planned station, no
 * cancelled stay, no month placeholder), from 00:00 of the first to 00:00
 * after the last, on the first dated station's clock or the profile zone.
 */
const readRoadtrips: Read = async (userId, window, db = prisma) => {
  const [routes, profile] = await Promise.all([
    db.tripRoute.findMany({
      where: { userId, kind: "roadtrip" },
      select: {
        id: true,
        stops: {
          where: { viaPoint: false },
          orderBy: { routeOrderIdx: "asc" },
          select: {
            stopZone: true,
            startDate: true,
            endDate: true,
            overnight: true,
            lodgingStayId: true,
            lodgingStay: {
              select: {
                checkIn: true,
                checkOut: true,
                datePrecision: true,
                nights: true,
                status: true,
              },
            },
          },
        },
      },
    }),
    profileZoneOf(userId, db),
  ]);
  const at = now();
  return routes.flatMap((route) => {
    const span = roadtripAttestedSpan(route.stops, at);
    if (!span) return [];
    const zone = route.stops.find((s) => s.stopZone)?.stopZone ?? profile.zone;
    const w = {
      domain: "roadtrip" as const,
      id: route.id,
      fromMs: startOfDayAt(span.first, zone).getTime(),
      untilMs: startOfDayAt(nextDay(span.last), zone).getTime(),
    };
    return overlaps(w, window) ? [w] : [];
  });
};

/** Check-in to check-out: the instants when the stay has them, else its days on its own clock. */
const readLodging: Read = async (userId, window, db = prisma) => {
  const [rows, profile] = await Promise.all([
    db.lodgingStay.findMany({
      where: {
        userId,
        status: { not: "cancelled" },
        OR: [
          {
            checkInAt: { lt: new Date(window.untilMs + DAY_MS) },
            checkOutAt: { gte: new Date(window.fromMs - DAY_MS) },
          },
          {
            checkInAt: null,
            checkInDate: { lt: new Date(window.untilMs + DAY_MS) },
            checkOutDate: { gte: new Date(window.fromMs - 2 * DAY_MS) },
          },
        ],
      },
      select: {
        id: true,
        checkInAt: true,
        checkOutAt: true,
        checkInDate: true,
        checkOutDate: true,
        stayZone: true,
      },
    }),
    profileZoneOf(userId, db),
  ]);
  return rows.flatMap((s) => {
    const zone = s.stayZone ?? profile.zone;
    const from =
      s.checkInAt?.getTime() ??
      (s.checkInDate ? startOfDayAt(fromDbDate(s.checkInDate), zone).getTime() : null);
    const until =
      s.checkOutAt?.getTime() ??
      (s.checkOutDate ? startOfDayAt(nextDay(fromDbDate(s.checkOutDate)), zone).getTime() : null);
    if (from === null || until === null || until < from) return [];
    const w = { domain: "lodging" as const, id: s.id, fromMs: from, untilMs: until };
    return overlaps(w, window) ? [w] : [];
  });
};

/** A place visit with an instant; a visit known only by its day names no moment. */
const readPlaceVisits: Read = async (userId, window, db = prisma) => {
  const rows = await db.placeVisit.findMany({
    where: {
      userId,
      visitedAtUtc: { gte: new Date(window.fromMs), lt: new Date(window.untilMs) },
    },
    select: { id: true, visitedAtUtc: true },
  });
  return rows.flatMap((v) =>
    v.visitedAtUtc
      ? [
          {
            domain: "poi" as const,
            id: v.id,
            fromMs: v.visitedAtUtc.getTime(),
            untilMs: v.visitedAtUtc.getTime(),
          },
        ]
      : []
  );
};

export const ENTRY_WINDOW_ADAPTERS: Record<DomainKey, EntryWindowAdapter> = {
  flight: { read: readFlights, movement: true },
  cruise: { read: readCruises, movement: true },
  lodging: {
    read: readLodging,
    movement: { no: "a stay says where the user slept, not how they travelled" },
  },
  poi: {
    read: readPlaceVisits,
    movement: { no: "a place visit is a moment at a place, not a way there" },
  },
  roadtrip: { read: readRoadtrips, movement: true },
  rail: { read: readRail, movement: true },
  rental: { read: readRentals, movement: true },
  bus: { read: readBus, movement: true },
  ferry: { read: readFerry, movement: true },
};

/** Keys with neither an adapter nor a reason — empty, or a new domain was not classified. */
export function unclassifiedDomains(keys: readonly string[]): string[] {
  return keys.filter((k) => !(k in ENTRY_WINDOW_ADAPTERS));
}

/** Every available domain's windows touching `window`, through its adapter. */
export async function logbookWindows(
  userId: string,
  window: ReadWindow,
  db: DbTransaction = prisma
): Promise<EntryWindow[]> {
  const lists = await Promise.all(
    AVAILABLE_DOMAINS.map((domain) => {
      const adapter = ENTRY_WINDOW_ADAPTERS[domain];
      return "none" in adapter ? Promise.resolve([]) : adapter.read(userId, window, db);
    })
  );
  return lists.flat();
}

/** `domain:id` — how an entry is named in a journey's links and own-entry sets. */
export const entryRef = (w: Pick<EntryWindow, "domain" | "id">) => `${w.domain}:${w.id}`;

/** The share of `[fromMs, untilMs]` a window holds. */
export function overlapShare(
  run: { fromMs: number; untilMs: number },
  w: { fromMs: number; untilMs: number }
): number {
  const length = run.untilMs - run.fromMs;
  if (length <= 0) return 0;
  const shared = Math.min(run.untilMs, w.untilMs) - Math.max(run.fromMs, w.fromMs);
  return Math.max(0, shared) / length;
}

/** A run is covered when at least this share of it lies in ONE window. */
export const COVER_SHARE = 0.5;

/**
 * The window that covers `run`, or null. Only windows of a domain that covers
 * movement count, and never an entry in `own` — one made by answering the
 * very question the run belongs to (self-evidence, review focus 22).
 */
export function coveringWindow(
  run: { fromMs: number; untilMs: number },
  windows: readonly EntryWindow[],
  own: ReadonlySet<string>
): EntryWindow | null {
  return (
    windows.find((w) => {
      const adapter = ENTRY_WINDOW_ADAPTERS[w.domain];
      if ("none" in adapter || adapter.movement !== true || own.has(entryRef(w))) return false;
      return overlapShare(run, w) >= COVER_SHARE;
    }) ?? null
  );
}
