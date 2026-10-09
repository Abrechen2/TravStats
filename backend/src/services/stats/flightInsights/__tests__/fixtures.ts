import type { TimeValue } from "../../../../shared/time/wire";
import type { FlightInsightRow } from "../rows";

/** A minute-precise TimeValue in UTC — the zone does not matter to these folds. */
export const at = (iso: string, precision: TimeValue["precision"] = "minute"): TimeValue => ({
  utc: `${iso}:00.000Z`,
  zone: "UTC",
  offset: "+00:00",
  local: `${iso}:00`,
  precision,
  zoneSource: "stored",
});

let seq = 0;

/** A counted flight between two codes, departing and landing at the given UTC wall clocks. */
export function row(
  dep: string | null,
  arr: string | null,
  departure: string | null,
  arrival: string | null,
  extra: Partial<FlightInsightRow> = {}
): FlightInsightRow {
  seq += 1;
  const depTv = departure ? at(departure) : null;
  const arrTv = arrival ? at(arrival) : null;
  return {
    id: extra.id ?? `f${String(seq).padStart(4, "0")}`,
    flightNumber: null,
    status: "flown",
    airline: null,
    seatClass: null,
    arrivalTime: arrTv ? new Date(arrTv.utc) : null,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    bookingId: null,
    depCode: dep,
    arrCode: arr,
    depIata: dep,
    depIcao: null,
    arrIata: arr,
    arrIcao: null,
    depLat: 50,
    depLon: 8,
    arrLat: 51,
    arrLon: 9,
    departureTime: depTv ? new Date(depTv.utc) : null,
    depTimezone: "UTC",
    depTimeSemantics: "UTC",
    departure: depTv,
    arrival: arrTv,
    departureDay: depTv ? depTv.local.slice(0, 10) : null,
    arrivalDay: arrTv ? arrTv.local.slice(0, 10) : depTv ? depTv.local.slice(0, 10) : null,
    departureDayExact: true,
    arrivalDayExact: true,
    ...extra,
  };
}
