import { prisma } from "../db";

export interface CachedAircraft {
  icao: string;
  name: string;
}

// Module-scope cache. The aircraft table is populated at boot and mutated only
// via /aircraft POST + the admin reseed (rare, manual), so a version-nulling
// cache with no TTL is correct — stale entries can't drift on their own.
// Single-container prod only; add a TTL/version check if multi-container.
let cache: CachedAircraft[] | null = null;

async function load(): Promise<CachedAircraft[]> {
  const rows = await prisma.aircraft.findMany({
    where: { icao: { not: null } },
    select: { icao: true, name: true },
  });
  return rows
    .filter((r): r is { icao: string; name: string } => r.icao !== null)
    .map((r) => ({ icao: r.icao, name: r.name }));
}

export async function getAircraftCatalog(): Promise<CachedAircraft[]> {
  if (cache === null) cache = await load();
  return cache;
}

export async function preloadAircraftCatalog(): Promise<void> {
  cache = await load();
}

export function getAircraftCatalogSync(): CachedAircraft[] {
  return cache ?? [];
}

export function invalidateAircraftCatalogCache(): void {
  cache = null;
}
