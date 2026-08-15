/**
 * Google-Maps saved lists, as Takeout exports them: one CSV per list, columns
 * `Titel,Notiz,URL,Tags,Kommentar` (localised, so the header names vary).
 *
 * The important part is the URL. It carries Google's feature id —
 * `!1s0x<cell>:0x<cid>` — whose second half is the CID, the identifier of
 * EXACTLY the place the user saved. That is worth more than every other column
 * put together: without it an importer is left matching hotel names, and a
 * name is not an identity. "Hotel St. Martin" exists in Marktoberdorf and in
 * Rome, and a name-based lookup once put the Bavarian one in Italy.
 *
 * So the CID is kept as the row's provenance. A second import of the same list
 * recognises what it already holds, and a later enrichment step can ask Google
 * about *that* place rather than about a name.
 */

export interface MapsExportRow {
  name: string;
  /** Decimal CID — Google's id for this exact place. Null when the URL has none. */
  cid: string | null;
  note: string | null;
  url: string;
}

export interface MapsExportParseResult {
  rows: MapsExportRow[];
  /** Rows whose URL carried no feature id — kept, but without an identity. */
  withoutCid: number;
}

/** `!1s0x479009f0421b2f1b:0x13197a53660c2f5e` → the second half, as decimal. */
export function cidFromMapsUrl(url: string): string | null {
  const match = url.match(/!1s(0x[0-9a-fA-F]+):(0x[0-9a-fA-F]+)/);
  if (!match) return null;
  try {
    return BigInt(match[2]).toString();
  } catch {
    return null;
  }
}

/** The provenance key a Maps row carries into the app. */
export function mapsExternalRef(cid: string): string {
  return `gmaps:${cid}`;
}

const NAME_HEADERS = ["titel", "title", "name"];
const URL_HEADERS = ["url", "link"];
const NOTE_HEADERS = ["notiz", "note", "kommentar", "comment"];

function pick(record: Record<string, string>, candidates: string[]): string {
  for (const [key, value] of Object.entries(record)) {
    if (candidates.includes(key.trim().toLowerCase())) return (value ?? "").trim();
  }
  return "";
}

/**
 * Turns parsed CSV records into rows. Deliberately forgiving about header
 * names — Takeout localises them — and deliberately strict about the two
 * things that matter: a row without a name is not a place, and a row without a
 * URL cannot be identified.
 */
export function readMapsExport(records: Record<string, string>[]): MapsExportParseResult {
  const rows: MapsExportRow[] = [];
  let withoutCid = 0;

  for (const record of records) {
    const name = pick(record, NAME_HEADERS);
    const url = pick(record, URL_HEADERS);
    if (!name) continue;
    const cid = url ? cidFromMapsUrl(url) : null;
    if (!cid) withoutCid += 1;
    const note = pick(record, NOTE_HEADERS);
    rows.push({ name, cid, note: note.length > 0 ? note : null, url });
  }

  return { rows, withoutCid };
}
