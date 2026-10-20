/**
 * The sending side of the wire (spec 2026-10-20 §4): an entry as the adapters load it
 * (`SharedRow`, already projected through the fact lists by `facts/pick.ts`) becomes the entry
 * the wire carries. Catalogue ids become natural keys; a catalogue row a user added on this server
 * travels as name and position only, because its key, if it has one, is this server's word and
 * not the catalogue's. The encoder of `shapes.ts` then emits exactly the shape's keys.
 */
import type { DbTransaction } from "../../../../db";
import type { SharedRow } from "../../adapters";
import {
  SHARE_ENTITIES,
  SHARE_TYPES,
  type ShareDelegate,
  type ShareEntity,
} from "../../shareTypes";
import type { EntryRef } from "../../adapters/stop";
import type { PortRef, ShipRef } from "../../../trip/exchange/publicHalf";
import { encodeShape } from "./codec";
import {
  ENTRY_SHAPES,
  type AirportRef,
  type EntryWireRef,
  type StationRef,
  type WireEntry,
} from "./shapes";

type Facts = Record<string, unknown>;

interface Catalogue {
  ports: Map<number, PortRef>;
  ships: Map<number, ShipRef>;
  stations: Map<number, StationRef>;
  airports: Map<number, AirportRef>;
  chains: Map<number, string>;
}

const ids = (values: unknown[]): number[] => [
  ...new Set(values.filter((v): v is number => typeof v === "number")),
];

/** Every catalogue id the rows name, read once per kind. */
async function loadCatalogue(c: DbTransaction, rows: readonly SharedRow[]): Promise<Catalogue> {
  const f = rows.map((r) => r.facts);
  const stops = f.flatMap((x) => (Array.isArray(x.stops) ? (x.stops as Facts[]) : []));
  const legs = f.flatMap((x) => (Array.isArray(x.legs) ? (x.legs as Facts[]) : []));
  const portIds = ids([
    ...f.flatMap((x) => [x.departurePortId, x.arrivalPortId]),
    ...stops.map((s) => s.portId),
    ...legs.flatMap((l) => [l.fromPortId, l.toPortId]),
  ]);
  const houses = f.flatMap((x) => (x.lodging ? [x.lodging as Facts] : []));
  const [ports, ships, stations, airports, chains] = await Promise.all([
    c.port.findMany({ where: { id: { in: portIds } } }),
    c.ship.findMany({ where: { id: { in: ids(f.map((x) => x.shipId)) } } }),
    c.railStation.findMany({
      where: { id: { in: ids(f.flatMap((x) => [x.depStationId, x.arrStationId])) } },
    }),
    c.airport.findMany({
      where: { id: { in: ids(f.flatMap((x) => [x.pickupAirportId, x.returnAirportId])) } },
    }),
    c.lodgingChain.findMany({
      where: { id: { in: ids(houses.map((h) => h.catalogueChainId)) }, userId: null },
      select: { id: true, name: true },
    }),
  ]);
  return {
    ports: new Map(
      ports.map((p) => [
        p.id,
        {
          unlocode: p.isUserAdded ? null : p.unlocode,
          name: p.name,
          country: p.country,
          lat: p.lat,
          lon: p.lon,
        },
      ])
    ),
    ships: new Map(
      ships.map((s) => [
        s.id,
        { name: s.name, imo: s.isUserAdded ? null : s.imo, cruiseLine: s.cruiseLine },
      ])
    ),
    stations: new Map(
      stations.map((s) => [
        s.id,
        {
          sourceId: s.isUserAdded ? null : s.sourceId,
          uic: s.isUserAdded ? null : s.uic,
          name: s.name,
          lat: s.lat,
          lon: s.lon,
        },
      ])
    ),
    airports: new Map(
      airports.map((a) => [
        a.id,
        {
          icao: a.isUserAdded ? null : a.icao,
          iata: a.isUserAdded ? null : a.iata,
          name: a.name,
          lat: a.lat,
          lon: a.lon,
        },
      ])
    ),
    chains: new Map(chains.map((ch) => [ch.id, ch.name])),
  };
}

const lookup = <T>(map: Map<number, T>, id: unknown): T | null =>
  typeof id === "number" ? (map.get(id) ?? null) : null;

const ENTITY_OF_DELEGATE = new Map<ShareDelegate, ShareEntity>(
  SHARE_ENTITIES.map((e) => [SHARE_TYPES[e].delegate, e])
);

function entryRef(ref: unknown): EntryWireRef | null {
  const r = ref as EntryRef | null;
  const entity = r ? ENTITY_OF_DELEGATE.get(r.table) : undefined;
  return r && entity && entity !== "stop" ? { entity, shareKey: r.key } : null;
}

/** The facts with every catalogue id replaced by its reference. */
function withRefs(entity: ShareEntity, f: Facts, cat: Catalogue): Facts {
  switch (entity) {
    case "cruise":
      return {
        ...f,
        ship: lookup(cat.ships, f.shipId),
        departurePort: lookup(cat.ports, f.departurePortId),
        arrivalPort: lookup(cat.ports, f.arrivalPortId),
        stops: (f.stops as Facts[]).map((s) => ({ ...s, port: lookup(cat.ports, s.portId) })),
        // A leg names two ports by id; one the catalogue no longer holds cannot be described.
        legs: (f.legs as Facts[]).flatMap((l) => {
          const fromPort = lookup(cat.ports, l.fromPortId);
          const toPort = lookup(cat.ports, l.toPortId);
          return fromPort && toPort ? [{ ...l, fromPort, toPort }] : [];
        }),
      };
    case "rail":
      return {
        ...f,
        depStation: lookup(cat.stations, f.depStationId),
        arrStation: lookup(cat.stations, f.arrStationId),
      };
    case "rental":
      return {
        ...f,
        pickupAirport: lookup(cat.airports, f.pickupAirportId),
        returnAirport: lookup(cat.airports, f.returnAirportId),
      };
    case "lodgingStay": {
      const house = f.lodging as Facts;
      return { ...f, lodging: { ...house, chain: lookup(cat.chains, house.catalogueChainId) } };
    }
    case "stop":
      return { ...f, sourceRef: entryRef(f.sourceRef), lodgingStayRef: entryRef(f.lodgingStayRef) };
    default:
      return f;
  }
}

/** The wire entries of `rows`, all of one type. A row without a share key is not sent. */
export async function toWireEntries(
  c: DbTransaction,
  entity: ShareEntity,
  rows: readonly SharedRow[]
): Promise<WireEntry[]> {
  const keyed = rows.filter((r): r is SharedRow & { shareKey: string } => !!r.shareKey);
  const cat = await loadCatalogue(c, keyed);
  return keyed.map((row) => ({
    entity,
    shareKey: row.shareKey,
    facts: encodeShape(ENTRY_SHAPES[entity], withRefs(entity, row.facts, cat)),
  }));
}
