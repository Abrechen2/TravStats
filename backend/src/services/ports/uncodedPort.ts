/**
 * A catalogue port without a UN/LOCODE (Esna, Edfu, Kom Ombo on the Nile) found by name, country
 * and place. One home for the rule, read by the federation receiver and by the `.travstats`
 * import: the import resolved ports by code only, so a Nile cruise from another server's file
 * arrived with six unresolved stops and lost its legs and lines (sharing UAT 2, 2026-11-27).
 */
import type { DbTransaction } from "../../db";
import { haversineKm } from "../../shared/geo/haversine";

/**
 * How far apart the same catalogue port may sit on two servers. The catalogue is seeded from one
 * file, so the rows agree to the digit; the tolerance only absorbs rounding, and two different
 * ports of one name (there are several "Victoria") are hundreds of kilometres apart.
 */
export const PORT_POSITION_MATCH_KM = 1;

export interface UncodedPortRow {
  id: number;
  name: string;
  country: string | null;
  lat: number;
  lon: number;
}

export interface UncodedPortRef {
  name: string;
  country: string | null;
  lat: number;
  lon: number;
}

type PortFinder = { port: Pick<DbTransaction["port"], "findMany"> };

/** The catalogue's code-less ports carrying any of these names (user-added ports never match). */
export async function loadUncodedPorts(
  client: PortFinder,
  names: readonly string[]
): Promise<UncodedPortRow[]> {
  const unique = [...new Set(names.filter((n) => n.trim() !== ""))];
  if (unique.length === 0) return [];
  return client.port.findMany({
    where: { name: { in: unique }, unlocode: null, isUserAdded: false },
    select: { id: true, name: true, country: true, lat: true, lon: true },
    orderBy: { id: "asc" },
  });
}

/** The ONE catalogue port of that name, country and place — else none. */
export function uncodedPort(rows: readonly UncodedPortRow[], ref: UncodedPortRef): number | null {
  const hits = rows.filter(
    (r) =>
      r.name === ref.name &&
      r.country === ref.country &&
      haversineKm({ lat: r.lat, lon: r.lon }, { lat: ref.lat, lon: ref.lon }) <=
        PORT_POSITION_MATCH_KM
  );
  // Two candidates are a guess between them: left unresolved, the name is kept.
  return hits.length === 1 ? hits[0].id : null;
}
