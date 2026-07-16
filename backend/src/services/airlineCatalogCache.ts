import { prisma } from "../db";

export interface CachedAirline {
  iata: string;
  icao: string | null;
  name: string;
}

// Module-scope cache. The airlines table is populated at boot and mutated only
// via /airlines POST + the admin reseed (rare, manual), so a version-nulling
// cache with no TTL is correct — stale entries can't drift on their own.
// Single-container prod only; add a TTL/version check if multi-container.
let cache: CachedAirline[] | null = null;

async function load(): Promise<CachedAirline[]> {
  const rows = await prisma.airline.findMany({
    where: { iata: { not: null } },
    select: { iata: true, icao: true, name: true },
  });
  return rows
    .filter((r): r is { iata: string; icao: string | null; name: string } => r.iata !== null)
    .map((r) => ({ iata: r.iata, icao: r.icao, name: r.name }));
}

export async function getAirlineCatalog(): Promise<CachedAirline[]> {
  if (cache === null) cache = await load();
  return cache;
}

export async function preloadAirlineCatalog(): Promise<void> {
  cache = await load();
}

export function getAirlineCatalogSync(): CachedAirline[] {
  return cache ?? [];
}

export function invalidateAirlineCatalogCache(): void {
  cache = null;
}
