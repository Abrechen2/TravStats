import type { ComposeInput } from "../compose";
import type { Coordinate, PresenceEntry, PresencePoint, TripContext } from "../types";

/** Places the scenarios travel between. */
export const AT = {
  MUC: { lat: 48.3538, lon: 11.7861 },
  BER: { lat: 52.3667, lon: 13.5033 },
  MUNICH_HBF: { lat: 48.1402, lon: 11.5586 },
  NUREMBERG_HBF: { lat: 49.4456, lon: 11.0825 },
  FIRENZE: { lat: 43.7765, lon: 11.2479 },
  ROMA: { lat: 41.901, lon: 12.5006 },
  COLOSSEUM: { lat: 41.8902, lon: 12.4922 },
  HAMBURG: { lat: 53.5526, lon: 10.0067 },
  KIEL: { lat: 54.3148, lon: 10.1316 },
  OSLO: { lat: 59.9075, lon: 10.7406 },
  COPENHAGEN: { lat: 55.6932, lon: 12.599 },
  LIS: { lat: 38.7813, lon: -9.1359 },
  LISBON_HOTEL: { lat: 38.7223, lon: -9.1393 },
  JFK: { lat: 40.6413, lon: -73.7781 },
} satisfies Record<string, Coordinate>;

export const atMunich = (): Coordinate => AT.MUC;

const point = (at: Coordinate, day: string, hour: number): PresencePoint => ({ ...at, day, hour });

function nightsBetween(startDay: string, endDay: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${startDay}T00:00:00Z`); ; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (day >= endDay) break;
    out.push(day);
  }
  return out;
}

type Over = Partial<PresenceEntry>;

/** A timed journey (flight or ride) from one point to another. */
export function ride(
  domain: "flight" | "rail",
  id: string,
  from: Coordinate,
  to: Coordinate,
  dep: { day: string; hour: number },
  arr: { day: string; hour: number },
  over: Over = {}
): PresenceEntry {
  return {
    key: `${domain}:${id}`,
    domain,
    id,
    tripId: null,
    linkable: true,
    state: "happened",
    startDay: dep.day,
    endDay: arr.day,
    points: [point(from, dep.day, dep.hour), point(to, arr.day, arr.hour)],
    nights: arr.day > dep.day ? [dep.day] : [],
    label: `${domain} ${id}`,
    city: null,
    country: null,
    ...over,
  };
}

export function stay(
  id: string,
  at: Coordinate,
  checkIn: string,
  checkOut: string,
  city: string,
  over: Over = {}
): PresenceEntry {
  return {
    key: `lodging:${id}`,
    domain: "lodging",
    id,
    tripId: null,
    linkable: true,
    state: "happened",
    startDay: checkIn,
    endDay: checkOut,
    points: [point(at, checkIn, 15), point(at, checkOut, 10)],
    nights: nightsBetween(checkIn, checkOut),
    label: `Hotel ${id}`,
    city,
    country: null,
    ...over,
  };
}

export function visit(id: string, at: Coordinate, day: string, over: Over = {}): PresenceEntry {
  return {
    key: `place:${id}`,
    domain: "place",
    id,
    tripId: null,
    linkable: true,
    state: "happened",
    startDay: day,
    endDay: day,
    points: [point(at, day, 12)],
    nights: [],
    label: `Place ${id}`,
    city: null,
    country: null,
    ...over,
  };
}

export function cruise(
  id: string,
  ports: readonly { at: Coordinate; day: string }[],
  over: Over = {}
): PresenceEntry {
  const startDay = ports[0].day;
  const endDay = ports[ports.length - 1].day;
  return {
    key: `cruise:${id}`,
    domain: "cruise",
    id,
    tripId: null,
    linkable: true,
    state: "happened",
    startDay,
    endDay,
    points: ports.map((p, i) => point(p.at, p.day, i === 0 ? 16 : i === ports.length - 1 ? 9 : 12)),
    nights: nightsBetween(startDay, endDay),
    label: `Cruise ${id}`,
    city: null,
    country: null,
    ...over,
  };
}

export const trip = (id: string, startDay: string | null, endDay: string | null): TripContext => ({
  id,
  name: `Trip ${id}`,
  startDay,
  endDay,
});

export function input(over: Partial<ComposeInput>): ComposeInput {
  return {
    entries: [],
    trips: [],
    places: [],
    homeAt: atMunich,
    homeKnown: true,
    clusters: [],
    answered: [],
    ...over,
  };
}
