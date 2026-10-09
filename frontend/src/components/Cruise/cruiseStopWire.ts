import type { CruiseStopInput, CruiseStopWire } from "../../types";
import { dayInput, localTimeInput, zoneSourceOf } from "../../lib/api/timeInput";
import { storedFold, type LocalTimeInput } from "../../shared/time";

const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

function stopTime(
  stop: CruiseStopInput,
  value: string | null | undefined,
  field: string,
  fold: "later" | undefined
): LocalTimeInput | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const match = WALL_CLOCK.exec(value);
  if (!match) return null;
  const source = zoneSourceOf({
    timezone: stop.port?.timezone ?? null,
    ref: stop.portId !== null ? { kind: "port", id: String(stop.portId) } : null,
  });
  const local = `${match[1]}T${match[2]}`;
  // No port, no zone: the server keeps the typed wall clock with precision
  // `unknown` until the port is resolved — never a UTC guess (D2).
  if (!source) return { local };
  return localTimeInput(field, local, source, fold);
}

/**
 * The occurrence a stored port time is, for the editor's "later" checkbox:
 * the legacy column keeps only the wall clock, the instant says which of a
 * repeated hour's two it was.
 */
export function storedStopFold(
  wallClock: string | null | undefined,
  instant: string | null | undefined,
  zone: string | null | undefined
): "later" | undefined {
  const match = wallClock ? WALL_CLOCK.exec(wallClock) : null;
  if (!match || !zone) return undefined;
  return storedFold(`${match[1]}T${match[2]}`, zone, instant);
}

/**
 * A cruise stop as the server takes it under the time model (ADR 0002, D3).
 *
 * The editor keeps a stop's times as it always did — the port's wall clock,
 * written as `YYYY-MM-DDTHH:mm:00.000Z` so the pickers round-trip — and this
 * mapper is the one place that turns them into the write shape:
 * - the call's calendar day as a bare `YYYY-MM-DD`;
 * - an arrival/departure as `{ local, zone }` when the picked port carries its
 *   zone, else `{ local, placeRef: port }` for the server to resolve;
 * - a time on a stop without a port (a sea day, an unresolved import) has no
 *   place to take a zone from: sent as `{ local }` alone, which the server
 *   keeps as a wall clock with precision `unknown` — not refused, which made
 *   an imported cruise with an unresolved port unsavable, and not UTC.
 * The UI-only fields (`port`, `originalDay`, `dateSource`, `uiKey`) are dropped.
 */
export function cruiseStopToWire(stop: CruiseStopInput, index: number): CruiseStopWire {
  const {
    port: _port,
    originalDay: _originalDay,
    dateSource: _dateSource,
    uiKey: _uiKey,
    arrivalFold,
    departureFold,
    date,
    arrivalTime,
    departureTime,
    ...rest
  } = stop;
  const wire: CruiseStopWire = { ...rest };
  if (date !== undefined) wire.date = date === null ? null : dayInput(date.slice(0, 10));
  const arrival = stopTime(stop, arrivalTime, `stops.${index}.arrivalTime`, arrivalFold);
  const departure = stopTime(stop, departureTime, `stops.${index}.departureTime`, departureFold);
  if (arrival !== undefined) wire.arrivalTime = arrival;
  if (departure !== undefined) wire.departureTime = departure;
  return wire;
}
