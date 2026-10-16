import type { DomainKey } from "../../shared/domains";

/**
 * The shareable entry types (design 2026-10-09; rework 2026-10-16, D1) — the
 * ONE list every per-type piece of sharing derives from: the notice
 * vocabulary, the share loop, key operations, detach, bulk sync, the merge,
 * the `.travstats` kinds, the coverage guard and the inbox labels.
 *
 * Order is copy order. Stops come last: a stop resolves the entry it wraps by
 * share key in the recipient's account, so that entry must exist first.
 *
 * `shareTypes.test.ts` holds this list against the database (every table with
 * a `share_key` column), against `DOMAIN_KEYS` and against the inbox labels.
 */
export const SHARE_ENTITIES = [
  "flight",
  "lodgingStay",
  "cruise",
  "rail",
  "bus",
  "rental",
  "stop",
] as const;
export type ShareEntity = (typeof SHARE_ENTITIES)[number];

/** The Prisma delegate behind a type — what `keyOps.delegateOf` switches over. */
export type ShareDelegate =
  | "flight"
  | "lodgingStay"
  | "cruise"
  | "railJourney"
  | "busJourney"
  | "ferryJourney"
  | "rentalBooking"
  | "tripStop";

/** The entry kinds of a `.travstats` file (`trip/exchange/format.ts`). */
export type ExchangeKind =
  "flight" | "stay" | "cruise" | "rail" | "bus" | "ferry" | "rental" | "stop";

export interface ShareTypeMeta {
  /** The domain whose entries these are; null for a timeline stop, which belongs to no domain. */
  readonly domain: DomainKey | null;
  readonly delegate: ShareDelegate;
  /** The SQL table (`@@map`), as `information_schema` names it. */
  readonly table: string;
  /** The key in a share's `created` counts — the wire name since S1. */
  readonly countKey: string;
  /** The `.travstats` kind; null while the file format does not carry the type. */
  readonly exchangeKind: ExchangeKind | null;
}

export const SHARE_TYPES = {
  flight: {
    domain: "flight",
    delegate: "flight",
    table: "flights",
    countKey: "flights",
    exchangeKind: "flight",
  },
  lodgingStay: {
    domain: "lodging",
    delegate: "lodgingStay",
    table: "lodging_stays",
    countKey: "lodgingStays",
    exchangeKind: "stay",
  },
  cruise: {
    domain: "cruise",
    delegate: "cruise",
    table: "cruises",
    countKey: "cruises",
    exchangeKind: "cruise",
  },
  rail: {
    domain: "rail",
    delegate: "railJourney",
    table: "rail_journeys",
    countKey: "railJourneys",
    exchangeKind: "rail",
  },
  bus: {
    domain: "bus",
    delegate: "busJourney",
    table: "bus_journeys",
    countKey: "busJourneys",
    exchangeKind: "bus",
  },
  rental: {
    domain: "rental",
    delegate: "rentalBooking",
    table: "rental_bookings",
    countKey: "rentals",
    exchangeKind: "rental",
  },
  stop: {
    domain: null,
    delegate: "tripStop",
    table: "trip_stops",
    countKey: "stops",
    exchangeKind: "stop",
  },
} as const satisfies Readonly<Record<ShareEntity, ShareTypeMeta>>;

type CountKey = (typeof SHARE_TYPES)[ShareEntity]["countKey"];
/** What one share created in the recipient's account, per type. */
export type CopyCounts = Record<CountKey, number>;

export function emptyCounts(): CopyCounts {
  return Object.fromEntries(SHARE_ENTITIES.map((e) => [SHARE_TYPES[e].countKey, 0])) as CopyCounts;
}

/**
 * Every domain, shared or not, with the reason. `Record<DomainKey, …>` makes a
 * domain added to `shared/domains.ts` a compile error here until someone
 * decides — the step forgotten for bus and ferry.
 */
export const DOMAIN_SHARING: Readonly<Record<DomainKey, ShareEntity | { notShared: string }>> = {
  flight: "flight",
  cruise: "cruise",
  lodging: "lodgingStay",
  poi: { notShared: "A place visit is the visitor's own; owner decision 2 keeps it private." },
  roadtrip: { notShared: "Roadtrips and their stations are not shared (S1 scope, 2026-10-09)." },
  rail: "rail",
  rental: "rental",
  bus: "bus",
  ferry: {
    notShared: "Crossings join the registry with their adapter (rework 2026-10-16, Task 5).",
  },
};

/** What a copy is marked with where the table has a `dataSource` column. */
export const SHARED_SOURCE = "shared";
