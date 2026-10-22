/**
 * The connection inside bahn.de's `hinfahrtRecon` (forgejo#204).
 *
 * `GET /web/api/angebote/verbindung/{vbid}` answers with a `hinfahrtRecon`
 * string — the HAFAS "reconstruction context" bahn.de later POSTs back to
 * `/angebote/recon` for prices. It already names every section of the ride: a
 * tester's real link (Augsburg Hbf → München Hbf, a walk to the deep station,
 * S1 to the airport, 2026-10-16) showed stations with their EVA numbers, both
 * times and the train in it, so the recon POST — which bahn.de blocks after a
 * few requests — is never needed.
 *
 * The format, as HAFAS writes it:
 *
 *   ¶HKI¶T$A=1@O=Augsburg Hbf@L=8000013@a=128@$A=1@O=München Hbf@L=8000261@a=128@$202610200808$202610200854$RB 57031$$1$…§W$…§T$…¶KC¶…
 *
 * Sections are separated by `§`; within one, `$` separates the kind (`T` a
 * vehicle, `W`/`G@F` a walk or transfer — any other kind makes the string
 * unreadable), the two places (`@`-separated
 * `key=value` pairs, `O` the name, `L` the station id), departure and arrival
 * as `YYYYMMDDHHmm` on the station's clock, and the vehicle's printed name.
 *
 * Only what the string states is returned. A section that cannot be read
 * makes the whole string unreadable — a ride with a silently missing leg is
 * worse than a reason.
 */

export const MAX_RECON_LENGTH = 20_000;
export const MAX_RECON_SECTIONS = 30;

export interface ReconPlace {
  name: string;
  /** EVA/IBNR number for a station, null for an address or a place without one. */
  stationId: string | null;
}

export interface ReconSection {
  /** A vehicle ride, or anything else (walk, transfer, footpath). */
  kind: "vehicle" | "walk";
  from: ReconPlace;
  to: ReconPlace;
  /** `YYYY-MM-DDTHH:mm`, the departure station's wall clock. */
  departureLocal: string;
  arrivalLocal: string;
  /** The vehicle as printed ("RB 57031", "S 1"), whitespace collapsed; null for a walk. */
  vehicleName: string | null;
}

const HAFAS_TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/;
const MAX_NAME = 120;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Whether the digits name a real calendar minute — 30 February and 29:99 are
 * refused, not rolled over. Shared with the web-client sections, so both
 * representations of a connection answer the same.
 */
export function isCalendarMinute(y: string, mo: string, d: string, h: string, mi: string): boolean {
  const month = Number(mo);
  if (month < 1 || month > 12) return false;
  if (Number(d) < 1 || Number(d) > daysInMonth(Number(y), month)) return false;
  return Number(h) <= 23 && Number(mi) <= 59;
}

/** A real calendar minute or null. */
function hafasTime(value: string | undefined): string | null {
  const m = HAFAS_TIME.exec(value?.trim() ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return isCalendarMinute(y, mo, d, h, mi) ? `${y}-${mo}-${d}T${h}:${mi}` : null;
}

/** `T` a vehicle; `W` and `G@F` a walk. Any other kind is not guessed at. */
function kindOf(marker: string): ReconSection["kind"] | null {
  if (marker === "T") return "vehicle";
  if (marker === "W" || marker === "G@F") return "walk";
  return null;
}

function place(value: string | undefined): ReconPlace | null {
  if (!value) return null;
  const fields = new Map<string, string>();
  for (const pair of value.split("@")) {
    const eq = pair.indexOf("=");
    if (eq > 0) fields.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  const name = (fields.get("O") ?? "").replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > MAX_NAME) return null;
  const id = fields.get("L")?.trim() ?? "";
  return { name, stationId: /^\d{5,9}$/.test(id) ? id : null };
}

function section(raw: string): ReconSection | null {
  const parts = raw.split("$");
  const kind = kindOf(parts[0]?.trim() ?? "");
  const from = place(parts[1]);
  const to = place(parts[2]);
  const departureLocal = hafasTime(parts[3]);
  const arrivalLocal = hafasTime(parts[4]);
  if (!kind || !from || !to || !departureLocal || !arrivalLocal) return null;
  const printed = (parts[5] ?? "").replace(/\s+/g, " ").trim();
  // A vehicle without a printed name would be read as no train and silently dropped.
  if (kind === "vehicle" && printed.length === 0) return null;
  return {
    kind,
    from,
    to,
    departureLocal,
    arrivalLocal,
    vehicleName: kind === "vehicle" && printed.length > 0 ? printed.slice(0, 60) : null,
  };
}

/** The sections of a `hinfahrtRecon`, or null when it is not one this reader can read. */
export function parseHinfahrtRecon(recon: string): ReconSection[] | null {
  if (recon.length === 0 || recon.length > MAX_RECON_LENGTH) return null;
  const start = recon.indexOf("¶HKI¶");
  if (start < 0) return null;
  const body = recon.slice(start + "¶HKI¶".length);
  const end = body.indexOf("¶");
  const trip = end < 0 ? body : body.slice(0, end);
  const raw = trip.split("§").filter((s) => s.trim().length > 0);
  if (raw.length === 0 || raw.length > MAX_RECON_SECTIONS) return null;
  const sections: ReconSection[] = [];
  for (const r of raw) {
    const s = section(r);
    if (!s) return null;
    sections.push(s);
  }
  return sections;
}
