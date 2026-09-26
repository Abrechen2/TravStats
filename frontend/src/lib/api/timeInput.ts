/**
 * What a form sends for a time (ADR 0002, D3 "in") — the ONE place in the web
 * that builds the write shape, so a contract change is one edit.
 *
 * Contract (backend/src/shared/time/wire.ts, published in phase 1):
 * - an instant typed by a person is `{ local, zone }` or `{ local, placeRef }`
 *   — the wall clock the ticket shows, plus where the zone comes from. The
 *   server turns it into an instant once; the web never does, and never sends
 *   an offset-less datetime string outside this object (the server answers
 *   `TIME_SHAPE_REQUIRED`, which is what a stale bundle meets).
 * - a calendar day is a bare `YYYY-MM-DD`.
 *
 * The zone comes from the PLACE the user picked (D2): the airport, station,
 * port or place record carries it, or the server resolves the reference.
 * There is no fallback to the profile, the browser or UTC — a pick that
 * carries neither is refused here, before the request, with the same sentence
 * the server's `TZ_UNRESOLVED` gets.
 */
import type { LocalTimeInput } from "../../shared/time";
import { isValidZone } from "../../shared/time";

/** The place kinds the server resolves a zone for (`PLACE_REF_KINDS`). */
export type PlaceRefKind = "airport" | "railStation" | "port" | "place";

export interface PlaceRef {
  kind: PlaceRefKind;
  id: string;
}

/** Where a wall clock's zone comes from: a zone the pick carried, or the pick itself. */
export type ZoneSource = { zone: string } | { placeRef: PlaceRef };

/** The later occurrence of a repeated hour; omitted means the earlier (Q5). */
export type Fold = "earlier" | "later";

/** A form tried to send a wall clock whose place carries no zone and no reference. */
export class MissingZoneError extends Error {
  readonly code = "TZ_UNRESOLVED";
  constructor(readonly field: string) {
    super(`No zone source for ${field}`);
    this.name = "MissingZoneError";
  }
}

/**
 * The zone source of a picked place: its own zone when it carries a valid
 * one, else a reference the server resolves, else null. A zone string the
 * browser does not know is passed as a reference rather than dropped — the
 * server's tzdata may be newer.
 */
export function zoneSourceOf(pick: {
  timezone?: string | null;
  ref?: PlaceRef | null;
}): ZoneSource | null {
  const zone = pick.timezone ?? null;
  if (zone && isValidZone(zone)) return { zone };
  if (pick.ref && pick.ref.id) return { placeRef: pick.ref };
  return null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/** `YYYY-MM-DD` as typed, or null for an empty or malformed field. */
export function dayInput(date: string | null | undefined): string | null {
  const trimmed = (date ?? "").trim();
  return DAY.test(trimmed) ? trimmed : null;
}

/**
 * The write shape for a date and an optional time of day at a place:
 * - no date → null;
 * - a date without a time → the bare day (`YYYY-MM-DD`): the time of day is
 *   unknown, and inventing midnight is how "00:00" used to mean "no time";
 * - a date and a time → `{ local, zone | placeRef, fold? }`, or
 *   `MissingZoneError` when the place brings no zone source.
 */
export function wallClockInput(
  field: string,
  date: string,
  time: string,
  source: ZoneSource | null,
  fold?: Fold
): LocalTimeInput | string | null {
  const day = dayInput(date);
  if (!day) return null;
  const clock = time.trim();
  if (!TIME.test(clock)) return day;
  return localTimeInput(field, `${day}T${clock}`, source, fold);
}

/** `{ local, zone | placeRef, fold? }` for a full `YYYY-MM-DDTHH:mm` wall clock. */
export function localTimeInput(
  field: string,
  local: string,
  source: ZoneSource | null,
  fold?: Fold
): LocalTimeInput {
  if (!source) throw new MissingZoneError(field);
  return {
    local,
    ...source,
    ...(fold === "later" ? { fold } : {}),
  };
}
