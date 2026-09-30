import { resolveAirlineCodes } from "./airlineNormalize";

/**
 * What an update to an airline NAME does to the IATA/ICAO codes stored beside it.
 *
 * Logos, stats and the passport read the codes, not the name. The edit dialog
 * sends the name; for the operating airline the update used to write the new
 * name and leave the old codes standing — rename "Lufthansa" to "Condor" and
 * the logo and the airline stats kept showing Lufthansa (silent-failure review
 * 2026-09-26, finding 15). The marketing airline had the milder form of it: a
 * new name that did not resolve kept the old codes too.
 *
 * Rules, the same for both airlines:
 *  - codes sent explicitly win;
 *  - a name cleared to null clears its codes;
 *  - a CHANGED name gets the codes it resolves to, or none — never the
 *    previous airline's;
 *  - an UNCHANGED name keeps its stored codes, and only fills them where the
 *    name resolves (a resave must not wipe codes a lookup delivered for a name
 *    the local table does not know).
 */
export interface AirlineCodeChange {
  iata?: string | null;
  icao?: string | null;
}

export function airlineCodeUpdate(
  name: string | null | undefined,
  iata: string | null | undefined,
  icao: string | null | undefined,
  storedName: string | null | undefined
): AirlineCodeChange {
  const explicit: AirlineCodeChange = {
    ...(iata !== undefined ? { iata } : {}),
    ...(icao !== undefined ? { icao } : {}),
  };
  if (name === undefined || iata !== undefined || icao !== undefined) return explicit;
  if (name === null) return { iata: null, icao: null };

  const resolved = resolveAirlineCodes(name);
  const unchanged = (storedName ?? "").trim().toLowerCase() === name.trim().toLowerCase();
  if (unchanged) {
    return resolved ? { iata: resolved.iata ?? null, icao: resolved.icao ?? null } : {};
  }
  return { iata: resolved?.iata ?? null, icao: resolved?.icao ?? null };
}
