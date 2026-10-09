import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { haversineKm } from "../../shared/geo/haversine";
import { reverseGeocode } from "../geo/nominatim";
import { lockRoute } from "./lockRoute";
import { recomputeLegs, type StopCoords } from "../tour/legRecompute";
import { autoRouteNewLegs } from "../tour/routing/autoRouteLegs";
import {
  STATION_DTO_SELECT,
  STATION_SELECT,
  STATIONS_ONLY,
  spanOf,
  type StationDtoRow,
  type StationRow,
} from "./roadtripSummary";
import { isStation } from "../../shared/tour/roadtrip";
import { stationTimeColumns } from "../timeModel/tripColumns";

/**
 * The phone's side of a roadtrip (companion#12, #13; owner 2026-09-24): which
 * roadtrip is running today, one station appended where the phone stands, and
 * which trip or station a given day belongs to.
 *
 * The web edits a roadtrip by replacing its whole station list. A phone must
 * not: it may hold a stale copy, or be offline for a day, and a whole-list
 * write from it would undo the web's edits. So the phone only ever APPENDS,
 * and an append is idempotent — its outbox may resend freely.
 */

const DAY_MS = 86_400_000;
/** A station within this distance on the same day is the same station (a resend, a second tap). */
export const SAME_STATION_M = 150;
/** How long after its last station a roadtrip still counts as running — a trip runs over its plan. */
const RUNNING_GRACE_DAYS = 3;

const dayStart = (day: string): Date => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/** The day a station covers from and to, taking a linked stay's dates where its own are empty. */
function stationSpan(s: StationRow): { from: string | null; to: string | null } {
  const from = s.startDate ?? s.lodgingStay?.checkIn ?? null;
  const to = s.endDate ?? s.lodgingStay?.checkOut ?? from;
  return { from: from ? dayOf(from) : null, to: to ? dayOf(to) : null };
}

/**
 * The roadtrip running on `day`: the one whose stations' span covers it; failing
 * that, one that started before it and ended at most three days earlier (the
 * plan ran out, the drive did not). Of several, the latest started. Null when
 * none — the phone then shows no roadtrip, not a guess.
 */
export async function findActiveRoadtrip(
  userId: string,
  day: string
): Promise<{ routeId: string; stations: StationDtoRow[]; todayStationId: string | null } | null> {
  const routes = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip" },
    select: { id: true },
  });
  const graceEnd = (end: string): string =>
    dayOf(new Date(dayStart(end).getTime() + RUNNING_GRACE_DAYS * DAY_MS));

  let best: { routeId: string; start: string; stations: StationDtoRow[] } | null = null;
  for (const { id } of routes) {
    // Stations only: the phone lists them, and a route correction is not one.
    const stations = await prisma.tripStop.findMany({
      where: { routeId: id, ...STATIONS_ONLY },
      orderBy: { routeOrderIdx: "asc" },
      select: STATION_DTO_SELECT,
    });
    const span = spanOf(stations);
    if (!span.startDate || !span.endDate) continue;
    const start = span.startDate.slice(0, 10);
    const end = span.endDate.slice(0, 10);
    if (start > day || graceEnd(end) < day) continue;
    if (!best || start > best.start) best = { routeId: id, start, stations };
  }
  if (!best) return null;

  const today = [...best.stations].reverse().find((s) => {
    const { from, to } = stationSpan(s);
    return from !== null && to !== null && from <= day && day <= to;
  });
  return { routeId: best.routeId, stations: best.stations, todayStationId: today?.id ?? null };
}

export interface AppendStationInput {
  lat: number;
  lon: number;
  /** The phone's LOCAL date, YYYY-MM-DD. */
  date: string;
  night: "pass" | "free" | "stay";
  /** The caller's own stay; given exactly when `night` is "stay". */
  lodgingStayId?: string;
  title?: string;
}

interface LinkedStay {
  id: string;
  checkOut: Date | null;
  lodgingName: string;
}

/**
 * The stay a phone links, when it is the caller's. A foreign key proves the
 * stay exists, not whose it is — the same rule `assertStaysOwned` holds for
 * the web's whole-list write, and the same 404.
 */
async function ownStay(userId: string, stayId: string): Promise<LinkedStay> {
  const stay = await prisma.lodgingStay.findFirst({
    where: { id: stayId, userId },
    select: { id: true, checkOut: true, lodging: { select: { name: true } } },
  });
  if (!stay) throw new AppError("Stay not found", 404);
  return { id: stay.id, checkOut: stay.checkOut, lodgingName: stay.lodging.name };
}

/**
 * Where a night appended on `date` ends: the next morning for a free night;
 * for a stay its check-out, when that lies after `date` — a stay booked for
 * another week would otherwise give the station a span that ends before it
 * begins. A pass-through covers no night.
 */
function nightEnd(date: string, night: AppendStationInput["night"], stay: LinkedStay | null) {
  const nextMorning = new Date(dayStart(date).getTime() + DAY_MS);
  if (night === "pass") return null;
  if (stay?.checkOut && dayOf(stay.checkOut) > date) return dayStart(dayOf(stay.checkOut));
  return nextMorning;
}

/** "Hellesylt, Stranda" from the reverse geocoder; the station number when it has no answer. */
async function placeName(lat: number, lon: number, fallback: string): Promise<string> {
  const parts = await reverseGeocode(lat, lon);
  const name = parts?.city?.trim() || parts?.address?.split(",")[0]?.trim();
  return name && name.length > 0 ? name.slice(0, 200) : fallback;
}

/**
 * Append one station to the END of a roadtrip, where the phone stands.
 *
 * Idempotent: a station of this roadtrip on the same day within
 * `SAME_STATION_M` is the one a resend or a second tap means — it is returned
 * as it stands, nothing is added or changed (`created: false`). A free night
 * covers `date` to the next day, the way a station with a night reads
 * everywhere else; a stay night runs to the stay's check-out and takes the
 * lodging's name when the phone sends none (forgejo#132 item 2).
 */
export async function appendStation(
  userId: string,
  routeId: string,
  input: AppendStationInput
): Promise<{ stationId: string; created: boolean }> {
  // Before the resend check: a foreign stay id is refused, never answered 200.
  const stay =
    input.night === "stay" && input.lodgingStayId
      ? await ownStay(userId, input.lodgingStayId)
      : null;
  const stations = await prisma.tripStop.findMany({
    where: { routeId },
    orderBy: { routeOrderIdx: "asc" },
    select: { ...STATION_SELECT, lat: true, lon: true, routeOrderIdx: true },
  });

  // Every point stays in `stations` — the new leg must run from the last
  // one, correction or not — but only a station can be the one a resend means.
  const same = stations.filter(isStation).find((s) => {
    const { from } = stationSpan(s);
    return (
      from === input.date &&
      s.lat !== null &&
      s.lon !== null &&
      haversineKm({ lat: s.lat, lon: s.lon }, { lat: input.lat, lon: input.lon }) * 1000 <=
        SAME_STATION_M
    );
  });
  if (same) return { stationId: same.id, created: false };

  const title =
    input.title?.trim() ||
    stay?.lodgingName.trim().slice(0, 200) ||
    (await placeName(input.lat, input.lon, `Station ${stations.filter(isStation).length + 1}`));
  const { mode } = await prisma.tripRoute.findUniqueOrThrow({
    where: { id: routeId },
    select: { mode: true },
  });

  const { stationId, newLegs } = await prisma.$transaction(
    async (tx) => {
      // Read again under the route lock: a full-list write may have changed
      // the stations since the resend check above (review M1).
      await lockRoute(tx, routeId);
      const current = await tx.tripStop.findMany({
        where: { routeId },
        orderBy: { routeOrderIdx: "asc" },
        select: { id: true, lat: true, lon: true, routeOrderIdx: true },
      });
      const station = await tx.tripStop.create({
        data: {
          tripId: null,
          domain: "roadtrip",
          title,
          lat: input.lat,
          lon: input.lon,
          startDate: dayStart(input.date),
          endDate: nightEnd(input.date, input.night, stay),
          ...stationTimeColumns({
            startDate: dayStart(input.date),
            endDate: nightEnd(input.date, input.night, stay),
            lat: input.lat,
            lon: input.lon,
          }),
          overnight: input.night !== "pass",
          lodgingStayId: stay?.id ?? null,
          routeId,
          // After the highest position, not at the count: a gap in the
          // numbering would otherwise collide with @@unique([routeId, routeOrderIdx]).
          routeOrderIdx: Math.max(-1, ...current.map((s) => s.routeOrderIdx ?? -1)) + 1,
        },
        select: { id: true, lat: true, lon: true },
      });
      const ordered: StopCoords[] = [
        ...current.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon })),
        station,
      ];
      return { stationId: station.id, newLegs: await recomputeLegs(tx, routeId, mode, ordered) };
    },
    { timeout: 20_000 }
  );
  await autoRouteNewLegs(userId, routeId, newLegs);
  return { stationId, created: true };
}

/**
 * Take ONE station off a roadtrip — the phone's "Rückgängig" after "Heute
 * Nacht hier" (forgejo#132 item 1), without the whole-list PUT a stale phone
 * copy would undo web edits with.
 *
 * Any station of the caller's roadtrip, not only one the phone appended: no
 * column records who made a station, and `createdAt` cannot tell a phone's
 * append from a web save, so "phone-appended only" cannot be held from the
 * data. Nor would a time window protect anything — the same token may PUT the
 * whole list. What IS held is ownership: `routeId` is the caller's roadtrip
 * (resolved by the route), and the station must belong to it, else 404.
 *
 * The same rule the whole-list write applies to a dropped station: a trip's
 * timeline stop goes back to its trip (`released: true`), a roadtrip-owned
 * station is deleted. The remaining stations are renumbered contiguously and
 * the legs recomputed, so the two neighbours are joined by one new leg.
 */
export async function removeStation(
  userId: string,
  routeId: string,
  stationId: string
): Promise<{ released: boolean }> {
  const stations = await prisma.tripStop.findMany({
    where: { routeId },
    orderBy: { routeOrderIdx: "asc" },
    select: { id: true, lat: true, lon: true, tripId: true },
  });
  const target = stations.find((s) => s.id === stationId);
  if (!target) throw new AppError("Station not found", 404);
  const released = target.tripId !== null;
  const { mode } = await prisma.tripRoute.findUniqueOrThrow({
    where: { id: routeId },
    select: { mode: true },
  });

  const newLegs = await prisma.$transaction(
    async (tx) => {
      // Renumber what the route holds NOW, under its lock — not the list read
      // before (review M1): a station the web added meanwhile would otherwise
      // be left without a position.
      await lockRoute(tx, routeId);
      const rest = (
        await tx.tripStop.findMany({
          where: { routeId },
          orderBy: { routeOrderIdx: "asc" },
          select: { id: true, lat: true, lon: true },
        })
      ).filter((s) => s.id !== stationId);
      if (released) {
        await tx.tripStop.update({
          where: { id: stationId },
          data: { routeId: null, routeOrderIdx: null, lodgingStayId: null, overnight: false },
        });
      } else {
        await tx.tripStop.delete({ where: { id: stationId } });
      }
      // Free every position first: `@@unique([routeId, routeOrderIdx])`
      // would otherwise collide mid-renumber.
      await tx.tripStop.updateMany({ where: { routeId }, data: { routeOrderIdx: null } });
      for (const [index, s] of rest.entries()) {
        await tx.tripStop.update({ where: { id: s.id }, data: { routeOrderIdx: index } });
      }
      return recomputeLegs(tx, routeId, mode, rest);
    },
    { timeout: 20_000 }
  );
  await autoRouteNewLegs(userId, routeId, newLegs);
  return { released };
}

/**
 * Which trip and which roadtrip station a day belongs to — what a workout
 * recorded that day should be anchored to (companion#13). The trip whose
 * dates cover it (the latest started of several); the roadtrip station whose
 * span covers it (the one reached last on a travel day).
 */
export async function dayContext(
  userId: string,
  day: string
): Promise<{
  trip: { id: string; name: string } | null;
  station: { id: string; title: string; roadtripId: string; roadtripName: string } | null;
}> {
  const date = dayStart(day);
  const trip = await prisma.trip.findFirst({
    where: { userId, startDate: { lte: date }, endDate: { gte: date } },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true },
  });

  const candidates = await prisma.tripStop.findMany({
    where: { route: { userId, kind: "roadtrip" }, ...STATIONS_ONLY },
    select: {
      ...STATION_SELECT,
      route: { select: { id: true, name: true } },
    },
  });
  const covering = candidates
    .filter((s) => {
      const { from, to } = stationSpan(s);
      return from !== null && to !== null && from <= day && day <= to;
    })
    .sort((a, b) => (stationSpan(b).from ?? "").localeCompare(stationSpan(a).from ?? ""));
  const s = covering[0];
  return {
    trip,
    station: s?.route
      ? { id: s.id, title: s.title, roadtripId: s.route.id, roadtripName: s.route.name }
      : null,
  };
}
