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
  /** A port a person or a shared cruise added; a catalogue port of the same place wins over it. */
  isUserAdded?: boolean;
}

export interface UncodedPortRef {
  name: string;
  country: string | null;
  lat: number;
  lon: number;
}

type PortFinder = { port: Pick<DbTransaction["port"], "findMany"> };
type PortWriter = { port: Pick<DbTransaction["port"], "findMany" | "create"> };

/** The code-less ports carrying any of these names — read only; `uncodedPort` picks among them. */
export async function loadUncodedPorts(
  client: PortFinder,
  names: readonly string[]
): Promise<UncodedPortRow[]> {
  const unique = [...new Set(names.filter((n) => n.trim() !== ""))];
  if (unique.length === 0) return [];
  return client.port.findMany({
    where: { name: { in: unique }, unlocode: null },
    select: { id: true, name: true, country: true, lat: true, lon: true, isUserAdded: true },
    orderBy: { id: "asc" },
  });
}

const near = (r: UncodedPortRow, ref: UncodedPortRef) =>
  haversineKm({ lat: r.lat, lon: r.lon }, { lat: ref.lat, lon: ref.lon }) <= PORT_POSITION_MATCH_KM;

/**
 * The ONE port of that name, country and place — a catalogue port first, else one a person or a
 * shared cruise added there. Two candidates are a guess between them: none.
 */
export function uncodedPort(rows: readonly UncodedPortRow[], ref: UncodedPortRef): number | null {
  const hits = rows.filter((r) => r.name === ref.name && r.country === ref.country && near(r, ref));
  const catalogue = hits.filter((r) => !r.isUserAdded);
  if (catalogue.length > 0) return catalogue.length === 1 ? catalogue[0].id : null;
  return hits.length === 1 ? hits[0].id : null;
}

/** At most this many ports one received message may add — a cruise names a few dozen at most. */
export const MAX_CARRIED_PORTS_PER_MESSAGE = 40;

/**
 * Make the code-less ports a received cruise names available here — ONLY on accepting or applying
 * the entry, never while reading or comparing it. A port with nothing of its name within 1 km (no
 * catalogue port, no earlier user port) is added as a user port with the sender's name, country and
 * position, recording the server that brought it. Sharing UAT 2: the owner's Yangtze ports are his
 * own additions, so his father's server knew none of them and dropped every leg and the drawn line.
 * Returns how many were added; past the message's budget (the cap counts across every entry of
 * one message, security review) the rest stay unresolved port calls.
 */
/** How many more ports one received message may still add; shared by all its entries. */
export interface PortBudget {
  left: number;
}

export const newPortBudget = (): PortBudget => ({ left: MAX_CARRIED_PORTS_PER_MESSAGE });

export async function ensureCarriedPorts(
  client: PortWriter,
  refs: readonly UncodedPortRef[],
  source: string,
  budget: PortBudget = newPortBudget()
): Promise<number> {
  const wanted = refs.filter(
    (r) => r.name.trim() !== "" && Number.isFinite(r.lat) && Number.isFinite(r.lon)
  );
  const names = [...new Set(wanted.map((r) => r.name))];
  if (names.length === 0) return 0;
  const rows: UncodedPortRow[] = await client.port.findMany({
    where: { name: { in: names }, unlocode: null },
    select: { id: true, name: true, country: true, lat: true, lon: true, isUserAdded: true },
    orderBy: { id: "asc" },
  });
  let added = 0;
  for (const ref of wanted) {
    // Anything of that name at that place (catalogue or user port, ambiguous or not): nothing new.
    if (rows.some((r) => r.name === ref.name && near(r, ref))) continue;
    if (budget.left <= 0) break;
    const created = await client.port.create({
      data: {
        name: ref.name,
        country: ref.country,
        lat: ref.lat,
        lon: ref.lon,
        isUserAdded: true,
        carriedFrom: source,
      },
      select: { id: true, name: true, country: true, lat: true, lon: true, isUserAdded: true },
    });
    rows.push(created);
    added += 1;
    budget.left -= 1;
  }
  return added;
}
