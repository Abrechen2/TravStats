/**
 * Stored readiness state: per-account snoozes and opt-outs, read update notes,
 * the account's last acknowledged version and the instance's upgrade history
 * (spec 2026-11-14 §3.2, §3.3, §11). A row belongs to one account and one item
 * REVISION; a check whose revision was raised ignores the old row.
 */
import { prisma } from "../../db";
import { buildVersion } from "../../utils/version";
import logger from "../../utils/logger";

export const SNOOZE_DEFAULT_MS = 24 * 60 * 60 * 1000;
export const SNOOZE_MAX_MS = 30 * 24 * 60 * 60 * 1000;

export interface ItemStateRow {
  revision: number;
  kind: "snoozed" | "optedOut";
  until: Date | null;
}

export interface AccountReadinessState {
  ackVersion: string;
  items: ReadonlyMap<string, ItemStateRow>;
  ackedNotes: ReadonlySet<string>;
}

export async function loadAccountState(userId: string): Promise<AccountReadinessState> {
  const [user, items, acks] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { readinessAckVersion: true } }),
    prisma.readinessItemState.findMany({ where: { userId } }),
    prisma.readinessNoteAck.findMany({ where: { userId }, select: { noteId: true } }),
  ]);
  return {
    ackVersion: user?.readinessAckVersion ?? "2.7.0",
    items: new Map(
      items.map((r) => [
        r.itemId,
        {
          revision: r.revision,
          kind: r.kind === "optedOut" ? "optedOut" : "snoozed",
          until: r.until,
        },
      ])
    ),
    ackedNotes: new Set(acks.map((a) => a.noteId)),
  };
}

export interface InvitationState {
  seen: ReadonlySet<string>;
  snoozedUntil: Date | null;
}

export async function loadInvitationState(userId: string): Promise<InvitationState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { readinessInvitationSeen: true, readinessInvitationSnoozedUntil: true },
  });
  return {
    seen: new Set(user?.readinessInvitationSeen ?? []),
    snoozedUntil: user?.readinessInvitationSnoozedUntil ?? null,
  };
}

/** The seen set is REPLACED by the keys shown now, so a key that resolved and returns is new again. */
export async function markInvitationSeen(userId: string, keys: readonly string[]): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { readinessInvitationSeen: [...keys] },
  });
}

export async function snoozeInvitation(userId: string, until: Date): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { readinessInvitationSnoozedUntil: until },
  });
}

export async function setItemState(
  userId: string,
  itemId: string,
  revision: number,
  kind: "snoozed" | "optedOut",
  until: Date | null
): Promise<void> {
  await prisma.readinessItemState.upsert({
    where: { userId_itemId: { userId, itemId } },
    create: { userId, itemId, revision, kind, until },
    update: { revision, kind, until },
  });
}

export async function clearItemState(userId: string, itemId: string): Promise<void> {
  await prisma.readinessItemState.deleteMany({ where: { userId, itemId } });
}

export async function acknowledgeNote(userId: string, noteId: string): Promise<void> {
  await prisma.readinessNoteAck.upsert({
    where: { userId_noteId: { userId, noteId } },
    create: { userId, noteId },
    update: {},
  });
}

let historyRecorded = false;

/**
 * Remember that this instance has run the current version. Idempotent, and
 * once per process after it succeeded. A failure is logged and retried on the
 * next call: history is bookkeeping and must never fail a request or the boot.
 */
export async function recordRunningVersion(): Promise<void> {
  if (historyRecorded) return;
  try {
    await prisma.instanceVersionHistory.createMany({
      data: [{ version: buildVersion }],
      skipDuplicates: true,
    });
    historyRecorded = true;
  } catch (error) {
    logger.warn(
      {
        operation: "readiness_history_not_recorded",
        error: { message: error instanceof Error ? error.message : "unknown" },
      },
      "[Readiness] Could not record the running version"
    );
  }
}

/** Test seam. */
export function resetHistoryFlag(): void {
  historyRecorded = false;
}
