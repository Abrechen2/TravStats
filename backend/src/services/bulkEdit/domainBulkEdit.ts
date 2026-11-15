import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { dayAnchorNowFor } from "../../shared/time/profileZone";
import { recheckAchievements } from "../../utils/achievements";
import { propagateWrites, shareSnapshots } from "../sharing/propagate";
import { restatusTrips } from "../trip/restatusTrips";
import { replaceCompanionLinks } from "../transport/companionLinks";
import { updateStayRecord, type UpdateStayData } from "../lodging/stayWrites";
import { claimVersion } from "../sync/versionPrecondition";
import { syncEntity } from "../sync/entities";
import {
  addValues,
  companionPlan,
  directory,
  people,
  type NamedPerson,
  type Person,
} from "../flights/bulkEdit";
import type { BulkDomain, DomainBulkEdit } from "../../schemas/domainBulkEdit";
import { DOMAIN_SPECS, type DomainSpec, type Row } from "./domainSpecs";

/**
 * The bulk edit of forgejo#217 for every other domain (forgejo#405 A4): rail,
 * bus, ferry, rental, cruise and stays. Same contract as
 * `services/flights/bulkEdit.ts`:
 *
 * - One unit of work per row (one transaction, one result), so a failure on one
 *   row never rolls back another and the answer names the ones that failed.
 * - Every mode is idempotent: a retry reaches a row that in fact went through
 *   and answers `unchanged`.
 * - The rows are read in one query; every diff is computed in memory and only a
 *   row that changes is written.
 * - A row the caller does not own answers `NOT_FOUND`, exactly as one that does
 *   not exist — nothing tells the two apart. A trip that is not theirs refuses
 *   the whole request before anything is written.
 *
 * On top of that: a client that read a row at version V sends it in
 * `baseVersions`; the row is claimed with the sync precondition's own atomic
 * UPDATE (`claimVersion`, forgejo#141) and answers `VERSION_CONFLICT` instead
 * of being overwritten when it moved on.
 */

export type BulkStatus = "updated" | "unchanged" | "failed";
export type BulkCode = "NOT_FOUND" | "UPDATE_FAILED" | "VERSION_CONFLICT";

export interface BulkResult {
  id: string;
  status: BulkStatus;
  code?: BulkCode;
}

interface Plan {
  data: Record<string, unknown>;
  companionIds: string[] | null;
}

/** The slice of a Prisma delegate the engine uses; the generated types cannot be unified across tables. */
interface RowDelegate {
  findMany(args: unknown): Promise<Row[]>;
  update(args: unknown): Promise<unknown>;
}
interface LinkDelegate {
  deleteMany(args: { where: Record<string, string> }): Promise<unknown>;
  createMany(args: {
    data: Array<{ companionId: string; position: number } & Record<string, string | number>>;
    skipDuplicates: true;
  }): Promise<unknown>;
}

const delegateOf = (c: object, name: string): RowDelegate =>
  (c as unknown as Record<string, RowDelegate>)[name];
const linksOf = (c: object, name: string): LinkDelegate =>
  (c as unknown as Record<string, LinkDelegate>)[name];

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** The columns of a rental that a later mail import must not overwrite. */
const EDIT_PROTECTED = ["tripId", "tags", "companions"] as const;

export async function assertTripOwned(userId: string, edit: DomainBulkEdit): Promise<void> {
  if (edit.trip?.mode !== "set") return;
  const trip = await prisma.trip.findFirst({
    where: { id: edit.trip.tripId, userId },
    select: { id: true },
  });
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND", "trip");
}

function planFor(
  spec: DomainSpec,
  row: Row,
  edit: DomainBulkEdit,
  persons: Map<string, Person>,
  typed: readonly NamedPerson[],
  now: Date
): Plan | null {
  const data: Record<string, unknown> = {};
  if (edit.trip) {
    const tripId = edit.trip.mode === "set" ? edit.trip.tripId : null;
    if (tripId !== ((row.tripId as string | null) ?? null)) data.tripId = tripId;
  }
  if (edit.tags && spec.tagsColumn) {
    const current = (row.tags as string[]) ?? [];
    const tags =
      edit.tags.mode === "add"
        ? addValues(current, edit.tags.values)
        : addValues([], edit.tags.values);
    if (!sameList(tags, current)) data.tags = tags;
  }
  let companionIds: string[] | null = null;
  if (edit.companions) {
    const plan = companionPlan(
      { companions: (row.companions as string[]) ?? [] },
      edit.companions,
      persons,
      typed
    );
    companionIds = plan.companionIds;
    if (plan.companions) data.companions = plan.companions;
  }
  if (edit.status) {
    const current = row.status as string;
    if (edit.status.mode === "cancel" && current !== "cancelled") data.status = "cancelled";
    if (edit.status.mode === "reinstate" && current === "cancelled") {
      data.status = spec.reinstated(row, now);
    }
  }
  if (edit.operator && spec.operatorColumn) {
    const value = edit.operator.mode === "set" ? edit.operator.value : null;
    if (value !== ((row[spec.operatorColumn] as string | null) ?? null)) {
      data[spec.operatorColumn] = value;
    }
  }
  if (edit.serviceClass && spec.classColumn) {
    const value = edit.serviceClass.mode === "set" ? edit.serviceClass.value : null;
    if (value !== ((row[spec.classColumn] as string | null) ?? null)) {
      data[spec.classColumn] = value;
    }
  }
  return Object.keys(data).length === 0 && companionIds === null ? null : { data, companionIds };
}

async function writePlan(spec: DomainSpec, row: Row, plan: Plan): Promise<void> {
  await prisma.$transaction(async (tx: DbTransaction) => {
    if (plan.companionIds !== null && spec.links) {
      await replaceCompanionLinks(
        linksOf(tx, spec.links.delegate) as never,
        spec.links.column,
        row.id,
        plan.companionIds.map((id) => ({ id }))
      );
    }
    const data = { ...plan.data };
    if (spec.protectsEdits) {
      const touched = EDIT_PROTECTED.filter((k) => k in data);
      if (touched.length > 0) {
        const had = (row.userEditedFields as string[]) ?? [];
        data.userEditedFields = addValues(had, touched);
      }
    }
    // The whole edit is propagated once, after the last row (a generic delegate, so no scanner mark).
    await delegateOf(tx, spec.delegate).update({ where: { id: row.id }, data });
  });
}

/** The stay's own update derives its status, copies the trip's share group and propagates. */
async function writeStay(userId: string, row: Row, plan: Plan): Promise<void> {
  const patch: Record<string, unknown> = { ...plan.data };
  await updateStayRecord(
    userId,
    row as unknown as Parameters<typeof updateStayRecord>[1],
    patch as UpdateStayData,
    "typed",
    false
  );
}

async function loadPersons(
  userId: string,
  spec: DomainSpec,
  edit: DomainBulkEdit,
  rows: readonly Row[],
  typed: readonly NamedPerson[]
): Promise<Map<string, Person>> {
  // Stays keep the names only; nobody is created for them.
  if (!edit.companions || !spec.links) return new Map();
  return directory(userId, [
    ...typed,
    ...(edit.companions.mode === "add"
      ? rows.flatMap((r) => people((r.companions as string[]) ?? []))
      : []),
  ]);
}

/** Moves the row's version only when the client's base is still current. */
async function claimed(
  spec: DomainSpec,
  userId: string,
  id: string,
  base: string | undefined
): Promise<boolean> {
  if (base === undefined) return true;
  const entity = syncEntity(spec.syncEntity);
  if (!entity) throw new Error(`bulk edit: ${spec.syncEntity} is not a sync entity`);
  return claimVersion(entity, id, userId, base);
}

export async function bulkEditDomain(
  userId: string,
  domain: BulkDomain,
  edit: DomainBulkEdit
): Promise<BulkResult[]> {
  const spec = DOMAIN_SPECS[domain];
  await assertTripOwned(userId, edit);
  const rows = await delegateOf(prisma, spec.delegate).findMany({
    where: { id: { in: edit.ids }, userId },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const typed = edit.companions ? people(edit.companions.values) : [];
  const persons = await loadPersons(userId, spec, edit, rows, typed);
  const now = await dayAnchorNowFor(userId);

  // Trip and status travel to the members' copies; tags and companions are
  // private. Snapshotted and propagated ONCE for the whole edit.
  const sharedFields = Boolean(edit.trip || edit.status || edit.operator || edit.serviceClass);
  const before =
    sharedFields && !spec.ownWrite
      ? await shareSnapshots(
          prisma,
          spec.shareEntity,
          rows.map((r) => r.id)
        )
      : new Map();
  const written: string[] = [];
  const touchedTrips = new Set<string>();
  const results: BulkResult[] = [];

  for (const id of edit.ids) {
    const row = byId.get(id);
    if (!row) {
      results.push({ id, status: "failed", code: "NOT_FOUND" });
      continue;
    }
    const plan = planFor(spec, row, edit, persons, typed, now);
    if (!plan) {
      results.push({ id, status: "unchanged" });
      continue;
    }
    try {
      if (!(await claimed(spec, userId, id, edit.baseVersions?.[id]))) {
        results.push({ id, status: "failed", code: "VERSION_CONFLICT" });
        continue;
      }
      if (spec.ownWrite) await writeStay(userId, row, plan);
      else await writePlan(spec, row, plan);
      written.push(id);
      if (row.tripId) touchedTrips.add(row.tripId as string);
      if (plan.data.tripId) touchedTrips.add(plan.data.tripId as string);
      results.push({ id, status: "updated" });
    } catch (err: unknown) {
      logger.error({
        operation: "domain_bulk_edit_failed",
        domain,
        userId,
        id,
        error: err instanceof Error ? err.message : "Unknown error",
      });
      results.push({ id, status: "failed", code: "UPDATE_FAILED" });
    }
  }

  // A failed propagation or status recompute does not undo the rows that went
  // through; it is logged and the copies and the trip catch up on the next change.
  if (!spec.ownWrite && sharedFields) {
    await propagateWrites(prisma, userId, spec.shareEntity, written, before).catch((err: unknown) =>
      logger.error({
        operation: "domain_bulk_edit_share_propagation_failed",
        domain,
        userId,
        error: err instanceof Error ? err.message : "Unknown error",
      })
    );
  }
  if (written.length > 0) {
    await restatusTrips([...touchedTrips]).catch((err: unknown) =>
      logger.error({
        operation: "domain_bulk_edit_trip_status_failed",
        domain,
        userId,
        error: err instanceof Error ? err.message : "Unknown error",
      })
    );
    if (spec.ownWrite) {
      await recheckAchievements(userId, "lodging").catch((err: unknown) =>
        logger.error({
          operation: "domain_bulk_edit_achievements_failed",
          userId,
          error: err instanceof Error ? err.message : "Unknown error",
        })
      );
    }
  }
  return results;
}
