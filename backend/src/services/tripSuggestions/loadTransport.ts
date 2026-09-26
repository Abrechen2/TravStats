import { prisma } from "../../db";
import { cruisePresence, flightPresence, railPresence } from "../../shared/tripSuggestionRules";
import { airportDisplayName } from "../../utils/airportDisplay";
import { localWallClockOf, type FlightTimeSemantics } from "../../utils/timezone";
import { getCachedAirports } from "../airportCache";
import type { PresenceEntry, PresencePoint } from "./types";

/**
 * Flights, rides and cruises as presence entries: two ends (or a string of
 * ports), each on its own local calendar day.
 *
 * Every loader reads at most `ROW_CAP` rows of its table and says so when it
 * had to stop — a truncated timeline is reported, never passed off as whole.
 */

export const ROW_CAP = 10_000;

export interface Loaded {
  entries: PresenceEntry[];
  truncated: boolean;
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** Local day and hour of a stored time; a date-only time sorts at `fallbackHour`. */
function wall(
  at: Date,
  timezone: string | null,
  semantics: FlightTimeSemantics,
  fallbackHour: number
): { day: string; hour: number } {
  const clock = localWallClockOf(at, timezone, semantics);
  return { day: clock.date, hour: clock.hour ?? fallbackHour };
}

function span(points: readonly PresencePoint[]): { startDay: string; endDay: string } {
  const days = points.map((p) => p.day).sort();
  return { startDay: days[0], endDay: days[days.length - 1] };
}

/** The night of the departure day, when a journey arrives on a later local day. */
const overnight = (dep: string, arr: string): string[] => (arr > dep ? [dep] : []);

export async function loadFlights(userId: string): Promise<Loaded> {
  const rows = await prisma.flight.findMany({
    where: { userId, departureTime: { not: null } },
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
    take: ROW_CAP + 1,
    select: {
      id: true,
      tripId: true,
      status: true,
      flightNumber: true,
      bookingReference: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      departureTime: true,
      arrivalTime: true,
      depTimeSemantics: true,
      arrTimeSemantics: true,
    },
  });
  const kept = rows.slice(0, ROW_CAP);
  const codes = kept.flatMap((r) => [r.depIata, r.depIcao, r.arrIata, r.arrIcao]);
  const airports = await getCachedAirports([...new Set(codes.filter((c): c is string => !!c))]);
  const at = (iata: string | null, icao: string | null) =>
    (iata ? airports.get(iata) : undefined) ?? (icao ? airports.get(icao) : undefined) ?? null;

  const entries: PresenceEntry[] = [];
  for (const row of kept) {
    const state = flightPresence(row);
    if (state === "excluded" || !row.departureTime) continue;
    const dep = at(row.depIata, row.depIcao);
    const arr = at(row.arrIata, row.arrIcao);
    const out = wall(
      row.departureTime,
      dep?.timezone ?? null,
      row.depTimeSemantics as FlightTimeSemantics,
      8
    );
    const inn = row.arrivalTime
      ? wall(
          row.arrivalTime,
          arr?.timezone ?? null,
          row.arrTimeSemantics as FlightTimeSemantics,
          12
        )
      : { day: out.day, hour: Math.min(23, out.hour + 2) };
    const points: PresencePoint[] = [
      { lat: row.depLat, lon: row.depLon, ...out },
      { lat: row.arrLat, lon: row.arrLon, ...inn },
    ];
    const depCode = row.depIata ?? row.depIcao ?? "?";
    const arrCode = row.arrIata ?? row.arrIcao ?? "?";
    entries.push({
      key: `flight:${row.id}`,
      domain: "flight",
      id: row.id,
      tripId: row.tripId,
      linkable: true,
      state,
      ...span(points),
      points,
      nights: overnight(out.day, inn.day),
      label: [row.flightNumber, `${depCode} → ${arrCode}`].filter(Boolean).join(" "),
      city: airportDisplayName(arr),
      country: arr?.country ?? null,
      pointCities: [airportDisplayName(dep), airportDisplayName(arr)],
      pnr: row.bookingReference,
    });
  }
  return { entries, truncated: rows.length > ROW_CAP };
}

/** "Roma Termini" → "Roma", "München Hbf" → "München": a station names its city first. */
export function stationCity(name: string): string | null {
  const trimmed = name
    .replace(/\s*\(.*\)\s*$/, "")
    .replace(
      /[\s-]+(hbf\.?|hauptbahnhof|centrale|centraal|central|termini|station|bahnhof|gare|s\.\s?m\.\s?n\.)$/i,
      ""
    )
    .trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function loadRail(userId: string): Promise<Loaded> {
  const rows = await prisma.railJourney.findMany({
    where: { userId },
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
    take: ROW_CAP + 1,
    select: {
      id: true,
      tripId: true,
      status: true,
      trainCategory: true,
      trainNumber: true,
      depStationName: true,
      arrStationName: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      depCountry: true,
      arrCountry: true,
      depTimezone: true,
      arrTimezone: true,
      departureTime: true,
      arrivalTime: true,
      bookingReference: true,
    },
  });
  const entries: PresenceEntry[] = [];
  for (const row of rows.slice(0, ROW_CAP)) {
    const state = railPresence(row);
    if (state === "excluded") continue;
    // A ride's instants are real ones (the server read the ticket in the station's zone).
    const out = wall(row.departureTime, row.depTimezone, "UTC", 8);
    const inn = row.arrivalTime
      ? wall(row.arrivalTime, row.arrTimezone, "UTC", 12)
      : { day: out.day, hour: Math.min(23, out.hour + 1) };
    const points: PresencePoint[] = [
      { lat: row.depLat, lon: row.depLon, ...out },
      { lat: row.arrLat, lon: row.arrLon, ...inn },
    ];
    const train = [row.trainCategory, row.trainNumber].filter(Boolean).join(" ");
    entries.push({
      key: `rail:${row.id}`,
      domain: "rail",
      id: row.id,
      tripId: row.tripId,
      linkable: true,
      state,
      ...span(points),
      points,
      nights: overnight(out.day, inn.day),
      label: [train, `${row.depStationName} → ${row.arrStationName}`].filter(Boolean).join(" "),
      city: stationCity(row.arrStationName),
      country: row.arrCountry,
      pointCities: [stationCity(row.depStationName), stationCity(row.arrStationName)],
      pnr: row.bookingReference,
    });
  }
  return { entries, truncated: rows.length > ROW_CAP };
}

const portSelect = { name: true, city: true, country: true, lat: true, lon: true } as const;

export async function loadCruises(userId: string): Promise<Loaded> {
  const rows = await prisma.cruise.findMany({
    where: { userId, startDate: { not: null } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    take: ROW_CAP + 1,
    select: {
      id: true,
      tripId: true,
      status: true,
      routeName: true,
      shipNameOverride: true,
      startDate: true,
      endDate: true,
      ship: { select: { name: true } },
      departurePort: { select: portSelect },
      arrivalPort: { select: portSelect },
      stops: {
        where: { isAtSea: false, portId: { not: null } },
        select: { dayNumber: true, date: true, port: { select: portSelect } },
        orderBy: { dayNumber: "asc" },
      },
    },
  });
  const entries: PresenceEntry[] = [];
  for (const row of rows.slice(0, ROW_CAP)) {
    const state = cruisePresence(row);
    if (state === "excluded" || !row.startDate) continue;
    const startDay = ymd(row.startDate);
    const endDay = row.endDate ? ymd(row.endDate) : startDay;
    const points: PresencePoint[] = [];
    const cities: (string | null)[] = [];
    if (row.departurePort) {
      points.push({ ...row.departurePort, day: startDay, hour: 16 });
      cities.push(row.departurePort.city ?? row.departurePort.name);
    }
    for (const stop of row.stops) {
      if (!stop.port) continue;
      const day = stop.date
        ? ymd(stop.date)
        : ymd(new Date(row.startDate.getTime() + (stop.dayNumber - 1) * 86_400_000));
      points.push({ lat: stop.port.lat, lon: stop.port.lon, day, hour: 12 });
      cities.push(stop.port.city ?? stop.port.name);
    }
    if (row.arrivalPort) {
      points.push({ ...row.arrivalPort, day: endDay, hour: 9 });
      cities.push(row.arrivalPort.city ?? row.arrivalPort.name);
    }
    if (points.length === 0) continue;
    const nights: string[] = [];
    for (let t = row.startDate.getTime(); ymd(new Date(t)) < endDay; t += 86_400_000) {
      nights.push(ymd(new Date(t)));
    }
    entries.push({
      key: `cruise:${row.id}`,
      domain: "cruise",
      id: row.id,
      tripId: row.tripId,
      linkable: true,
      state,
      startDay,
      endDay,
      points: points.map(({ lat, lon, day, hour }) => ({ lat, lon, day, hour })),
      nights,
      label: row.routeName ?? row.shipNameOverride ?? row.ship?.name ?? "",
      city: row.arrivalPort?.city ?? null,
      country: row.arrivalPort?.country ?? null,
      pointCities: cities,
    });
  }
  return { entries, truncated: rows.length > ROW_CAP };
}
