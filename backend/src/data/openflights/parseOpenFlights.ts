import { parse } from "csv-parse/sync";

export interface OpenFlightsAirline {
  iata: string | null;
  icao: string | null;
  name: string;
  callsign: string | null;
  country: string | null;
  active: boolean;
}

export interface OpenFlightsPlane {
  name: string;
  icao: string | null;
}

// OpenFlights uses "\N" (backslash-N) for null and "-" / "N/A" as placeholder
// IATA/ICAO values. Normalize all of them to null.
function clean(value: string | undefined): string | null {
  if (value === undefined) return null;
  const v = value.trim();
  if (v === "" || v === "\\N" || v === "-" || v === "N/A") return null;
  return v;
}

export function parseAirlinesDat(raw: string): OpenFlightsAirline[] {
  const records = parse(raw, {
    columns: false,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as string[][];

  return records
    .map((cols): OpenFlightsAirline | null => {
      const name = clean(cols[1]);
      if (!name) return null;
      return {
        name,
        iata: clean(cols[3]),
        icao: clean(cols[4]),
        callsign: clean(cols[5]),
        country: clean(cols[6]),
        active: clean(cols[7])?.toUpperCase() === "Y",
      };
    })
    .filter((r): r is OpenFlightsAirline => r !== null);
}

export function parsePlanesDat(raw: string): OpenFlightsPlane[] {
  const records = parse(raw, {
    columns: false,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as string[][];

  return records
    .map((cols): OpenFlightsPlane | null => {
      const name = clean(cols[0]);
      if (!name) return null;
      return { name, icao: clean(cols[2]) };
    })
    .filter((r): r is OpenFlightsPlane => r !== null);
}

/**
 * Dedupe airlines by IATA code. Drops rows without an IATA (they cannot feed
 * an IATA-keyed logo lookup) and, on collision, keeps the active carrier
 * (defunct airlines reuse codes). First active wins; if none active, first seen.
 */
export function dedupeAirlinesByIata(rows: OpenFlightsAirline[]): OpenFlightsAirline[] {
  const byIata = new Map<string, OpenFlightsAirline>();
  for (const row of rows) {
    if (!row.iata) continue;
    const existing = byIata.get(row.iata);
    if (!existing) {
      byIata.set(row.iata, row);
    } else if (!existing.active && row.active) {
      byIata.set(row.iata, row);
    }
  }
  return Array.from(byIata.values());
}
