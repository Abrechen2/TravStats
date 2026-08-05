import { AIRLINES } from "../airlines";
import { parseAirlinesDat, dedupeAirlinesByIata } from "./parseOpenFlights";

export interface AirlineSeedRow {
  iata: string;
  icao: string | null;
  name: string;
  callsign: string | null;
  country: string | null;
  active: boolean;
}

/**
 * Build the airline seed: OpenFlights (deduped by IATA, active-preferred,
 * blank-IATA dropped) UNIONed with the curated AIRLINES list. Curated rows
 * WIN on a shared IATA — they carry the exact display names TravStats has
 * always shown and guarantee resolver parity for known carriers. Every
 * curated IATA is present in the output.
 */
export function buildAirlineSeed(openflightsRaw: string): AirlineSeedRow[] {
  const openflights = dedupeAirlinesByIata(parseAirlinesDat(openflightsRaw));
  const byIata = new Map<string, AirlineSeedRow>();

  const curatedIatas = new Set(AIRLINES.map((a) => a.iata));
  const curatedNames = new Set(AIRLINES.map((a) => a.name.toLowerCase()));

  for (const r of openflights) {
    // Drop a stale OpenFlights row that duplicates a curated carrier's NAME under a
    // different IATA — otherwise the resolver's name lookup could resolve the curated
    // name to the wrong (stale) IATA (e.g. "Scoot" → TZ instead of the curated TR).
    if (!curatedIatas.has(r.iata as string) && curatedNames.has(r.name.toLowerCase())) {
      continue;
    }

    // iata is guaranteed non-null after dedupe
    byIata.set(r.iata as string, {
      iata: r.iata as string,
      icao: r.icao,
      name: r.name,
      callsign: r.callsign,
      country: r.country,
      active: r.active,
    });
  }

  // Curated overrides — name + icao from the curated list; preserve any
  // OpenFlights callsign/country if present, else null.
  for (const a of AIRLINES) {
    const existing = byIata.get(a.iata);
    byIata.set(a.iata, {
      iata: a.iata,
      icao: a.icao ?? existing?.icao ?? null,
      name: a.name,
      callsign: existing?.callsign ?? null,
      country: existing?.country ?? null,
      active: existing?.active ?? true,
    });
  }

  return Array.from(byIata.values());
}
