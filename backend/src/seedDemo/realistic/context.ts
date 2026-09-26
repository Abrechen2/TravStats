import { prisma } from "../../db";
import { getBaseCurrency } from "../../services/fx/snapshot";
import { resolveCompanions } from "../../services/companionService";
import { ROADTRIPS, TOURS } from "./data/routeSpecs";
import { STATIONS } from "./data/stations";
import type { TripSpec } from "./data/types";
import { USER_CHAIN } from "./data/lodgings";

/**
 * Everything the writers look up more than once, read before the first row is
 * written. A missing airport, ship or port is a broken seed and fails loudly
 * here, before anything is half-written; the soft catalogues (rail stations,
 * curated places, chains) may legitimately be absent on a boot that has not
 * seeded them yet, and are linked only where present.
 */

export interface AirportRow {
  id: number;
  iata: string | null;
  icao: string | null;
  name: string;
  lat: number;
  lon: number;
}

export interface SeedContext {
  userId: string;
  now: Date;
  baseCurrency: string;
  airports: Map<string, AirportRow>;
  shipIdByName: Map<string, { id: number; cruiseLine: string }>;
  portByLocode: Map<string, { id: number; lat: number; lon: number }>;
  stationIdByUic: Map<string, number>;
  curatedIds: Set<string>;
  chainIdByName: Map<string, number>;
  companionIdByName: Map<string, string>;
  /** Lodging row id per catalogue key, filled as houses are first written. */
  lodgingIds: Map<string, string>;
  /** Place row id per place identity, so a sight visited twice is one place. */
  placeIds: Map<string, string>;
  membershipIdByProgram: Map<string, string>;
  /** Roadtrip station ids per roadtrip key, for tours that set out from a station. */
  stationIdsByRoadtrip: Map<string, string[]>;
}

function iatasOf(trips: readonly TripSpec[]): string[] {
  const codes = new Set<string>();
  for (const trip of trips) for (const f of trip.flights ?? []) codes.add(f.from).add(f.to);
  return [...codes];
}

function portsOf(trips: readonly TripSpec[]): string[] {
  const codes = new Set<string>();
  for (const trip of trips) {
    for (const stop of trip.cruise?.stops ?? []) if ("locode" in stop) codes.add(stop.locode);
  }
  return [...codes];
}

async function loadAirports(codes: string[]): Promise<Map<string, AirportRow>> {
  const rows = await prisma.airport.findMany({
    where: { iata: { in: codes }, isClosed: false },
    select: { id: true, iata: true, icao: true, name: true, lat: true, lon: true },
  });
  const byIata = new Map<string, AirportRow>();
  for (const row of rows) if (row.iata) byIata.set(row.iata, row);
  const missing = codes.filter((c) => !byIata.has(c));
  if (missing.length > 0) {
    throw new Error(
      `Demo seed: airports ${missing.join(", ")} are not in the catalogue — seed airports first`
    );
  }
  return byIata;
}

async function loadPorts(
  codes: string[]
): Promise<Map<string, { id: number; lat: number; lon: number }>> {
  const rows = await prisma.port.findMany({
    where: { unlocode: { in: codes } },
    select: { id: true, unlocode: true, lat: true, lon: true },
  });
  const byCode = new Map(
    rows.map((r) => [r.unlocode as string, { id: r.id, lat: r.lat, lon: r.lon }])
  );
  const missing = codes.filter((c) => !byCode.has(c));
  if (missing.length > 0)
    throw new Error(`Demo seed: ports ${missing.join(", ")} are not in the catalogue`);
  return byCode;
}

async function loadShips(
  trips: readonly TripSpec[]
): Promise<Map<string, { id: number; cruiseLine: string }>> {
  const names = trips.flatMap((t) =>
    t.cruise && "catalogue" in t.cruise.ship ? [t.cruise.ship.catalogue] : []
  );
  const rows = await prisma.ship.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true, cruiseLine: true },
  });
  const byName = new Map(rows.map((r) => [r.name, { id: r.id, cruiseLine: r.cruiseLine }]));
  const missing = names.filter((n) => !byName.has(n));
  if (missing.length > 0)
    throw new Error(`Demo seed: ships ${missing.join(", ")} are not in the catalogue`);
  return byName;
}

async function loadStations(): Promise<Map<string, number>> {
  const uics = Object.values(STATIONS).flatMap((s) => (s.uic ? [s.uic] : []));
  const rows = await prisma.railStation.findMany({
    where: { uic: { in: uics }, parentSourceId: null },
    select: { id: true, uic: true },
    orderBy: { id: "asc" },
  });
  const byUic = new Map<string, number>();
  for (const row of rows) if (row.uic && !byUic.has(row.uic)) byUic.set(row.uic, row.id);
  return byUic;
}

async function loadCurated(
  trips: readonly TripSpec[],
  extra: readonly string[]
): Promise<Set<string>> {
  const ids = [
    ...trips.flatMap((t) => (t.places ?? []).flatMap((p) => (p.curated ? [p.curated] : []))),
    ...extra,
  ];
  const rows = await prisma.curatedPlace.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * The catalogue chains by name, plus the one chain the demo traveller adds
 * for themselves. It is the account's own row (`userId` set), exactly what the
 * chain form writes; the catalogue is never written to (finding A3).
 */
async function loadChains(userId: string): Promise<Map<string, number>> {
  const catalogue = await prisma.lodgingChain.findMany({
    where: { userId: null },
    select: { id: true, name: true },
  });
  const byName = new Map(catalogue.map((c) => [c.name, c.id]));
  const own = await prisma.lodgingChain.create({
    data: { userId, name: USER_CHAIN.name, brandColor: USER_CHAIN.brandColor, isUserAdded: true },
  });
  byName.set(own.name, own.id);
  return byName;
}

export async function buildContext(
  userId: string,
  now: Date,
  trips: readonly TripSpec[],
  extraCurated: readonly string[]
): Promise<SeedContext> {
  const companionNames = [...new Set(trips.flatMap((t) => t.companions ?? []))];
  const [
    airports,
    portByLocode,
    shipIdByName,
    stationIdByUic,
    curatedIds,
    chainIdByName,
    companions,
    baseCurrency,
  ] = await Promise.all([
    loadAirports(iatasOf(trips)),
    loadPorts(portsOf(trips)),
    loadShips(trips),
    loadStations(),
    loadCurated(trips, extraCurated),
    loadChains(userId),
    resolveCompanions(userId, companionNames),
    getBaseCurrency(userId),
  ]);
  if (ROADTRIPS.length === 0 || TOURS.length === 0)
    throw new Error("Demo seed: route specs are empty");
  return {
    userId,
    now,
    baseCurrency,
    airports,
    shipIdByName,
    portByLocode,
    stationIdByUic,
    curatedIds,
    chainIdByName,
    companionIdByName: new Map(companions.map((c) => [c.displayName, c.id])),
    lodgingIds: new Map(),
    placeIds: new Map(),
    membershipIdByProgram: new Map(),
    stationIdsByRoadtrip: new Map(),
  };
}

/** The companion ids of a list of names, in the order given. */
export function companionIds(ctx: SeedContext, names: readonly string[] | undefined): string[] {
  return (names ?? []).map((name) => {
    const id = ctx.companionIdByName.get(name);
    if (!id) throw new Error(`Demo seed: companion ${name} was not resolved`);
    return id;
  });
}
