import { prisma } from "../db";
import type { AirportRow } from "../seedDemoAccount";

/**
 * Lookups for the narrated demo data. A missing airport, port or ship is a
 * broken seed, not an optional row: fail loudly instead of dropping a flight.
 * Ports go by UN/LOCODE — the name pool has "Naples" twice.
 */
export function airportByIata(airports: Map<string, AirportRow>, iata: string): AirportRow {
  const airport = airports.get(iata);
  if (!airport) throw new Error(`Demo seed: airport ${iata} is not in the pool (AIRPORT_IATAS)`);
  return airport;
}

export async function portIdByLocode(locode: string): Promise<number> {
  const port = await prisma.port.findFirst({ where: { unlocode: locode }, select: { id: true } });
  if (!port) throw new Error(`Demo seed: port ${locode} is not in the catalogue`);
  return port.id;
}

export async function shipByName(name: string): Promise<{ id: number; name: string; cruiseLine: string }> {
  const ship = await prisma.ship.findFirst({
    where: { name },
    select: { id: true, name: true, cruiseLine: true },
  });
  if (!ship) throw new Error(`Demo seed: ship ${name} is not in the catalogue`);
  return ship;
}

/**
 * The one soft lookup: init.ts seeds the demo before the server seeds the
 * curated catalogue, so a place stays unlinked rather than failing the seed.
 */
export async function curatedIdIfPresent(id: string): Promise<string | null> {
  const item = await prisma.curatedPlace.findUnique({ where: { id }, select: { id: true } });
  return item?.id ?? null;
}
