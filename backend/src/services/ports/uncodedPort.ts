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
type PortWriter = { port: Pick<DbTransaction["port"], "findMany" | "create"> };

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

const near = (r: UncodedPortRow, ref: UncodedPortRef) =>
  haversineKm({ lat: r.lat, lon: r.lon }, { lat: ref.lat, lon: ref.lon }) <= PORT_POSITION_MATCH_KM;

/**
 * The ports a received cruise names without a UN/LOCODE, made available here: a catalogue port of
 * that name, country and place first; else one a user (or an earlier share) added there; else a new
 * user-added port with the sender's name, country and position. Sharing UAT 2: the owner's Yangtze
 * ports are his own additions, so the receiver knew none of them and dropped every leg and the drawn
 * line silently. Two candidates of one name at one place are not guessed between, and nothing new
 * is made beside them.
 */
export async function ensureUncodedPorts(
  client: PortWriter,
  refs: readonly UncodedPortRef[]
): Promise<UncodedPortRow[]> {
  const names = [...new Set(refs.map((r) => r.name).filter((n) => n.trim() !== ""))];
  if (names.length === 0) return [];
  const rows = await client.port.findMany({
    where: { name: { in: names }, unlocode: null },
    select: { id: true, name: true, country: true, lat: true, lon: true, isUserAdded: true },
    orderBy: { id: "asc" },
  });
  const catalogue = rows.filter((r) => !r.isUserAdded);
  const added = rows.filter((r) => r.isUserAdded);
  const out: UncodedPortRow[] = [...catalogue];
  for (const ref of refs) {
    if (ref.name.trim() === "" || !Number.isFinite(ref.lat) || !Number.isFinite(ref.lon)) continue;
    const sameName = (r: UncodedPortRow) => r.name === ref.name && near(r, ref);
    if (catalogue.some(sameName)) continue;
    const own = added.filter((r) => sameName(r) && r.country === ref.country);
    if (own.length === 1) {
      if (!out.includes(own[0])) out.push(own[0]);
      continue;
    }
    if (own.length > 1 || added.some(sameName)) continue;
    const created = await client.port.create({
      data: { name: ref.name, country: ref.country, lat: ref.lat, lon: ref.lon, isUserAdded: true },
      select: { id: true, name: true, country: true, lat: true, lon: true, isUserAdded: true },
    });
    added.push(created);
    out.push(created);
  }
  return out;
}
