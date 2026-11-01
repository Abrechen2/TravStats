import { escapeLike } from "./ranked";

/**
 * Terminals (bus stations, ferry ports) from both ends of the user's earlier
 * rides, for the form's one-click chips. Shared by the bus and ferry
 * endpoints, whose rows carry the same columns.
 */

export interface TerminalSuggestion {
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  country: string | null;
}

export interface FindManyDelegate {
  findMany(args: unknown): Promise<unknown>;
}

const TERMINAL_CAP = 5;
/** Rows read per terminal end; a terminal ridden often fills the page with itself. */
const TERMINAL_ROWS = 25;

interface TerminalRow extends TerminalSuggestion {
  at: Date;
}

/**
 * One end's rides whose terminal name starts with `prefix` (any, when none was
 * typed), newest first.
 */
async function terminalRows(
  delegate: FindManyDelegate,
  userId: string,
  end: "dep" | "arr",
  prefix: string | undefined
): Promise<TerminalRow[]> {
  const nameField = end === "dep" ? "depStationName" : "arrStationName";
  const select =
    end === "dep"
      ? {
          depStationName: true,
          depAddress: true,
          depLat: true,
          depLon: true,
          depCountry: true,
          departureTime: true,
        }
      : {
          arrStationName: true,
          arrAddress: true,
          arrLat: true,
          arrLon: true,
          arrCountry: true,
          departureTime: true,
        };
  const rows = (await delegate.findMany({
    where: {
      userId,
      ...(prefix ? { [nameField]: { startsWith: escapeLike(prefix), mode: "insensitive" } } : {}),
    },
    select,
    orderBy: { departureTime: "desc" },
    take: TERMINAL_ROWS,
  })) as Array<Record<string, string | number | Date | null>>;
  return rows.map((row) => ({
    name: String(row[nameField]).trim(),
    address: (row[end === "dep" ? "depAddress" : "arrAddress"] as string | null) ?? null,
    lat: row[end === "dep" ? "depLat" : "arrLat"] as number,
    lon: row[end === "dep" ? "depLon" : "arrLon"] as number,
    country: (row[end === "dep" ? "depCountry" : "arrCountry"] as string | null) ?? null,
    at: row.departureTime as Date,
  }));
}

/**
 * Terminals from both ends of every ride, whichever field is being typed in:
 * the place a ride ended at is the place the ride home starts from, so the
 * departure field must find arrivals too. Both typed names search both ends;
 * with neither typed, both ends are offered unfiltered, newest first. One chip
 * per name, positioned from the newest ride — and a missing address or country
 * is filled from an older ride of the same name rather than offered as unknown
 * when the logbook does know it.
 */
export async function terminalsFor(
  delegate: FindManyDelegate,
  userId: string,
  query: { depName?: string; arrName?: string }
): Promise<TerminalSuggestion[]> {
  const prefixes = [query.depName, query.arrName].filter((p): p is string => Boolean(p));
  const searches = prefixes.length > 0 ? prefixes : [undefined];
  const reads = searches.flatMap((prefix) => [
    terminalRows(delegate, userId, "dep", prefix),
    terminalRows(delegate, userId, "arr", prefix),
  ]);
  const rows = (await Promise.all(reads)).flat();
  // Stable: on a shared instant the departure end, read first, keeps its place.
  rows.sort((a, b) => b.at.getTime() - a.at.getTime());

  const byName = new Map<string, TerminalSuggestion>();
  for (const row of rows) {
    if (row.name === "") continue;
    const key = row.name.toLowerCase();
    const seen = byName.get(key);
    if (!seen) {
      if (byName.size < TERMINAL_CAP) {
        byName.set(key, {
          name: row.name,
          address: row.address,
          lat: row.lat,
          lon: row.lon,
          country: row.country,
        });
      }
      continue;
    }
    byName.set(key, {
      ...seen,
      address: seen.address ?? row.address,
      country: seen.country ?? row.country,
    });
  }
  return [...byName.values()];
}
