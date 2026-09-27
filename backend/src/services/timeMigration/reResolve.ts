import { randomUUID } from "crypto";

import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type {
  ReResolveApply,
  ReResolveChange,
  ReResolveDryRun,
  ReResolveTable,
} from "../../schemas/timeMigration";
import { RE_RESOLVE_TABLES } from "../../schemas/timeMigration";
import { toLocal } from "../../shared/time/instant";
import logger from "../../utils/logger";
import { placeZone } from "./core";
import { catalogueZones, flightEndPlace } from "./flights";
import { zoneOfStop } from "./tripStops";

/**
 * The admin re-resolution (ADR 0002 D2): a zone is frozen with the value it
 * was written with, so a catalogue correction does not move history — and a
 * zone that was resolved WRONGLY is corrected here, never silently.
 *
 * The dry run re-asks the one resolver (catalogue, then coordinates) for every
 * stored zone and lists the rows whose answer changed, with how far the
 * displayed local time would move at the stored instant. It changes nothing.
 * `apply` writes exactly the changes of one dry run, only the zone column, and
 * only where the stored zone is still the one the dry run saw — a row edited
 * since is skipped and counted (defect class 4: a re-derivation must not
 * overwrite a newer value). The instant is kept: it is the stored truth (D1).
 */

/** Listed in full up to this many; the counts and `apply` cover all of them. */
export const CHANGES_CAP = 500;
/** How long a dry run can be applied. */
export const DRY_RUN_TTL_MS = 60 * 60 * 1000;

interface StoredZone {
  table: ReResolveTable;
  rowId: string;
  column: string;
  /** The Prisma field of `column`. */
  field: string;
  storedZone: string;
  place: { catalogueZone?: string | null; lat?: number | null; lon?: number | null };
  instant: Date | null;
}

interface StoredDryRun {
  view: ReResolveDryRun;
  all: ReResolveChange[];
  fields: Map<string, string>;
}

const dryRuns = new Map<string, StoredDryRun>();

async function flightZones(): Promise<StoredZone[]> {
  const rows = await prisma.flight.findMany({
    where: { OR: [{ depTimezone: { not: null } }, { arrTimezone: { not: null } }] },
    select: {
      id: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      depTimezone: true,
      arrTimezone: true,
      departureTime: true,
      arrivalTime: true,
      depTimeSemantics: true,
      arrTimeSemantics: true,
    },
  });
  const catalogue = await catalogueZones(rows);
  const out: StoredZone[] = [];
  for (const r of rows) {
    for (const end of ["dep", "arr"] as const) {
      const stored = end === "dep" ? r.depTimezone : r.arrTimezone;
      if (!stored) continue;
      const time = end === "dep" ? r.departureTime : r.arrivalTime;
      const realInstant = (end === "dep" ? r.depTimeSemantics : r.arrTimeSemantics) === "UTC";
      out.push({
        table: "flights",
        rowId: r.id,
        column: `${end}_timezone`,
        field: `${end}Timezone`,
        storedZone: stored,
        place: flightEndPlace(r, end, catalogue),
        instant: realInstant ? time : null,
      });
    }
  }
  return out;
}

async function railZones(): Promise<StoredZone[]> {
  const rows = await prisma.railJourney.findMany({
    where: { OR: [{ depTimezone: { not: null } }, { arrTimezone: { not: null } }] },
    select: {
      id: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      depTimezone: true,
      arrTimezone: true,
      departureTime: true,
      arrivalTime: true,
      depStation: { select: { timezone: true } },
      arrStation: { select: { timezone: true } },
    },
  });
  return rows.flatMap((r) =>
    (["dep", "arr"] as const)
      .filter((end) => (end === "dep" ? r.depTimezone : r.arrTimezone))
      .map((end) => ({
        table: "rail_journeys" as const,
        rowId: r.id,
        column: `${end}_timezone`,
        field: `${end}Timezone`,
        storedZone: (end === "dep" ? r.depTimezone : r.arrTimezone) as string,
        place: {
          catalogueZone: (end === "dep" ? r.depStation : r.arrStation)?.timezone ?? null,
          lat: end === "dep" ? r.depLat : r.arrLat,
          lon: end === "dep" ? r.depLon : r.arrLon,
        },
        instant: end === "dep" ? r.departureTime : r.arrivalTime,
      }))
  );
}

async function visitZones(): Promise<StoredZone[]> {
  const rows = await prisma.placeVisit.findMany({
    where: { visitedZone: { not: null } },
    select: {
      id: true,
      visitedZone: true,
      visitedAtUtc: true,
      place: { select: { lat: true, lon: true } },
    },
  });
  return rows.map((r) => ({
    table: "place_visits",
    rowId: r.id,
    column: "visited_zone",
    field: "visitedZone",
    storedZone: r.visitedZone as string,
    place: r.place,
    instant: r.visitedAtUtc,
  }));
}

async function cruiseStopZones(): Promise<StoredZone[]> {
  const rows = await prisma.cruiseStop.findMany({
    where: { stopZone: { not: null } },
    select: {
      id: true,
      stopZone: true,
      arrivalUtc: true,
      departureUtc: true,
      port: { select: { timezone: true, lat: true, lon: true } },
    },
  });
  return rows.map((r) => ({
    table: "cruise_stops",
    rowId: r.id,
    column: "stop_zone",
    field: "stopZone",
    storedZone: r.stopZone as string,
    // A stop whose port was removed has no place left: the resolver abstains.
    place: r.port ? { catalogueZone: r.port.timezone, lat: r.port.lat, lon: r.port.lon } : {},
    instant: r.arrivalUtc ?? r.departureUtc,
  }));
}

async function cruiseZones(): Promise<StoredZone[]> {
  const port = { select: { timezone: true, lat: true, lon: true } } as const;
  const rows = await prisma.cruise.findMany({
    where: { OR: [{ startZone: { not: null } }, { endZone: { not: null } }] },
    select: { id: true, startZone: true, endZone: true, departurePort: port, arrivalPort: port },
  });
  return rows.flatMap((r) =>
    (["start", "end"] as const)
      .filter((key) => (key === "start" ? r.startZone : r.endZone))
      .map((key) => {
        const p = key === "start" ? r.departurePort : r.arrivalPort;
        return {
          table: "cruises" as const,
          rowId: r.id,
          column: `${key}_zone`,
          field: `${key}Zone`,
          storedZone: (key === "start" ? r.startZone : r.endZone) as string,
          place: p ? { catalogueZone: p.timezone, lat: p.lat, lon: p.lon } : {},
          instant: null,
        };
      })
  );
}

async function tripStopZones(): Promise<StoredZone[]> {
  const rows = await prisma.tripStop.findMany({
    where: { stopZone: { not: null } },
    select: { id: true, stopZone: true, startUtc: true, lat: true, lon: true, sourceId: true },
  });
  const out: StoredZone[] = [];
  for (const r of rows) {
    const resolved = await zoneOfStop(r);
    out.push({
      table: "trip_stops",
      rowId: r.id,
      column: "stop_zone",
      field: "stopZone",
      storedZone: r.stopZone as string,
      // Already resolved (the wrapped entry's coordinates included): hand it on as a catalogue zone.
      place: { catalogueZone: resolved.zone },
      instant: r.startUtc,
    });
  }
  return out;
}

async function stayZones(): Promise<StoredZone[]> {
  const rows = await prisma.lodgingStay.findMany({
    where: { stayZone: { not: null } },
    select: {
      id: true,
      stayZone: true,
      checkInAt: true,
      lodging: { select: { lat: true, lon: true } },
    },
  });
  return rows.map((r) => ({
    table: "lodging_stays",
    rowId: r.id,
    column: "stay_zone",
    field: "stayZone",
    storedZone: r.stayZone as string,
    place: r.lodging,
    instant: r.checkInAt,
  }));
}

const LOADERS: Record<ReResolveTable, () => Promise<StoredZone[]>> = {
  flights: flightZones,
  rail_journeys: railZones,
  place_visits: visitZones,
  cruise_stops: cruiseStopZones,
  cruises: cruiseZones,
  trip_stops: tripStopZones,
  lodging_stays: stayZones,
};

const offsetMinutes = (offset: string): number => {
  const sign = offset.startsWith("-") ? -1 : 1;
  const [h, m] = offset.slice(1).split(":").map(Number);
  return sign * (h * 60 + m);
};

function deltaAt(instant: Date | null, from: string, to: string): number | null {
  if (!instant) return null;
  return offsetMinutes(toLocal(instant, to).offset) - offsetMinutes(toLocal(instant, from).offset);
}

export async function reResolveDryRun(now: Date = new Date()): Promise<ReResolveDryRun> {
  const tables: ReResolveDryRun["tables"] = [];
  const all: ReResolveChange[] = [];
  const fields = new Map<string, string>();
  for (const table of RE_RESOLVE_TABLES) {
    const stored = await LOADERS[table]();
    let changes = 0;
    let unresolvable = 0;
    for (const s of stored) {
      // A lookup that cannot RUN throws here and fails the job: never "no change".
      const resolved = placeZone(s.place).zone;
      if (!resolved) {
        unresolvable += 1;
        continue;
      }
      if (resolved === s.storedZone) continue;
      changes += 1;
      fields.set(`${s.table} ${s.column}`, s.field);
      all.push({
        table: s.table,
        rowId: s.rowId,
        column: s.column,
        storedZone: s.storedZone,
        resolvedZone: resolved,
        instant: s.instant ? s.instant.toISOString() : null,
        offsetDeltaMinutes: deltaAt(s.instant, s.storedZone, resolved),
      });
    }
    tables.push({ table, checked: stored.length, changes, unresolvable });
  }
  const view: ReResolveDryRun = {
    dryRunId: randomUUID(),
    tzdata: process.versions.tz ?? null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DRY_RUN_TTL_MS).toISOString(),
    tables,
    changes: all.slice(0, CHANGES_CAP),
    changesTruncated: all.length > CHANGES_CAP,
  };
  for (const [id, run] of dryRuns) {
    if (Date.parse(run.view.expiresAt) <= now.getTime()) dryRuns.delete(id);
  }
  dryRuns.set(view.dryRunId, { view, all, fields });
  return view;
}

/** Throws `DRY_RUN_NOT_FOUND` (404) for an unknown or expired id — checked before a job starts. */
export function requireDryRun(dryRunId: string, now: Date = new Date()): void {
  const run = dryRuns.get(dryRunId);
  if (!run || Date.parse(run.view.expiresAt) <= now.getTime()) {
    throw new AppError("No such dry run, or it expired", 404, "DRY_RUN_NOT_FOUND");
  }
}

type ZoneUpdater = (
  id: string,
  field: string,
  from: string,
  to: string
) => Promise<{ count: number }>;

const UPDATERS: Record<ReResolveTable, ZoneUpdater> = {
  flights: (id, field, from, to) =>
    prisma.flight.updateMany({ where: { id, [field]: from }, data: { [field]: to } }),
  rail_journeys: (id, field, from, to) =>
    prisma.railJourney.updateMany({ where: { id, [field]: from }, data: { [field]: to } }),
  place_visits: (id, field, from, to) =>
    prisma.placeVisit.updateMany({ where: { id, [field]: from }, data: { [field]: to } }),
  cruise_stops: (id, field, from, to) =>
    prisma.cruiseStop.updateMany({ where: { id, [field]: from }, data: { [field]: to } }),
  cruises: (id, field, from, to) =>
    prisma.cruise.updateMany({ where: { id, [field]: from }, data: { [field]: to } }),
  trip_stops: (id, field, from, to) =>
    prisma.tripStop.updateMany({ where: { id, [field]: from }, data: { [field]: to } }),
  lodging_stays: (id, field, from, to) =>
    prisma.lodgingStay.updateMany({ where: { id, [field]: from }, data: { [field]: to } }),
};

export async function applyReResolve(dryRunId: string): Promise<ReResolveApply> {
  requireDryRun(dryRunId);
  const run = dryRuns.get(dryRunId) as StoredDryRun;
  let applied = 0;
  let skippedChanged = 0;
  for (const change of run.all) {
    const field = run.fields.get(`${change.table} ${change.column}`) as string;
    const { count } = await UPDATERS[change.table](
      change.rowId,
      field,
      change.storedZone,
      change.resolvedZone
    );
    if (count === 1) {
      applied += 1;
      logger.info({
        operation: "time_zone_reresolved",
        message: "Stored zone corrected by the admin re-resolution",
        context: {
          table: change.table,
          rowId: change.rowId,
          column: change.column,
          from: change.storedZone,
          to: change.resolvedZone,
        },
      });
    } else {
      skippedChanged += 1;
    }
  }
  // One dry run, one apply: a second apply would only count skips.
  dryRuns.delete(dryRunId);
  return { dryRunId, applied, skippedChanged };
}

/** Test seam. */
export function clearDryRuns(): void {
  dryRuns.clear();
}
