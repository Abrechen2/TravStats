/**
 * Handover of a route plan to the logbook (spec §5.9, call C1), one station at a time.
 *
 * Confirming a station creates, on the owner's server and only for what the plan holds as fact:
 * the plan's one roadtrip, the station's stop (reconciled into the stops already there - the ones
 * the phone appended included - never a blind replace), a lodging + stay for a booked night, and
 * the ferry crossing that arrives at the station, linked to its leg.
 *
 * Withdrawal deletes only what the plan wrote AND nobody touched since. A record carries a
 * fingerprint in the plan; edited, photographed or documented, it stays. The plan's own records
 * are never trusted to be unchanged: that is what the fingerprint is for.
 *
 * A placeholder never becomes a record (C4). Every write here runs in the plan's own
 * transaction, after the revision is reserved: a lost race on the plan revision rolls the
 * records back with it, so a failed or retried handover leaves nothing behind. Routing of the
 * legs it created happens after the commit (`HandoverOutcome.afterCommit`).
 */
import type { DbTransaction } from "../../db";
import type { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import type { ApiErrorCode } from "../../middleware/apiErrorCode";
import { replaceStationsIn, finishRoute, type Station } from "../roadtrip/replaceStations";
import { lockRoute } from "../roadtrip/lockRoute";
import { recomputeTripStatus } from "../tripStatusService";
import { propagateDelete, propagateWrite, shareSnapshot } from "../sharing/propagate";
import { haversineKm } from "../../shared/geo/haversine";
import { localDay } from "../../shared/time/instant";
import { fxColumnsFor, getBaseCurrency } from "../fx/snapshot";
import { createFerryJourneySchema } from "../../schemas/ferry";
import { mergeFerryJourney } from "../ferry/ferryJourneyWrite";
import { LODGING_TYPES } from "../../schemas/lodging";
import { ROADTRIP_VEHICLES } from "../../shared/tour/roadtrip";
import { restoreLeg, snapshotOf } from "../../routes/ferry/roadtrip";
import { prepareHotel } from "./execution";
import { scheduleRoute } from "./routeSchedule";
import type { PlanBooking, PlanState, PlanStation, PlanStationLink } from "./types";

type Created = PlanStationLink["created"][number];
const DAY_MS = 86_400_000;
const SAME_STOP_KM = 0.15;
const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const addDays = (day: string, n: number) => dayOf(new Date(dayDate(day).getTime() + n * DAY_MS));

/** What a stop looked like when the plan wrote it; a later edit changes this. */
export const stopFingerprint = (s: {
  title: string;
  lat: number | null;
  lon: number | null;
  startDate: Date | null;
  endDate: Date | null;
  lodgingStayId: string | null;
  overnight: boolean;
  notes?: string | null;
  viaPoint?: boolean;
  placeId?: string | null;
  countryVisitKind?: string | null;
}) =>
  [
    s.title,
    s.lat?.toFixed(5),
    s.lon?.toFixed(5),
    dayOf(s.startDate),
    dayOf(s.endDate),
    s.lodgingStayId ?? "",
    s.overnight,
    s.notes ?? "",
    s.viaPoint ?? false,
    s.placeId ?? "",
    s.countryVisitKind ?? "",
  ].join("|");

export interface HandoverOutcome {
  roadtripId: string;
  link: PlanStationLink;
  /** Work that needs the committed rows (road routing of new legs, the trip's status). */
  afterCommit: () => Promise<void>;
}

function fail(status: number, code: ApiErrorCode, message: string): never {
  throw new AppError(message, status, code);
}

function chooseLodgingType(state: PlanState, booking: PlanBooking) {
  const given = booking.details.lodgingType;
  if (typeof given === "string" && (LODGING_TYPES as readonly string[]).includes(given))
    return given as (typeof LODGING_TYPES)[number];
  const camping =
    state.vehicle && ["motorhome", "campervan", "caravan"].includes(state.vehicle.kind);
  return camping ? "campsite" : "hotel";
}

async function ensureRoadtrip(
  tx: DbTransaction,
  userId: string,
  tripId: string,
  state: PlanState,
  name: string
): Promise<string> {
  const known = state.roadtripId
    ? await tx.tripRoute.findFirst({
        where: { id: state.roadtripId, userId, kind: "roadtrip" },
        select: { id: true },
      })
    : null;
  if (known) return known.id;
  // The plan's route may exist without the plan knowing yet (a lost revision race): adopt the
  // trip's only roadtrip rather than make a second one.
  const onTrip = await tx.tripRoute.findMany({
    where: { userId, tripId, kind: "roadtrip" },
    select: { id: true },
    take: 2,
  });
  if (onTrip.length === 1) return onTrip[0].id;
  const last = await tx.tripRoute.findFirst({
    where: { userId, tripId },
    orderBy: { orderIdx: "desc" },
    select: { orderIdx: true },
  });
  const vehicle = state.vehicle?.kind;
  const created = await tx.tripRoute.create({
    data: {
      userId,
      tripId,
      kind: "roadtrip",
      name,
      mode: "road",
      vehicle:
        vehicle && (ROADTRIP_VEHICLES as readonly string[]).includes(vehicle) ? vehicle : null,
      orderIdx: last ? last.orderIdx + 1 : 0,
    },
    select: { id: true },
  });
  // The plan's roadtrip reaches the trip's members with the first station (forgejo#404).
  await propagateWrite(tx, userId, "roadtrip", created.id);
  return created.id;
}

/** The booked night as a lodging + stay, or null when the station has none the plan can vouch for. */
async function writeStay(
  tx: DbTransaction,
  userId: string,
  tripId: string,
  state: PlanState,
  station: PlanStation,
  arrive: string,
  depart: string
): Promise<{ stay: Created; lodging: Created | null; stayId: string } | null> {
  if (station.night.kind !== "booked") return null;
  const bookingId = station.night.bookingId;
  const booking = state.bookings.find((b) => b.id === bookingId);
  // C4: a placeholder stays in the plan.
  if (!booking || booking.placeholder) return null;
  const prior = await tx.lodgingStay.findFirst({
    where: { userId, externalRef: "travplan:" + station.id },
    select: { id: true, updatedAt: true },
  });
  if (prior)
    return {
      stay: { kind: "stay", id: prior.id, version: prior.updatedAt.toISOString() },
      lodging: null,
      stayId: prior.id,
    };
  const dated: PlanBooking = {
    ...booking,
    day: booking.day ?? arrive,
    endDay: booking.endDay ?? depart,
    details: { lat: station.place.lat, lon: station.place.lon, ...booking.details },
    city: booking.city || station.place.name,
    country: booking.country || station.place.country || "",
  };
  const ready = await prepareHotel(userId, dated, chooseLodgingType(state, booking));
  const exact =
    dated.city && dated.country && dated.address
      ? await tx.lodging.findFirst({
          where: {
            userId,
            name: dated.title,
            city: dated.city,
            country: dated.country,
            address: dated.address,
          },
        })
      : null;
  const lodging = exact ?? (await tx.lodging.create({ data: ready.lodging }));
  const stay = await tx.lodgingStay.create({
    data: {
      ...ready.stay,
      userId,
      tripId,
      lodgingId: lodging.id,
      externalRef: "travplan:" + station.id,
    },
  });
  await propagateWrite(tx, userId, "lodgingStay", stay.id);
  const persisted = await tx.lodgingStay.findUniqueOrThrow({
    where: { id: stay.id },
    select: { updatedAt: true },
  });
  return {
    stay: { kind: "stay" as const, id: stay.id, version: persisted.updatedAt.toISOString() },
    lodging: exact
      ? null
      : { kind: "lodging" as const, id: lodging.id, version: lodging.updatedAt.toISOString() },
    stayId: stay.id,
  };
}

type StopRow = Prisma.TripStopGetPayload<{
  select: {
    id: true;
    title: true;
    lat: true;
    lon: true;
    startDate: true;
    endDate: true;
    notes: true;
    lodgingStayId: true;
    overnight: true;
    viaPoint: true;
    placeId: true;
    countryVisitKind: true;
    routeOrderIdx: true;
  };
}>;
const STOP_SELECT = {
  id: true,
  title: true,
  lat: true,
  lon: true,
  startDate: true,
  endDate: true,
  notes: true,
  lodgingStayId: true,
  overnight: true,
  viaPoint: true,
  placeId: true,
  countryVisitKind: true,
  routeOrderIdx: true,
} as const;

function asStation(row: StopRow): Station {
  const night: Station["night"] = row.lodgingStayId
    ? { kind: "stay", lodgingStayId: row.lodgingStayId }
    : row.viaPoint
      ? { kind: "via" }
      : row.overnight
        ? {
            kind: "free",
            countryVisitKind: row.countryVisitKind === "transit" ? "transit" : "visit",
          }
        : { kind: "pass", placeId: row.placeId };
  return {
    id: row.id,
    title: row.title,
    lat: row.lat as number,
    lon: row.lon as number,
    startDate: row.startDate,
    endDate: row.endDate,
    notes: row.notes,
    night,
  };
}

const readStops = (tx: DbTransaction, routeId: string) =>
  tx.tripStop.findMany({
    where: { routeId, routeOrderIdx: { not: null } },
    orderBy: { routeOrderIdx: "asc" },
    select: STOP_SELECT,
  });
/** The precondition of a reconciling write: the ids AND the content of the stops it replaces. */
const replaceGuard = (rows: StopRow[]) => ({
  expectedStationIds: placed(rows),
  expectedVersions: {
    version: (r: Parameters<typeof stopFingerprint>[0]) => stopFingerprint(r),
    expected: new Map(rows.map((r) => [r.id, stopFingerprint(r)] as const)),
  },
});
const placed = (rows: StopRow[]) =>
  rows.filter((r) => r.lat !== null && r.lon !== null).map((r) => r.id);

export async function handoverStation(
  tx: DbTransaction,
  userId: string,
  tripId: string,
  state: PlanState,
  stationId: string,
  tripName: string
): Promise<HandoverOutcome> {
  if (state.shape !== "route")
    fail(409, "PLAN_NOT_A_ROUTE", "Only a route plan has stations to hand over");
  const station = state.stations.find((s) => s.id === stationId);
  if (!station) fail(404, "PLAN_ITEM_NOT_FOUND", "Station not found");
  const timing = scheduleRoute(state).stations.find((s) => s.stationId === stationId);
  const arrive = timing?.arriveDay ?? null;
  if (!arrive) fail(409, "PLAN_STATION_UNDATED", "The station has no day yet");
  const zone = station.place.zone || state.timezone || "UTC";
  if (arrive > localDay(new Date(), zone))
    fail(400, "PLAN_STATION_FUTURE", "A station that has not been reached cannot be handed over");
  const existing = state.stationLinks.find((l) => l.stationId === stationId);
  if (existing && existing.created.length > 0)
    fail(409, "PLAN_STATION_HANDED_OVER", "The station is already in the logbook");
  const depart = addDays(arrive, station.nights);

  const routeId = await ensureRoadtrip(tx, userId, tripId, state, tripName);
  // Locked before the stops are read, so what is reconciled is what is there when the write lands.
  await lockRoute(tx, routeId);
  const stay = await writeStay(tx, userId, tripId, state, station, arrive, depart);
  const night: Station["night"] = stay
    ? { kind: "stay", lodgingStayId: stay.stayId }
    : station.nights > 0 && station.night.kind !== "onboard"
      ? { kind: "free", countryVisitKind: "visit" }
      : { kind: "pass", placeId: null };

  const rows = await readStops(tx, routeId);
  // The phone's own stop ("Tonight here") is the station: same day, within 150 m, or the stop
  // the plan already linked. Adopt it instead of adding a second one.
  const linkedId = existing?.tripStopId;
  const adopted = rows.find(
    (r) =>
      r.id === linkedId ||
      (r.lat !== null &&
        r.lon !== null &&
        dayOf(r.startDate) === arrive &&
        haversineKm({ lat: r.lat, lon: r.lon }, station.place) <= SAME_STOP_KM)
  );
  // A stop the phone recorded is the user's own word: the plan fills what it lacks and never
  // overwrites a name, position, date, note or night the phone wrote.
  const base: Station = {
    title: station.title,
    lat: station.place.lat,
    lon: station.place.lon,
    startDate: dayDate(arrive),
    endDate: dayDate(station.nights > 0 ? depart : arrive),
    notes: station.note || null,
    night,
  };
  const phone = adopted ? asStation(adopted) : null;
  const ours: Station = phone
    ? {
        ...base,
        id: phone.id,
        title: phone.title || base.title,
        lat: phone.lat,
        lon: phone.lon,
        startDate: phone.startDate ?? base.startDate,
        endDate: phone.endDate ?? base.endDate,
        notes: phone.notes ?? base.notes,
        night: stay ? night : phone.night,
      }
    : base;
  const list = rows.map(asStation);
  const at = adopted ? rows.findIndex((r) => r.id === adopted.id) : -1;
  if (at >= 0) list[at] = ours;
  else {
    const after = rows.findIndex((r) => r.startDate && dayOf(r.startDate) > arrive);
    list.splice(after < 0 ? list.length : after, 0, ours);
  }
  const index = at >= 0 ? at : list.indexOf(ours);
  const result = await replaceStationsIn(tx, userId, routeId, list, replaceGuard(rows));
  const stop = result.stations[index];
  const created: Created[] = [];
  if (!adopted)
    created.push({
      kind: "stop",
      id: stop.id,
      version: stopFingerprint({
        title: stop.title,
        lat: stop.lat,
        lon: stop.lon,
        startDate: stop.startDate,
        endDate: stop.endDate,
        lodgingStayId: stop.lodgingStayId,
        overnight: stop.overnight,
        notes: ours.notes ?? null,
        viaPoint: false,
        placeId: null,
        countryVisitKind: "visit",
      }),
    });
  if (stay) created.push(stay.stay, ...(stay.lodging ? [stay.lodging] : []));

  const ferry = await writeFerry(tx, userId, tripId, state, station, result.legs, stop.id);
  if (ferry) created.push(ferry);
  await recomputeTripStatus(tripId, tx);
  return {
    roadtripId: routeId,
    link: { stationId, tripStopId: stop.id, created },
    afterCommit: async () => void (await finishRoute(userId, routeId, result)),
  };
}

async function writeFerry(
  tx: DbTransaction,
  userId: string,
  tripId: string,
  state: PlanState,
  station: PlanStation,
  legs: { id: string; toStopId: string; fromStopId: string }[],
  stopId: string
): Promise<Created | null> {
  const stage = state.stages.find((g) => g.toStationId === station.id && g.mode === "ferry");
  const booking = stage && state.bookings.find((b) => b.id === stage.bookingId);
  const from = stage && state.stations.find((s) => s.id === stage.fromStationId);
  if (!stage || !booking || booking.placeholder || !from) return null;
  // Only the leg that really joins the stage's two stations is the crossing; handing stations
  // over out of order must not turn some other drive into a ferry.
  const fromStop = state.stationLinks.find((l) => l.stationId === stage.fromStationId)?.tripStopId;
  const leg = legs.find((l) => l.toStopId === stopId && l.fromStopId === fromStop);
  const prior = await tx.ferryJourney.findFirst({
    where: { userId, externalRef: "travplan:" + stage.id },
    select: { id: true, updatedAt: true },
  });
  if (prior) return { kind: "ferry", id: prior.id, version: prior.updatedAt.toISOString() };
  const day = booking.day ?? stage.departDay;
  if (!day) return null;
  const clock = (d: string, t: string | null | undefined) => (t ? `${d}T${t.slice(0, 5)}` : d);
  const input = createFerryJourneySchema.parse({
    operator: booking.provider || null,
    bookingReference:
      booking.reference && booking.reference.length <= 40 ? booking.reference : null,
    departureStation: {
      name: booking.originPlace || from.title,
      lat: from.place.lat,
      lon: from.place.lon,
      country: from.place.country?.length === 2 ? from.place.country : null,
    },
    arrivalStation: {
      name: booking.place || station.title,
      lat: station.place.lat,
      lon: station.place.lon,
      country: station.place.country?.length === 2 ? station.place.country : null,
    },
    departureLocal: clock(day, booking.time ?? stage.departTime),
    arrivalLocal: booking.arrivalDay ? clock(booking.arrivalDay, booking.arrivalTime) : null,
    distanceKm: stage.distanceKm && stage.distanceKm > 0 ? stage.distanceKm : null,
    price: booking.amount,
    currency: booking.currency,
    status: "scheduled",
    tripId,
  });
  const merged = mergeFerryJourney(null, input);
  const fx = await fxColumnsFor(
    { amount: input.price, currency: input.currency, date: merged.departureTime },
    await getBaseCurrency(userId)
  );
  const {
    departureStation: _d,
    arrivalStation: _a,
    departureLocal: _dl,
    arrivalLocal: _al,
    departureFold: _df,
    arrivalFold: _af,
    distanceKm: _km,
    status: _s,
    companions: _c,
    ...plain
  } = input;
  const legRow = leg
    ? await tx.tripRouteLeg.findFirst({
        where: { id: leg.id },
        include: { ferryJourney: { select: { id: true } } },
      })
    : null;
  const linkable = legRow && !legRow.ferryJourney;
  const created = await tx.ferryJourney.create({
    data: {
      ...plain,
      ...merged,
      ...fx,
      userId,
      tripId,
      externalRef: "travplan:" + stage.id,
      ...(linkable ? { roadtripLegId: legRow.id, roadtripLegBefore: snapshotOf(legRow) } : {}),
    },
  });
  const routeBefore = linkable ? await shareSnapshot(tx, "roadtrip", legRow.routeId) : null;
  if (linkable)
    await tx.tripRouteLeg.update({
      where: { id: legRow.id },
      data: {
        mode: "ferry",
        source: "straight",
        waypoints: undefined,
        confidence: "low",
        drivingMinutes: null,
        distanceKm: created.distanceKm ?? legRow.distanceKm,
      },
    });
  await propagateWrite(tx, userId, "ferry", created.id);
  if (linkable) await propagateWrite(tx, userId, "roadtrip", legRow.routeId, routeBefore);
  const persisted = await tx.ferryJourney.findUniqueOrThrow({
    where: { id: created.id },
    select: { updatedAt: true },
  });
  return { kind: "ferry" as const, id: created.id, version: persisted.updatedAt.toISOString() };
}

/** The plan after a handover: the link recorded, the roadtrip remembered. */
export function applyHandover(state: PlanState, outcome: HandoverOutcome): PlanState {
  return {
    ...state,
    roadtripId: outcome.roadtripId,
    stationLinks: [
      ...state.stationLinks.filter((l) => l.stationId !== outcome.link.stationId),
      outcome.link,
    ],
  };
}

export interface WithdrawOutcome {
  /** What is left of the link: null when nothing remains in the logbook for this station. */
  link: PlanStationLink | null;
  /** Records the plan wrote that the user changed since, and that therefore stay. */
  kept: number;
  removed: number;
  afterCommit: () => Promise<void>;
}

export async function withdrawStation(
  tx: DbTransaction,
  userId: string,
  tripId: string,
  state: PlanState,
  stationId: string
): Promise<WithdrawOutcome> {
  const link = state.stationLinks.find((l) => l.stationId === stationId);
  if (!link || link.created.length === 0)
    fail(404, "PLAN_ITEM_NOT_FOUND", "Nothing of this station was handed over by the plan");
  const remaining: Created[] = [];
  const reroute: (() => Promise<void>)[] = [];
  let removed = 0;
  const done = (c: Created, gone: boolean) => {
    if (gone) removed++;
    else remaining.push(c);
  };
  const of = (kind: Created["kind"]) => link.created.filter((c) => c.kind === kind);

  for (const c of of("ferry")) {
    done(c, await withdrawFerry(tx, userId, c));
  }
  for (const c of of("stop")) done(c, await withdrawStop(tx, userId, state.roadtripId, c, reroute));
  for (const c of of("stay")) done(c, await withdrawStay(tx, userId, tripId, c));
  for (const c of of("lodging")) {
    // A house only goes when the stay it was made for is gone and nothing else uses it.
    done(
      c,
      remaining.some((r) => r.kind === "stay") ? false : await withdrawLodging(tx, userId, c)
    );
  }
  await recomputeTripStatus(tripId, tx);
  return {
    afterCommit: async () => {
      for (const finish of reroute) await finish();
    },
    link: remaining.length ? { ...link, created: remaining } : null,
    kept: remaining.length,
    removed,
  };
}

async function withdrawFerry(tx: DbTransaction, userId: string, c: Created): Promise<boolean> {
  const row = await tx.ferryJourney.findFirst({
    where: { id: c.id, userId },
    include: { documents: { select: { id: true } } },
  });
  if (!row) return true;
  if (row.updatedAt.toISOString() !== c.version || row.documents.length) return false;
  if (row.roadtripLegId) await restoreLeg(tx, row.roadtripLegId, row.roadtripLegBefore);
  const shared = await shareSnapshot(tx, "ferry", row.id);
  await tx.ferryJourney.delete({ where: { id: row.id } });
  await propagateDelete(tx, userId, shared);
  return true;
}

async function withdrawStop(
  tx: DbTransaction,
  userId: string,
  routeId: string | null,
  c: Created,
  reroute: (() => Promise<void>)[]
): Promise<boolean> {
  if (!routeId) return false;
  const route = await tx.tripRoute.findFirst({
    where: { id: routeId, userId },
    select: { id: true },
  });
  if (!route) return true;
  await lockRoute(tx, routeId);
  const rows = await readStops(tx, routeId);
  const row = rows.find((r) => r.id === c.id);
  if (!row) return true;
  const photos = await tx.tripPhoto.count({ where: { stopId: row.id } });
  if (stopFingerprint(row) !== c.version || photos > 0) return false;
  const result = await replaceStationsIn(
    tx,
    userId,
    routeId,
    rows.filter((r) => r.id !== row.id).map(asStation),
    replaceGuard(rows)
  );
  reroute.push(async () => void (await finishRoute(userId, routeId, result)));
  return true;
}

async function withdrawStay(
  tx: DbTransaction,
  userId: string,
  tripId: string,
  c: Created
): Promise<boolean> {
  const stay = await tx.lodgingStay.findFirst({
    where: { id: c.id, userId },
    include: { documents: { select: { id: true } } },
  });
  if (!stay) return true;
  const stopHolds = await tx.tripStop.count({ where: { lodgingStayId: stay.id } });
  if (
    stay.tripId !== tripId ||
    stay.updatedAt.toISOString() !== c.version ||
    stay.documents.length ||
    stopHolds > 0
  )
    return false;
  const shared = await shareSnapshot(tx, "lodgingStay", stay.id);
  await tx.lodgingStay.delete({ where: { id: stay.id } });
  await propagateDelete(tx, userId, shared);
  return true;
}

async function withdrawLodging(tx: DbTransaction, userId: string, c: Created): Promise<boolean> {
  const lodging = await tx.lodging.findFirst({
    where: { id: c.id, userId },
    include: { photos: { select: { id: true } } },
  });
  if (!lodging) return true;
  const used = await tx.lodgingStay.count({ where: { lodgingId: lodging.id } });
  if (used > 0 || lodging.photos.length || lodging.updatedAt.toISOString() !== c.version)
    return false;
  // share-exempt: deletes the house the plan itself created for the stay it just withdrew
  await tx.lodging.deleteMany({ where: { id: lodging.id, userId } });
  return true;
}

export function applyWithdraw(
  state: PlanState,
  stationId: string,
  out: WithdrawOutcome
): PlanState {
  const others = state.stationLinks.filter((l) => l.stationId !== stationId);
  return { ...state, stationLinks: out.link ? [...others, out.link] : others };
}
