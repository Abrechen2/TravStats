/**
 * The version-6 half of the writer (UAT 2026-11-27, `formatExtras.ts`): a flight's gate,
 * terminal and flown distance, a ferry's line, a cruise's legs and drawn lines, and the timeline
 * stops that wrap an entry — all of which an export used to drop. Runs after `collect.ts` built
 * the file, with the same key functions, so every reference names the file's own keys.
 */
import { prisma } from "../../../db";
import type { TripFile } from "./format";
import type { StopSourceDomain } from "./formatExtras";
import type { LoadedTrip } from "./collect";

type Keyer = (id: string) => string;
export type ExtraKeyers = Record<StopSourceDomain | "stop", Keyer>;

interface PortLike {
  unlocode: string | null;
  name: string;
  country: string | null;
  lat: number;
  lon: number;
}
const ref = (p: PortLike) => ({
  unlocode: p.unlocode,
  name: p.name,
  country: p.country,
  lat: p.lat,
  lon: p.lon,
});
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** A stored line as `[lon, lat]` pairs, or null when it is not one. */
function asLine(v: unknown): [number, number][] | null {
  const coords = Array.isArray(v)
    ? v
    : v && typeof v === "object" && Array.isArray((v as { coordinates?: unknown }).coordinates)
      ? (v as { coordinates: unknown[] }).coordinates
      : null;
  if (!coords || coords.length < 2) return null;
  const out: [number, number][] = [];
  for (const c of coords) {
    if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") return null;
    out.push([c[0], c[1]]);
  }
  return out;
}

export async function addExtras(
  trip: LoadedTrip,
  file: TripFile,
  keys: ExtraKeyers,
  priv: boolean
): Promise<void> {
  const flightById = new Map(trip.flights.map((f) => [keys.flight(f.id), f]));
  file.flights = file.flights.map((f) => {
    const row = flightById.get(f.key);
    return row
      ? { ...f, gate: row.gate, terminal: row.terminal, routeDistance: row.routeDistance }
      : f;
  });
  const ferryById = new Map(trip.ferryJourneys.map((r) => [keys.ferry(r.id), r]));
  file.ferry = file.ferry.map((r) => {
    const row = ferryById.get(r.key);
    const geometry = row ? asLine(row.geometry) : null;
    // No line, nothing to carry: the reader's default (straight) is what it was.
    return row && geometry
      ? { ...r, geometry, geometrySource: row.geometrySource, manualScope: row.manualScope }
      : r;
  });
  await addCruiseLines(trip, file, keys);
  file.stops = [...file.stops, ...(await wrappedStops(trip, keys, priv))];
}

async function addCruiseLines(trip: LoadedTrip, file: TripFile, keys: ExtraKeyers) {
  const ids = trip.cruises.map((c) => c.id);
  if (ids.length === 0) return;
  const [legs, routes] = await Promise.all([
    prisma.cruiseLeg.findMany({
      where: { cruiseId: { in: ids } },
      include: { fromPort: true, toPort: true },
      orderBy: { ordinal: "asc" },
    }),
    prisma.cruiseLegRoute.findMany({ where: { cruiseId: { in: ids } } }),
  ]);
  const portIds = [
    ...new Set(
      routes
        .flatMap((r) => [r.fromRef, r.toRef])
        .map(Number)
        .filter(Number.isFinite)
    ),
  ];
  const ports = new Map(
    (await prisma.port.findMany({ where: { id: { in: portIds } } })).map((p) => [String(p.id), p])
  );
  file.cruises = file.cruises.map((c) => {
    const id = trip.cruises.find((x) => keys.cruise(x.id) === c.key)?.id;
    if (!id) return c;
    const legRoutes = routes.flatMap((r) => {
      const from = ports.get(r.fromRef);
      const to = ports.get(r.toRef);
      const waypoints = asLine(r.waypoints);
      return r.cruiseId === id &&
        r.fromKind === "port" &&
        r.toKind === "port" &&
        from &&
        to &&
        waypoints
        ? [{ from: ref(from), to: ref(to), waypoints }]
        : [];
    });
    return {
      ...c,
      legs: legs
        .filter((l) => l.cruiseId === id)
        .map((l) => ({
          ordinal: l.ordinal,
          from: ref(l.fromPort),
          to: ref(l.toPort),
          distanceKm: l.distanceKm,
          method: l.method,
          routerVersion: l.routerVersion,
          dataVersion: l.dataVersion,
          confidence: l.confidence,
          computedAt: l.computedAt.toISOString(),
        })),
      legRoutes,
    };
  });
}

/** Timeline stops that wrap an entry of this trip, with the entry's file key. */
async function wrappedStops(
  trip: LoadedTrip,
  keys: ExtraKeyers,
  priv: boolean
): Promise<TripFile["stops"]> {
  const rows = await prisma.tripStop.findMany({
    where: { tripId: trip.id, routeId: null, sourceId: { not: null } },
    orderBy: { orderIdx: "asc" },
  });
  const held: Record<StopSourceDomain, Set<string>> = {
    flight: new Set(trip.flights.map((f) => f.id)),
    lodging: new Set(trip.lodgingStays.map((s) => s.id)),
    cruise: new Set(trip.cruises.map((c) => c.id)),
    rail: new Set(trip.railJourneys.map((r) => r.id)),
    bus: new Set(trip.busJourneys.map((r) => r.id)),
    ferry: new Set(trip.ferryJourneys.map((r) => r.id)),
    rental: new Set(trip.rentalBookings.map((r) => r.id)),
  };
  return rows.flatMap((s) => {
    const domain = s.domain as StopSourceDomain | null;
    // A wrapped entry that is not in this file (another trip's, a place) is not written.
    if (!domain || !(domain in held) || !s.sourceId || !held[domain].has(s.sourceId)) return [];
    return [
      {
        key: keys.stop(s.id),
        orderIdx: s.orderIdx,
        title: s.title,
        description: s.description,
        startDate: iso(s.startDate),
        endDate: iso(s.endDate),
        startUtc: iso(s.startUtc),
        endUtc: iso(s.endUtc),
        stopZone: s.stopZone,
        precision: s.precision,
        lat: s.lat,
        lon: s.lon,
        overnight: s.overnight,
        placeKey: null,
        stayKey:
          s.lodgingStayId && held.lodging.has(s.lodgingStayId)
            ? keys.lodging(s.lodgingStayId)
            : null,
        domain,
        sourceKey: keys[domain](s.sourceId),
        ...(priv ? { private: { notes: s.notes } } : {}),
      },
    ];
  });
}
