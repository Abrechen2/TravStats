import { prisma } from "../../db";
import type { DomainKey } from "../../shared/domains";
import type { SyncScope } from "./scope";

/**
 * The records the sync feed carries (forgejo#141), one entry per database
 * table that has a `sync_record_change` trigger in migration
 * `20261001193030_sync_change_feed`. The list is what the Companion reads and
 * edits today; `syncTriggers.test.ts` holds it against the triggers that
 * actually exist, so a table cannot be added on one side only.
 *
 * Deliberately NOT carried (they have no trigger, and nothing here pretends
 * otherwise): photographs of any kind (their own upload flows, forgejo#145),
 * derived geometry (cruise legs and tracks, tour legs and tracks — recomputed
 * by the server from the records that ARE carried), companions and their join
 * rows, loyalty cards, place lists, bookings, settings (`/app-settings` has
 * its own `updatedAt` protocol) and everything derived (country days,
 * achievements, suggestions).
 */

/** One row as Prisma returns it; the feed only relies on these two fields. */
export interface SyncRow {
  id: string;
  updatedAt?: Date | null;
  [field: string]: unknown;
}

type FindArgs = {
  where: Record<string, unknown>;
  orderBy?: { id: "asc" };
  take?: number;
};

export interface SyncEntity {
  /** The name in the feed and in `sync_changes.entity`. */
  readonly name: string;
  /** The table the trigger sits on. */
  readonly table: string;
  /** SQL predicate on alias `t` that holds when the row belongs to `$2`. */
  readonly ownerSql: string;
  /** Prisma where-clause for "belongs to this user". */
  ownerWhere(userId: string): Record<string, unknown>;
  find(args: FindArgs): Promise<SyncRow[]>;
  /** May this account see the row? Domain gating, per record. */
  visible(row: SyncRow, scope: SyncScope): boolean;
  /** May it see a tombstone of this entity (the row is gone; `kind` survives). */
  tombstoneVisible(kind: string | null, scope: SyncScope): boolean;
  /**
   * Could any row of this entity be visible under this scope? False for a
   * hidden domain: its changes are skipped outright, because the client
   * cannot hold such a row (the scope is fixed per cursor).
   */
  reachable(scope: SyncScope): boolean;
  /**
   * Columns left out of the record: bulky derived data (a flown track, a
   * rail polyline) and server internals (a stored file name, a raw parse).
   * The fetch endpoints for them still exist.
   */
  readonly omit: readonly string[];
  /** False for a table without `updated_at`: no version, no If-Match. */
  readonly versioned: boolean;
}

const always = (): boolean => true;
const inDomain =
  (domain: DomainKey) =>
  (_rowOrKind: unknown, scope: SyncScope): boolean =>
    scope.domains.has(domain);
const domainShown =
  (domain: DomainKey) =>
  (scope: SyncScope): boolean =>
    scope.domains.has(domain);

/** A tour section is a roadtrip (its own domain) or a tour (the beta switch). */
function routeKindVisible(kind: unknown, scope: SyncScope): boolean {
  return kind === "roadtrip" ? scope.domains.has("roadtrip") : scope.tours;
}

const DIRECT_OWNER = "t.user_id = $2";

// Each `find` is spelled out per model: Prisma's delegates share no common
// callable type, and a cast through one generic delegate would hide a wrong
// relation name from tsc.
const ENTITIES: readonly SyncEntity[] = [
  {
    name: "trip",
    table: "trips",
    ownerSql: DIRECT_OWNER,
    ownerWhere: (userId) => ({ userId }),
    find: (args) => prisma.trip.findMany(args),
    visible: always,
    tombstoneVisible: always,
    omit: [],
    versioned: true,
    reachable: always,
  },
  {
    name: "trip_journal_entry",
    table: "trip_journal_entries",
    ownerSql: "EXISTS (SELECT 1 FROM trips p WHERE p.id = t.trip_id AND p.user_id = $2)",
    ownerWhere: (userId) => ({ trip: { userId } }),
    find: (args) => prisma.tripJournalEntry.findMany(args),
    visible: always,
    tombstoneVisible: always,
    omit: [],
    versioned: true,
    reachable: always,
  },
  {
    name: "flight",
    table: "flights",
    ownerSql: DIRECT_OWNER,
    ownerWhere: (userId) => ({ userId }),
    find: (args) => prisma.flight.findMany(args),
    visible: inDomain("flight"),
    tombstoneVisible: inDomain("flight"),
    omit: ["actualRoute", "enrichmentHistory"],
    versioned: true,
    reachable: domainShown("flight"),
  },
  {
    name: "rail_journey",
    table: "rail_journeys",
    ownerSql: DIRECT_OWNER,
    ownerWhere: (userId) => ({ userId }),
    find: (args) => prisma.railJourney.findMany(args),
    visible: inDomain("rail"),
    tombstoneVisible: inDomain("rail"),
    omit: ["geometry"],
    versioned: true,
    reachable: domainShown("rail"),
  },
  {
    name: "cruise",
    table: "cruises",
    ownerSql: DIRECT_OWNER,
    ownerWhere: (userId) => ({ userId }),
    find: (args) => prisma.cruise.findMany(args),
    visible: inDomain("cruise"),
    tombstoneVisible: inDomain("cruise"),
    omit: [],
    versioned: true,
    reachable: domainShown("cruise"),
  },
  {
    name: "cruise_stop",
    table: "cruise_stops",
    ownerSql: "EXISTS (SELECT 1 FROM cruises p WHERE p.id = t.cruise_id AND p.user_id = $2)",
    ownerWhere: (userId) => ({ cruise: { userId } }),
    find: (args) => prisma.cruiseStop.findMany(args),
    visible: inDomain("cruise"),
    tombstoneVisible: inDomain("cruise"),
    omit: [],
    versioned: true,
    reachable: domainShown("cruise"),
  },
  {
    name: "lodging",
    table: "lodgings",
    ownerSql: DIRECT_OWNER,
    ownerWhere: (userId) => ({ userId }),
    find: (args) => prisma.lodging.findMany(args),
    visible: inDomain("lodging"),
    tombstoneVisible: inDomain("lodging"),
    omit: [],
    versioned: true,
    reachable: domainShown("lodging"),
  },
  {
    name: "lodging_stay",
    table: "lodging_stays",
    ownerSql: DIRECT_OWNER,
    ownerWhere: (userId) => ({ userId }),
    find: (args) => prisma.lodgingStay.findMany(args),
    visible: inDomain("lodging"),
    tombstoneVisible: inDomain("lodging"),
    omit: [],
    versioned: true,
    reachable: domainShown("lodging"),
  },
  {
    name: "place",
    table: "places",
    ownerSql: DIRECT_OWNER,
    ownerWhere: (userId) => ({ userId }),
    find: (args) => prisma.place.findMany(args),
    visible: inDomain("poi"),
    tombstoneVisible: inDomain("poi"),
    omit: [],
    versioned: true,
    reachable: domainShown("poi"),
  },
  {
    name: "place_visit",
    table: "place_visits",
    ownerSql: DIRECT_OWNER,
    ownerWhere: (userId) => ({ userId }),
    find: (args) => prisma.placeVisit.findMany(args),
    visible: inDomain("poi"),
    tombstoneVisible: inDomain("poi"),
    omit: [],
    versioned: true,
    reachable: domainShown("poi"),
  },
  {
    name: "trip_route",
    table: "trip_routes",
    ownerSql: DIRECT_OWNER,
    ownerWhere: (userId) => ({ userId }),
    find: (args) => prisma.tripRoute.findMany(args),
    visible: (row, scope) => routeKindVisible(row.kind, scope),
    tombstoneVisible: (kind, scope) => routeKindVisible(kind, scope),
    omit: [],
    versioned: true,
    reachable: (scope) => scope.domains.has("roadtrip") || scope.tours,
  },
  {
    // A trip's timeline stop is cross-domain; a station hangs off a tour
    // section only and follows that section's kind.
    name: "trip_stop",
    table: "trip_stops",
    ownerSql:
      "(EXISTS (SELECT 1 FROM trips p WHERE p.id = t.trip_id AND p.user_id = $2)" +
      " OR EXISTS (SELECT 1 FROM trip_routes r WHERE r.id = t.route_id AND r.user_id = $2))",
    ownerWhere: (userId) => ({ OR: [{ trip: { userId } }, { route: { userId } }] }),
    find: (args) =>
      prisma.tripStop.findMany({ ...args, include: { route: { select: { kind: true } } } }),
    visible: (row, scope) => {
      if (row.tripId) return true;
      const route = row.route as { kind?: unknown } | null | undefined;
      return routeKindVisible(route?.kind, scope);
    },
    tombstoneVisible: always,
    omit: ["route"],
    versioned: true,
    reachable: always,
  },
  {
    name: "document",
    table: "documents",
    ownerSql: DIRECT_OWNER,
    ownerWhere: (userId) => ({ userId }),
    find: (args) => prisma.document.findMany(args),
    visible: always,
    tombstoneVisible: always,
    omit: ["storedName", "parsedPayload"],
    versioned: false,
    reachable: always,
  },
];

/** Parents before children, so a full snapshot never names a missing parent. */
export const SYNC_ENTITIES: readonly SyncEntity[] = ENTITIES;

const BY_NAME = new Map(ENTITIES.map((entity) => [entity.name, entity]));

export function syncEntity(name: string): SyncEntity | undefined {
  return BY_NAME.get(name);
}

/** The record as the feed and a 409 carry it: omitted fields gone, dates as ISO. */
export function toSyncRecord(entity: SyncEntity, row: SyncRow): Record<string, unknown> {
  const omitted = new Set(entity.omit);
  const kept = Object.fromEntries(Object.entries(row).filter(([key]) => !omitted.has(key)));
  return JSON.parse(JSON.stringify(kept)) as Record<string, unknown>;
}

/** The version token of a row: its `updatedAt`, or null when it has none. */
export function rowVersion(entity: SyncEntity, row: SyncRow): string | null {
  return entity.versioned && row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null;
}

/** `updated_at` → `updatedAt`. `syncTriggers.test.ts` holds every synced column to it. */
export function columnToField(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}
