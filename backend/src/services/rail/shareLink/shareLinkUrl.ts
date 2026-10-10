import type { RailTravelClassValue } from "../parser/types";

/**
 * What a pasted rail link IS, before anything is fetched (forgejo#204).
 *
 * Two kinds of bahn.de link are recognised, and a link that is neither is
 * said to be so rather than guessed at:
 *
 * - a SHARE link (`/buchung/start?vbid=<uuid>`) — the connection lives on
 *   bahn.de and has to be fetched;
 * - a SEARCH link (`/buchung/fahrplan/suche#so=…&zo=…&hd=…`) — the stations,
 *   the departure and the class are in the link itself.
 *
 * Whatever the link carries by itself is returned as `facts`, so a failed
 * fetch still hands the user what was reliably read (the acceptance
 * criterion: "bereits zuverlässig gelesene Angaben übernehmen"). Nothing here
 * reaches the network.
 */

export interface ShareLinkFacts {
  departureStationName: string | null;
  arrivalStationName: string | null;
  /** `YYYY-MM-DDTHH:mm`, the departure station's wall clock as the link states it. */
  departureLocal: string | null;
  travelClass: RailTravelClassValue | null;
}

export const NO_FACTS: ShareLinkFacts = {
  departureStationName: null,
  arrivalStationName: null,
  departureLocal: null,
  travelClass: null,
};

export type ParsedShareLink =
  | { kind: "dbShare"; vbid: string; facts: ShareLinkFacts }
  | { kind: "dbSearch"; facts: ShareLinkFacts }
  | { kind: "invalid" }
  | { kind: "unsupported"; host: string };

/** The hosts bahn.de serves its booking pages from. */
const DB_HOSTS = new Set(["www.bahn.de", "bahn.de", "int.bahn.de", "next.bahn.de"]);

const VBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_DATE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/;
const MAX_STATION_NAME = 120;

function stationName(value: string | null): string | null {
  const name = value?.trim() ?? "";
  return name.length > 0 && name.length <= MAX_STATION_NAME ? name : null;
}

function linkDate(value: string | null): string | null {
  const m = value ? LINK_DATE.exec(value.trim()) : null;
  return m ? `${m[1]}T${m[2]}` : null;
}

function linkClass(value: string | null): RailTravelClassValue | null {
  if (value === "1") return "first";
  if (value === "2") return "second";
  return null;
}

/** bahn.de writes its search parameters into the fragment, some links into the query. */
function linkParams(url: URL): URLSearchParams {
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));
  for (const [key, value] of url.searchParams) if (!params.has(key)) params.set(key, value);
  return params;
}

function factsOf(params: URLSearchParams): ShareLinkFacts {
  return {
    departureStationName: stationName(params.get("so")),
    arrivalStationName: stationName(params.get("zo")),
    departureLocal: linkDate(params.get("hd")),
    travelClass: linkClass(params.get("kl")),
  };
}

const hasFacts = (f: ShareLinkFacts): boolean =>
  f.departureStationName !== null || f.arrivalStationName !== null || f.departureLocal !== null;

export function parseShareLink(raw: string): ParsedShareLink {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { kind: "invalid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { kind: "invalid" };
  const host = url.hostname.toLowerCase();
  if (!DB_HOSTS.has(host)) return { kind: "unsupported", host };
  const params = linkParams(url);
  const facts = factsOf(params);
  const vbid = params.get("vbid")?.trim() ?? "";
  if (VBID.test(vbid)) return { kind: "dbShare", vbid: vbid.toLowerCase(), facts };
  if (hasFacts(facts)) return { kind: "dbSearch", facts };
  return { kind: "invalid" };
}
