import type { CruiseStopInput, CruiseWriteBody, FlightInput, TripStatus } from "../../types";
import type { MissingZoneError } from "../../lib/api/timeInput";

/** One reviewed cruise of an import, as its card built it for the save. */
export interface EntryData {
  input: CruiseWriteBody;
  /** The card's stops as the editor holds them — what a re-read is compared by (forgejo#225). */
  stops: CruiseStopInput[];
  flightInputs: FlightInput[];
  tripLabel: string;
  /** A time whose place brings no zone (a portless stop, a zoneless airport):
   *  the save refuses with its sentence before writing anything. */
  timeError?: MissingZoneError;
}

/**
 * Derive the auto-created trip's date span + status from the imported cruises.
 * Without an explicit status the backend falls back to the Trip Prisma default
 * ("completed"), which mislabels an upcoming fly & cruise booking — an
 * embarkation two days from now would otherwise show as "Abgeschlossen".
 */
export function deriveTripMeta(
  data: readonly Pick<EntryData, "input">[],
  now: Date
): { startDate?: string; endDate?: string; status: TripStatus } {
  const starts = data.map((e) => e.input.startDate).filter((d): d is string => !!d);
  const ends = data.map((e) => e.input.endDate).filter((d): d is string => !!d);
  const startDate = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : undefined;
  const endDate = ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : undefined;

  let status: TripStatus = "completed";
  if (startDate && new Date(startDate) > now) status = "planned";
  else if (endDate && new Date(endDate) < now) status = "completed";
  else if (startDate) status = "in_progress";

  return { startDate, endDate, status };
}

/**
 * A 409 from `POST /cruises` means the server already holds this booking —
 * the ordinary answer to re-reading a forwarded confirmation. Recognised by
 * the fixed code rather than by prose, so a reworded message never turns a
 * known outcome back into an unexplained failure.
 */
export function isAlreadyImported(err: unknown): boolean {
  const res = (err as { response?: { status?: number; data?: { error?: string } } }).response;
  return res?.status === 409 && res.data?.error === "already_imported";
}

/** The stored cruise a 409 `already_imported` names, or null. */
export function alreadyImportedId(err: unknown): string | null {
  const data = (err as { response?: { data?: { data?: { id?: unknown } } } }).response?.data?.data;
  return typeof data?.id === "string" ? data.id : null;
}
