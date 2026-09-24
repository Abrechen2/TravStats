import { prisma } from "../../db";
import { haversineKm } from "../../shared/geo/haversine";
import { reverseGeocode } from "../geo/nominatim";
import { recomputeLegs, type StopCoords } from "../tour/legRecompute";
import { autoRouteNewLegs } from "../tour/routing/autoRouteLegs";
import { STATION_SELECT, spanOf, type StationRow } from "./roadtripSummary";

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
): Promise<{ routeId: string; stations: StationRow[]; todayStationId: string | null } | null> {
  const routes = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip" },
    select: { id: true },
  });
  const graceEnd = (end: string): string =>
    dayOf(new Date(dayStart(end).getTime() + RUNNING_GRACE_DAYS * DAY_MS));

  let best: { routeId: string; start: string; stations: StationRow[] } | null = null;
  for (const { id } of routes) {
    const stations = await prisma.tripStop.findMany({
      where: { routeId: id },
      orderBy: { routeOrderIdx: "asc" },
      select: STATION_SELECT,
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
  night: "pass" | "free";
  title?: string;
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
 * `SAME_STATION_M` is the one a resend or a second tap means — it is returned,
 * nothing is added (`created: false`). A free night covers `date` to the next
 * day, the way a station with a night reads everywhere else.
 */
export async function appendStation(
  userId: string,
  routeId: string,
  input: AppendStationInput
): Promise<{ stationId: string; created: boolean }> {
  const stations = await prisma.tripStop.findMany({
    where: { routeId },
    orderBy: { routeOrderIdx: "asc" },
    select: { ...STATION_SELECT, lat: true, lon: true, routeOrderIdx: true },
  });

  const same = stations.find((s) => {
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
    (await placeName(input.lat, input.lon, `Station ${stations.length + 1}`));
  const { mode } = await prisma.tripRoute.findUniqueOrThrow({
    where: { id: routeId },
    select: { mode: true },
  });

  const { stationId, newLegs } = await prisma.$transaction(
    async (tx) => {
      const station = await tx.tripStop.create({
        data: {
          tripId: null,
          domain: "roadtrip",
          title,
          lat: input.lat,
          lon: input.lon,
          startDate: dayStart(input.date),
          endDate:
            input.night === "free" ? new Date(dayStart(input.date).getTime() + DAY_MS) : null,
          overnight: input.night === "free",
          lodgingStayId: null,
          routeId,
          // After the highest position, not at the count: a gap in the
          // numbering would otherwise collide with @@unique([routeId, routeOrderIdx]).
          routeOrderIdx: Math.max(-1, ...stations.map((s) => s.routeOrderIdx ?? -1)) + 1,
        },
        select: { id: true, lat: true, lon: true },
      });
      const ordered: StopCoords[] = [
        ...stations.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon })),
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
    where: { route: { userId, kind: "roadtrip" } },
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
