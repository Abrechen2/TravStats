import type { TimeValue } from "../../../../shared/time/wire";
import type { CruisePortData } from "../../../../utils/cruiseStats";
import type { CruiseCall, CruiseInsightRow } from "../rows";

export const PORTS: Record<string, CruisePortData> = {
  HAM: port(1, "Hamburg", 53.54, 9.98),
  OSL: port(2, "Oslo", 59.9, 10.73),
  BGO: port(3, "Bergen", 60.39, 5.32),
  CPH: port(4, "Kopenhagen", 55.69, 12.6),
  SIN: port(5, "Singapur", 1.26, 103.82),
  BAL: port(6, "Benoa", -8.74, 115.21),
};

function port(id: number, name: string, lat: number, lon: number): CruisePortData {
  return {
    id,
    name,
    city: name,
    country: null,
    region: null,
    unlocode: null,
    lat,
    lon,
    timezone: "UTC",
    isUserAdded: false,
  };
}

const tv = (iso: string, precision: TimeValue["precision"] = "minute"): TimeValue => ({
  utc: `${iso}:00.000Z`,
  zone: "UTC",
  offset: "+00:00",
  local: `${iso}:00`,
  precision,
  zoneSource: "stored",
});

let seq = 0;

/** A port call (`code`) or a sea day (`null`) on `day`, optionally with times and a note. */
export function call(
  dayNumber: number,
  code: keyof typeof PORTS | null,
  day: string | null,
  extra: {
    arrive?: string;
    leave?: string;
    note?: string;
    unresolved?: string;
    precision?: TimeValue["precision"];
  } = {}
): CruiseCall {
  seq += 1;
  const p = code ? PORTS[code] : null;
  return {
    stopId: `s${seq}`,
    dayNumber,
    day,
    isAtSea: code === null && !extra.unresolved,
    portId: p?.id ?? null,
    portName: p?.name ?? extra.unresolved ?? null,
    lat: p?.lat ?? null,
    lon: p?.lon ?? null,
    arrival: extra.arrive ? tv(extra.arrive, extra.precision) : null,
    departure: extra.leave ? tv(extra.leave, extra.precision) : null,
    excursionNote: extra.note ?? null,
  };
}

/** A sailed cruise from `start` to `end`, embarking at `from` and leaving the ship at `to`. */
export function cruise(
  id: string,
  start: string | null,
  end: string | null,
  from: keyof typeof PORTS | null,
  to: keyof typeof PORTS | null,
  calls: CruiseCall[]
): CruiseInsightRow {
  return {
    id,
    label: `Cruise ${id}`,
    startDay: start,
    endDay: end ?? start,
    year: start ? Number(start.slice(0, 4)) : null,
    calls,
    input: {
      id,
      shipId: null,
      cruiseLine: null,
      cabinType: null,
      deck: null,
      startDate: start ? new Date(`${start}T00:00:00Z`) : null,
      endDate: end ? new Date(`${end}T00:00:00Z`) : null,
      departurePort: from ? PORTS[from] : null,
      arrivalPort: to ? PORTS[to] : null,
      stops: calls.map((c) => ({
        portId: c.portId,
        port: c.portId ? Object.values(PORTS).find((p) => p.id === c.portId)! : null,
        dayNumber: c.dayNumber,
        isAtSea: c.isAtSea,
        unresolvedPortName: c.portId === null && !c.isAtSea ? c.portName : null,
      })),
    },
  };
}
