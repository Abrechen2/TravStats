/**
 * The receiving side of the wire (spec 2026-10-20 §4): a parsed wire entry becomes a `SharedRow`
 * in this server's terms, ready for `copyInto` — the one copy path, own-entry join included.
 *
 * - Natural keys are resolved against THIS server's catalogue: a port by UN/LOCODE, a ship by
 *   IMO, a rail station by source id then UIC code, an airport by ICAO then IATA, a lodging chain
 *   by name among catalogue chains. A miss is never a guess: an unmatched port call becomes the
 *   cruise stop's third state (`unresolvedPortName`, CLAUDE.md cruise invariant), an unmatched
 *   station or airport keeps the name and position the facts already carry with a null id, an
 *   unmatched ship keeps its name as the override, a leg between ports this catalogue lacks is
 *   left out (the recipient's router can measure it again).
 * - The status is advisory (rework D4): only a state no clock can produce — a cancellation, a
 *   historical or duplicated flight — survives; anything else starts as `scheduled` and
 *   `DERIVE[entity]` (run by `copyInto`) decides it on this server's clock.
 */
import type { DbTransaction } from "../../../../db";
import type { SharedRow } from "../../adapters";
import type { EntryRef } from "../../adapters/stop";
import { SHARE_TYPES, type ShareEntity } from "../../shareTypes";
import {
  CRUISE_PASSTHROUGH,
  FLIGHT_PASSTHROUGH,
  LODGING_PASSTHROUGH,
  RAIL_PASSTHROUGH,
  RENTAL_PASSTHROUGH,
} from "../../../../shared/statusDerivation";
import type { PortRef, ShipRef } from "../../../trip/exchange/publicHalf";
import type { AirportRef, EntryWireRef, StationRef, WireEntry } from "./shapes";

type Facts = Record<string, unknown>;

const PASSTHROUGH: Readonly<Record<ShareEntity, readonly string[]>> = {
  flight: FLIGHT_PASSTHROUGH,
  lodgingStay: LODGING_PASSTHROUGH,
  cruise: CRUISE_PASSTHROUGH,
  rail: RAIL_PASSTHROUGH,
  bus: RAIL_PASSTHROUGH,
  ferry: RAIL_PASSTHROUGH,
  rental: RENTAL_PASSTHROUGH,
  stop: [],
};

/** The status a received entry starts from before this server derives its own. */
export function receivedStatus(entity: ShareEntity, wire: unknown): string {
  return typeof wire === "string" && PASSTHROUGH[entity].includes(wire) ? wire : "scheduled";
}

interface Resolver {
  port(ref: PortRef | null | undefined): number | null;
  ship(ref: ShipRef | null | undefined): number | null;
  station(ref: StationRef | null | undefined): number | null;
  airport(ref: AirportRef | null | undefined): number | null;
  chain(name: string | null | undefined): number | null;
}

const keysOf = <T>(values: (T | null | undefined)[]): T[] => [
  ...new Set(values.filter((v): v is T => v !== null && v !== undefined)),
];

/** One query per catalogue for everything a batch names. */
async function resolver(c: DbTransaction, entries: readonly WireEntry[]): Promise<Resolver> {
  const f = entries.map((e) => e.facts);
  const stops = f.flatMap((x) => (Array.isArray(x.stops) ? (x.stops as Facts[]) : []));
  const legs = f.flatMap((x) => (Array.isArray(x.legs) ? (x.legs as Facts[]) : []));
  const portRefs = [
    ...f.flatMap((x) => [x.departurePort, x.arrivalPort]),
    ...stops.map((s) => s.port),
    ...legs.flatMap((l) => [l.fromPort, l.toPort]),
  ] as (PortRef | null)[];
  const stations = f.flatMap((x) => [x.depStation, x.arrStation]) as (StationRef | null)[];
  const airports = f.flatMap((x) => [x.pickupAirport, x.returnAirport]) as (AirportRef | null)[];
  const unlocodes = keysOf(portRefs.map((p) => p?.unlocode));
  const imos = keysOf(f.map((x) => (x.ship as ShipRef | null)?.imo));
  const sourceIds = keysOf(stations.map((s) => s?.sourceId));
  const uics = keysOf(stations.map((s) => s?.uic));
  const icaos = keysOf(airports.map((a) => a?.icao));
  const iatas = keysOf(airports.map((a) => a?.iata));
  const chainNames = keysOf(f.map((x) => (x.lodging as Facts | undefined)?.chain as string | null));
  const [ports, ships, bySource, byUic, byIcao, byIata, chains] = await Promise.all([
    c.port.findMany({
      where: { unlocode: { in: unlocodes } },
      select: { id: true, unlocode: true },
    }),
    c.ship.findMany({ where: { imo: { in: imos } }, select: { id: true, imo: true } }),
    c.railStation.findMany({
      where: { sourceId: { in: sourceIds } },
      select: { id: true, sourceId: true },
    }),
    c.railStation.findMany({
      where: { uic: { in: uics } },
      select: { id: true, uic: true },
      orderBy: [{ isUserAdded: "asc" }, { id: "asc" }],
    }),
    // An open airport before a closed one of the same code (`airports_icao_is_closed_key`).
    c.airport.findMany({
      where: { icao: { in: icaos } },
      select: { id: true, icao: true },
      orderBy: [{ isClosed: "asc" }, { id: "asc" }],
    }),
    c.airport.findMany({
      where: { iata: { in: iatas } },
      select: { id: true, iata: true },
      orderBy: [{ isClosed: "asc" }, { id: "asc" }],
    }),
    c.lodgingChain.findMany({
      where: { name: { in: chainNames }, userId: null },
      select: { id: true, name: true },
    }),
  ]);
  const index = <R extends { id: number }>(rows: R[], key: (r: R) => string | null) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = key(r);
      if (k !== null && !map.has(k)) map.set(k, r.id);
    }
    return map;
  };
  const portIds = index(ports, (p) => p.unlocode);
  const shipIds = index(ships, (s) => s.imo);
  const sourceIdIds = index(bySource, (s) => s.sourceId);
  const uicIds = index(byUic, (s) => s.uic);
  const icaoIds = index(byIcao, (a) => a.icao);
  const iataIds = index(byIata, (a) => a.iata);
  const chainIds = index(chains, (ch) => ch.name);
  const get = (map: Map<string, number>, key: string | null | undefined) =>
    key ? (map.get(key) ?? null) : null;
  return {
    port: (ref) => get(portIds, ref?.unlocode),
    ship: (ref) => get(shipIds, ref?.imo),
    station: (ref) => get(sourceIdIds, ref?.sourceId) ?? get(uicIds, ref?.uic),
    airport: (ref) => get(icaoIds, ref?.icao) ?? get(iataIds, ref?.iata),
    chain: (name) => get(chainIds, name),
  };
}

function without(f: Facts, keys: readonly string[]): Facts {
  return Object.fromEntries(Object.entries(f).filter(([k]) => !keys.includes(k)));
}

function cruiseFacts(f: Facts, r: Resolver): Facts {
  const ship = f.ship as ShipRef | null;
  const shipId = r.ship(ship);
  const stops = (f.stops as Facts[]).map((s) => {
    const port = s.port as PortRef | null;
    const isAtSea = s.isAtSea === true;
    const portId = isAtSea ? null : r.port(port);
    // The 3-state invariant: a port call this catalogue cannot match keeps its name as an
    // unresolved port, and is never turned into a sea day by the miss.
    const unresolved =
      isAtSea || portId !== null
        ? null
        : ((s.unresolvedPortName as string | null) ?? port?.name ?? null);
    return {
      ...without(s, ["port"]),
      portId,
      isAtSea: isAtSea || (portId === null && !unresolved),
      unresolvedPortName: unresolved,
    };
  });
  const legs = (f.legs as Facts[]).flatMap((l) => {
    const fromPortId = r.port(l.fromPort as PortRef);
    const toPortId = r.port(l.toPort as PortRef);
    return fromPortId !== null && toPortId !== null
      ? [{ ...without(l, ["fromPort", "toPort"]), fromPortId, toPortId }]
      : [];
  });
  return {
    ...without(f, ["ship", "departurePort", "arrivalPort"]),
    shipId,
    // A ship this catalogue does not hold keeps its name, as a `.travstats` import does.
    shipNameOverride: f.shipNameOverride ?? (shipId === null ? (ship?.name ?? null) : null),
    cruiseLine: f.cruiseLine ?? ship?.cruiseLine ?? null,
    departurePortId: r.port(f.departurePort as PortRef | null),
    arrivalPortId: r.port(f.arrivalPort as PortRef | null),
    stops,
    legs,
  };
}

function localRef(ref: unknown): EntryRef | null {
  const r = ref as EntryWireRef | null;
  return r ? { table: SHARE_TYPES[r.entity].delegate, key: r.shareKey } : null;
}

function localFacts(entity: ShareEntity, f: Facts, r: Resolver): Facts {
  switch (entity) {
    case "cruise":
      return cruiseFacts(f, r);
    case "rail":
      return {
        ...without(f, ["depStation", "arrStation"]),
        depStationId: r.station(f.depStation as StationRef | null),
        arrStationId: r.station(f.arrStation as StationRef | null),
      };
    case "rental":
      return {
        ...without(f, ["pickupAirport", "returnAirport"]),
        pickupAirportId: r.airport(f.pickupAirport as AirportRef | null),
        returnAirportId: r.airport(f.returnAirport as AirportRef | null),
      };
    case "lodgingStay": {
      const house = f.lodging as Facts;
      return {
        ...f,
        lodging: { ...without(house, ["chain"]), catalogueChainId: r.chain(house.chain as string) },
      };
    }
    case "stop":
      return { ...f, sourceRef: localRef(f.sourceRef), lodgingStayRef: localRef(f.lodgingStayRef) };
    default:
      return f;
  }
}

/** Parsed wire entries as rows of this server, in the order given. */
export async function fromWireEntries(
  c: DbTransaction,
  entries: readonly WireEntry[]
): Promise<{ entity: ShareEntity; row: SharedRow }[]> {
  const r = await resolver(c, entries);
  return entries.map((e) => {
    const facts = localFacts(e.entity, e.facts, r);
    if ("status" in facts) facts.status = receivedStatus(e.entity, facts.status);
    return {
      entity: e.entity,
      row: {
        // Not a row of this server: the copy path reads only the facts and the key.
        id: `wire:${e.shareKey}`,
        userId: "",
        tripId: null,
        shareKey: e.shareKey,
        facts,
        label: "",
        zones: {},
      },
    };
  });
}
