/**
 * The seven travel records, exactly as `GET /stats/records` derives them.
 *
 * MIRRORS `backend/src/schemas/statsDomains.ts`; change both together.
 *
 * Nothing here is recomputed on the client, and nothing arrives pre-composed:
 * the payload carries a number, a unit and the raw parts of the detail, never
 * a sentence and never a separator. A German comma in a JSON body would fix
 * the decimal separator for every reader the endpoint ever has, so the screen
 * formats — `Intl` through `lib/units.ts`, dates through `lib/displayFormat.ts`.
 *
 * A record the data cannot support is ABSENT from the array rather than
 * present with a zero. The section therefore draws a short list for a young
 * account, not a grid of dashes.
 */

export const RECORD_IDS = [
  "longest-flight",
  "shortest-flight",
  "busiest-day",
  "longest-aloft",
  "biggest-delay",
  "northernmost",
  "longest-streak",
] as const;

export type RecordId = (typeof RECORD_IDS)[number];

export type RecordUnit = "km" | "minutes" | "flights" | "days" | "degrees-north";

export interface TravelRecord {
  id: RecordId;
  value: number;
  unit: RecordUnit;
  /** The flight this record is about, when it is about one. */
  flightId?: string;
  /** The airport it is about, when the record names a place rather than a leg. */
  airportIata?: string;
  depIata?: string | null;
  arrIata?: string | null;
  flightNumber?: string | null;
  durationMinutes?: number | null;
  /** "YYYY-MM-DD" — a single day. */
  date?: string;
  startDate?: string;
  endDate?: string;
  /** Airports touched on the busiest day, in departure order. */
  legs?: string[];
}

/**
 * Enveloped, unlike most of the stats router — one of the twelve frozen leaks
 * the response-shape ratchet records. The client unwraps it once, in
 * `statsApi.getRecords`, so no screen has to know.
 */
export interface TravelRecordsResponse {
  success: boolean;
  data: { records: TravelRecord[] };
}
