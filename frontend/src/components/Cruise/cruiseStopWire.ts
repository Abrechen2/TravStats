import type { CruiseStopInput, CruiseStopWire } from "../../types";
import { MissingZoneError, dayInput, localTimeInput, zoneSourceOf } from "../../lib/api/timeInput";
import type { LocalTimeInput } from "../../shared/time";

const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

function stopTime(
  stop: CruiseStopInput,
  value: string | null | undefined,
  field: string
): LocalTimeInput | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const match = WALL_CLOCK.exec(value);
  if (!match) return null;
  const source = zoneSourceOf({
    timezone: stop.port?.timezone ?? null,
    ref: stop.portId !== null ? { kind: "port", id: String(stop.portId) } : null,
  });
  if (!source) throw new MissingZoneError(field);
  return localTimeInput(field, `${match[1]}T${match[2]}`, source);
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
 *   place to take a zone from: refused here as `TZ_UNRESOLVED` rather than
 *   written as UTC, which is what the fake-UTC string was.
 * The UI-only fields (`port`, `originalDay`, `dateSource`) are dropped.
 */
export function cruiseStopToWire(stop: CruiseStopInput, index: number): CruiseStopWire {
  const {
    port: _port,
    originalDay: _originalDay,
    dateSource: _dateSource,
    date,
    arrivalTime,
    departureTime,
    ...rest
  } = stop;
  const wire: CruiseStopWire = { ...rest };
  if (date !== undefined) wire.date = date === null ? null : dayInput(date.slice(0, 10));
  const arrival = stopTime(stop, arrivalTime, `stops.${index}.arrivalTime`);
  const departure = stopTime(stop, departureTime, `stops.${index}.departureTime`);
  if (arrival !== undefined) wire.arrivalTime = arrival;
  if (departure !== undefined) wire.departureTime = departure;
  return wire;
}
