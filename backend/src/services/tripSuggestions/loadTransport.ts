import { prisma } from "../../db";
import { endHasClock } from "../../shared/railClock";
import {
  busPresence,
  cruisePresence,
  ferryPresence,
  flightPresence,
  railPresence,
  rentalPresence,
  type PresenceState,
} from "../../shared/tripSuggestionRules";
import { airportCityName, airportDisplayName } from "../../utils/airportDisplay";
import type { FlightTimeSemantics } from "../../utils/timezone";
import { getCachedAirports } from "../airportCache";
import { addDays, daysBetween, placeClock, placeZone, storedDay } from "./time";
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
      depTimezone: true,
      arrTimezone: true,
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
    // The zone each end was WRITTEN with first, as every flight statistic
    // reads it — a date-only row is only its day in that zone (forgejo#273).
    const out = placeClock(
      row.departureTime,
      row.depTimezone ?? placeZone(dep?.timezone, row.depLat, row.depLon),
      row.depTimeSemantics as FlightTimeSemantics,
      8
    );
    const inn = row.arrivalTime
      ? placeClock(
          row.arrivalTime,
          row.arrTimezone ?? placeZone(arr?.timezone, row.arrLat, row.arrLon),
          row.arrTimeSemantics as FlightTimeSemantics,
          12
        )
      : { day: out.day, hour: Math.min(23, out.hour + 2), zoneKnown: out.zoneKnown };
    const points: PresencePoint[] = [
      { lat: row.depLat, lon: row.depLon, day: out.day, hour: out.hour },
      { lat: row.arrLat, lon: row.arrLon, day: inn.day, hour: inn.hour },
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
      // A destination is named by the city an airport serves (D10); the
      // airport's own name only where the catalogue cannot say.
      city: airportCityName(arr) ?? airportDisplayName(arr),
      country: arr?.country ?? null,
      pointCities: [
        airportCityName(dep) ?? airportDisplayName(dep),
        airportCityName(arr) ?? airportDisplayName(arr),
      ],
      zoneUnknown: !out.zoneKnown || !inn.zoneKnown,
      pnr: row.bookingReference,
    });
  }
  return { entries, truncated: rows.length > ROW_CAP };
}

/**
 * "Roma Termini" → "Roma", "München Hbf" → "München", "Frankfurt(Main)Hbf" →
 * "Frankfurt", "Paris Gare de Lyon" → "Paris", "Zürich HB" → "Zürich": a
 * station names its city first (D10 — a trip was named after a station).
 */
export function stationCity(name: string): string | null {
  const trimmed = name
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+(gare|bahnhof|station|stazione|estación|estacion)\b.*$/i, "")
    .replace(
      /[\s-]+(hbf\.?|hauptbahnhof|hb|sbb|centrale|centraal|central|termini|s\.\s?m\.\s?n\.)$/i,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
  return trimmed.length > 0 ? trimmed : null;
}

function railEndClock(
  at: Date,
  zone: string | null,
  precision: string | null,
  fallbackHour: number
): { day: string; hour: number; zoneKnown: boolean } {
  const clock = placeClock(at, zone, "UTC", fallbackHour);
  return endHasClock(precision) ? clock : { ...clock, hour: fallbackHour };
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
      depPrecision: true,
      arrPrecision: true,
      bookingReference: true,
    },
  });
  const entries: PresenceEntry[] = [];
  for (const row of rows.slice(0, ROW_CAP)) {
    const state = railPresence(row);
    if (state === "excluded") continue;
    // A ride's instants are real ones (the server read the ticket in the station's zone).
    // A date-only end keeps its day and takes the fallback hour, as a flight's
    // DATE_ONLY end does — its stored midnight is not a time (forgejo#132 item 17).
    const out = railEndClock(row.departureTime, row.depTimezone, row.depPrecision, 8);
    const inn = row.arrivalTime
      ? railEndClock(row.arrivalTime, row.arrTimezone, row.arrPrecision, 12)
      : { day: out.day, hour: Math.min(23, out.hour + 1), zoneKnown: out.zoneKnown };
    const points: PresencePoint[] = [
      { lat: row.depLat, lon: row.depLon, day: out.day, hour: out.hour },
      { lat: row.arrLat, lon: row.arrLon, day: inn.day, hour: inn.hour },
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
      zoneUnknown: !out.zoneKnown || !inn.zoneKnown,
      pnr: row.bookingReference,
    });
  }
  return { entries, truncated: rows.length > ROW_CAP };
}

/**
 * A coach ride or a ferry crossing as presence entries (forgejo#405): the same
 * columns as a train ride and the same reading of them — real instants on the
 * terminal's zone, a date-only end keeping its day and a conventional hour.
 */
const TERMINAL_RIDE_SELECT = {
  id: true,
  tripId: true,
  status: true,
  depStationName: true,
  arrStationName: true,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
  arrCountry: true,
  depTimezone: true,
  arrTimezone: true,
  departureTime: true,
  arrivalTime: true,
  depPrecision: true,
  arrPrecision: true,
  bookingReference: true,
} as const;

interface TerminalRideRow {
  id: string;
  tripId: string | null;
  status: string;
  depStationName: string;
  arrStationName: string;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  arrCountry: string | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  depPrecision: string | null;
  arrPrecision: string | null;
  bookingReference: string | null;
}

function terminalRideEntry(
  domain: "bus" | "ferry",
  row: TerminalRideRow,
  state: Exclude<PresenceState, "excluded">
): PresenceEntry {
  const out = railEndClock(row.departureTime, row.depTimezone, row.depPrecision, 8);
  const inn = row.arrivalTime
    ? railEndClock(row.arrivalTime, row.arrTimezone, row.arrPrecision, 12)
    : { day: out.day, hour: Math.min(23, out.hour + 1), zoneKnown: out.zoneKnown };
  const points: PresencePoint[] = [
    { lat: row.depLat, lon: row.depLon, day: out.day, hour: out.hour },
    { lat: row.arrLat, lon: row.arrLon, day: inn.day, hour: inn.hour },
  ];
  return {
    key: `${domain}:${row.id}`,
    domain,
    id: row.id,
    tripId: row.tripId,
    linkable: true,
    state,
    ...span(points),
    points,
    nights: overnight(out.day, inn.day),
    label: `${row.depStationName} → ${row.arrStationName}`,
    city: stationCity(row.arrStationName),
    country: row.arrCountry,
    pointCities: [stationCity(row.depStationName), stationCity(row.arrStationName)],
    zoneUnknown: !out.zoneKnown || !inn.zoneKnown,
    pnr: row.bookingReference,
  };
}

export async function loadBus(userId: string): Promise<Loaded> {
  const rows = await prisma.busJourney.findMany({
    where: { userId },
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
    take: ROW_CAP + 1,
    select: TERMINAL_RIDE_SELECT,
  });
  const entries: PresenceEntry[] = [];
  for (const row of rows.slice(0, ROW_CAP)) {
    const state = busPresence(row);
    if (state !== "excluded") entries.push(terminalRideEntry("bus", row, state));
  }
  return { entries, truncated: rows.length > ROW_CAP };
}

export async function loadFerry(userId: string): Promise<Loaded> {
  const rows = await prisma.ferryJourney.findMany({
    where: { userId },
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
    take: ROW_CAP + 1,
    select: TERMINAL_RIDE_SELECT,
  });
  const entries: PresenceEntry[] = [];
  for (const row of rows.slice(0, ROW_CAP)) {
    const state = ferryPresence(row);
    if (state !== "excluded") entries.push(terminalRideEntry("ferry", row, state));
  }
  return { entries, truncated: rows.length > ROW_CAP };
}

/**
 * A rental car as presence: where it was picked up and where it went back, on
 * each station's own calendar day. The car says nothing about where the
 * renter slept, so it contributes no nights — those come from stays and free
 * nights; a rental only widens the trip's span and adds its two places.
 */
export async function loadRentals(userId: string): Promise<Loaded> {
  const rows = await prisma.rentalBooking.findMany({
    where: { userId },
    orderBy: [{ pickupTime: "asc" }, { id: "asc" }],
    take: ROW_CAP + 1,
    select: {
      id: true,
      tripId: true,
      status: true,
      provider: true,
      confirmationNumber: true,
      pickupStationName: true,
      returnStationName: true,
      pickupLat: true,
      pickupLon: true,
      returnLat: true,
      returnLon: true,
      pickupCountry: true,
      returnCountry: true,
      pickupTimezone: true,
      returnTimezone: true,
      pickupTime: true,
      returnTime: true,
      pickupPrecision: true,
      returnPrecision: true,
    },
  });
  const entries: PresenceEntry[] = [];
  for (const row of rows.slice(0, ROW_CAP)) {
    const state = rentalPresence(row);
    if (state === "excluded") continue;
    const out = railEndClock(row.pickupTime, row.pickupTimezone, row.pickupPrecision, 10);
    const back = railEndClock(row.returnTime, row.returnTimezone, row.returnPrecision, 17);
    const points: PresencePoint[] = [
      { lat: row.pickupLat, lon: row.pickupLon, day: out.day, hour: out.hour },
      { lat: row.returnLat, lon: row.returnLon, day: back.day, hour: back.hour },
    ];
    entries.push({
      key: `rental:${row.id}`,
      domain: "rental",
      id: row.id,
      tripId: row.tripId,
      linkable: true,
      state,
      ...span(points),
      points,
      nights: [],
      label: `${row.provider} · ${row.pickupStationName}`,
      city: stationCity(row.returnStationName),
      country: row.returnCountry ?? row.pickupCountry,
      pointCities: [stationCity(row.pickupStationName), stationCity(row.returnStationName)],
      zoneUnknown: !out.zoneKnown || !back.zoneKnown,
      pnr: row.confirmationNumber,
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
    const startDay = storedDay(row.startDate);
    const endDay = row.endDate ? storedDay(row.endDate) : startDay;
    const points: PresencePoint[] = [];
    const cities: (string | null)[] = [];
    if (row.departurePort) {
      points.push({ ...row.departurePort, day: startDay, hour: 16 });
      cities.push(row.departurePort.city ?? row.departurePort.name);
    }
    for (const stop of row.stops) {
      if (!stop.port) continue;
      // `dayNumber` is the day of the cruise (forgejo#126), so an undated
      // stop sits that many days after embarkation.
      const day = stop.date ? storedDay(stop.date) : addDays(startDay, stop.dayNumber - 1);
      points.push({ lat: stop.port.lat, lon: stop.port.lon, day, hour: 12 });
      cities.push(stop.port.city ?? stop.port.name);
    }
    if (row.arrivalPort) {
      points.push({ ...row.arrivalPort, day: endDay, hour: 9 });
      cities.push(row.arrivalPort.city ?? row.arrivalPort.name);
    }
    if (points.length === 0) continue;
    const nights = daysBetween(startDay, endDay);
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
