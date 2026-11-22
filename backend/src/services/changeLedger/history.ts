import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { propagateWrite, shareSnapshot, SHARE_TX_TIMEOUT_MS } from "../sharing/propagate";
import type { ShareEntity } from "../sharing/shareTypes";
import { resolveChangeContext, withChangeSource } from "./context";
import {
  delegateOf,
  IGNORED_FIELDS,
  modelMeta,
  modelOfEntityType,
  type TrackedModel,
} from "./models";
import { decodeValue } from "./values";

/** The newest rows first; a page is bounded in the query, ordered totally by (time, id). */
export const HISTORY_PAGE_SIZE = 100;

/**
 * The fields a restore may write back on its own: free text and labels that
 * nothing else is derived from. Everything else is shown in the history but
 * changed through the entry's own form, because a direct write would skip
 * what that form recomputes — a time's instant, zone and precision (ADR 0002),
 * an airport's coordinates and zone, a price's FX snapshot, the companion
 * links behind `companions`, a trip's status behind `tripId`.
 */
export const RESTORABLE_FIELDS: ReadonlySet<string> = new Set([
  "notes",
  "tags",
  "seatNumber",
  "seatClass",
  "boardingGroup",
  "gate",
  "terminal",
  "bookingReference",
  "ticketNumber",
  "ticketReference",
  "confirmationNumber",
  "brokerReference",
  "agreementNumber",
  "invoiceNumber",
  "baggageAllowance",
  "frequentFlyerNumber",
  "bookingClassLetter",
  "baggageBelt",
  "checkInDesk",
  "aircraft",
  "aircraftRegistration",
  "callsign",
  "roomNumber",
  "roomCategory",
  "board",
  "travelClass",
  "fareClass",
  "cabinNumber",
  "cabinType",
  "vehicleType",
  "vehicleRegistration",
  "vehicleClass",
  "vehicleExample",
  "vehicleDriven",
  "licensePlate",
  "excursionNote",
  "category",
  "summary",
  "payerName",
]);

const SHARE_ENTITY: Partial<Record<TrackedModel, ShareEntity>> = {
  Flight: "flight",
  LodgingStay: "lodgingStay",
  Cruise: "cruise",
  RailJourney: "rail",
  BusJourney: "bus",
  FerryJourney: "ferry",
  RentalBooking: "rental",
};

export interface HistoryRow {
  id: string;
  changeSetId: string;
  entityType: string;
  entityId: string;
  operation: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  valueType: string | null;
  omitted: boolean;
  label: string | null;
  source: string;
  /** `self` when this account made the change, `other` for another account, null for the system. */
  actor: "self" | "other" | null;
  reason: string | null;
  restoredFromId: string | null;
  restorable: boolean;
  createdAt: string;
}

type LedgerRecord = Prisma.ChangeLedgerEntryGetPayload<object>;

function fieldType(model: TrackedModel | null, field: string | null): string | null {
  if (!model || !field) return null;
  return modelMeta(model).scalars.get(field)?.type ?? null;
}

export function isRestorable(row: LedgerRecord): boolean {
  const model = modelOfEntityType(row.entityType);
  const type = fieldType(model, row.field);
  return (
    row.operation === "update" &&
    !row.omitted &&
    row.field !== null &&
    (type === "String" || type === "Int" || type === "Float") &&
    RESTORABLE_FIELDS.has(row.field) &&
    !IGNORED_FIELDS.has(row.field)
  );
}

function parse(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function present(row: LedgerRecord, viewerId: string): HistoryRow {
  const model = modelOfEntityType(row.entityType);
  return {
    id: row.id,
    changeSetId: row.changeSetId,
    entityType: row.entityType,
    entityId: row.entityId,
    operation: row.operation,
    field: row.field,
    oldValue: parse(row.oldValue),
    newValue: parse(row.newValue),
    valueType: fieldType(model, row.field),
    omitted: row.omitted,
    label: row.label,
    source: row.source,
    actor: row.actorUserId === null ? null : row.actorUserId === viewerId ? "self" : "other",
    reason: row.reason,
    restoredFromId: row.restoredFromId,
    restorable: isRestorable(row),
    createdAt: row.createdAt.toISOString(),
  };
}

export interface HistoryQuery {
  entityType?: string;
  entityId?: string;
  /** A row id: the page continues after it. */
  after?: string;
}

/** The account's history, newest first; only ever its own rows. */
export async function listHistory(
  userId: string,
  q: HistoryQuery
): Promise<{ entries: HistoryRow[]; nextCursor: string | null }> {
  const where: Prisma.ChangeLedgerEntryWhereInput = { userId };
  if (q.entityType) where.entityType = q.entityType;
  if (q.entityId) where.entityId = q.entityId;
  if (q.after) {
    const cursor = await prisma.changeLedgerEntry.findFirst({
      where: { id: q.after, userId },
      select: { createdAt: true, id: true },
    });
    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }
  }
  const rows = await prisma.changeLedgerEntry.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HISTORY_PAGE_SIZE + 1,
  });
  const page = rows.slice(0, HISTORY_PAGE_SIZE);
  return {
    entries: page.map((r) => present(r, userId)),
    nextCursor: rows.length > HISTORY_PAGE_SIZE ? page[page.length - 1].id : null,
  };
}

const notRestorable = (why: string) =>
  new AppError(`Change cannot be restored: ${why}`, 409, "CHANGE_NOT_RESTORABLE");

type Delegate = {
  findFirst(args: unknown): Promise<{ id: string } | null>;
  update(args: unknown): Promise<unknown>;
};

/** The entry, if it still exists and is the account's own. */
function ownedWhere(model: TrackedModel, id: string, userId: string): Record<string, unknown> {
  return modelMeta(model).owner.kind === "column" ? { id, userId } : { id, cruise: { userId } };
}

/**
 * Write one recorded old value back. The write goes through the same hook as
 * any edit, so the restore is itself a ledger row (with `restoredFromId`), and
 * through the share propagation like any edit of a shared entry.
 */
export async function restoreChange(userId: string, ledgerId: string): Promise<HistoryRow[]> {
  const row = await prisma.changeLedgerEntry.findFirst({ where: { id: ledgerId, userId } });
  if (!row) throw new AppError("Change not found", 404, "CHANGE_NOT_FOUND");
  const model = modelOfEntityType(row.entityType);
  if (!model || !isRestorable(row) || row.field === null) throw notRestorable("not a value");
  const field = row.field;
  const type = fieldType(model, field) as string;
  const value = decodeValue(row.oldValue, type);
  const source = resolveChangeContext()?.source ?? "web";
  const shareEntity = SHARE_ENTITY[model];

  try {
    await withChangeSource(
      source,
      () =>
        prisma.$transaction(
          async (tx) => {
            const delegate = (tx as unknown as Record<string, Delegate>)[delegateOf(model)];
            const current = await delegate.findFirst({
              where: ownedWhere(model, row.entityId, userId),
              select: { id: true },
            });
            if (!current) throw notRestorable("the entry is gone");
            const before = shareEntity
              ? await shareSnapshot(tx, shareEntity, row.entityId)
              : undefined;
            await delegate.update({ where: { id: row.entityId }, data: { [field]: value } });
            if (shareEntity) await propagateWrite(tx, userId, shareEntity, row.entityId, before);
          },
          { timeout: SHARE_TX_TIMEOUT_MS }
        ),
      { restoredFromId: row.id, reason: "restore", actorUserId: userId }
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = (error as { code?: unknown })?.code;
    // A value that names a record which no longer exists (a deleted trip).
    if (code === "P2003" || code === "P2025") throw notRestorable("it names a missing record");
    throw error;
  }

  const written = await prisma.changeLedgerEntry.findMany({
    where: { userId, restoredFromId: row.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
  });
  return written.map((r) => present(r, userId));
}
