import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { contentKey } from "../tripSuggestions/contentKey";
import { loadEntryFacts, type EntryFact } from "./facts";

/**
 * "Your recollection and your record disagree" (docs/superpowers/specs/2026-11-22-remembered-facts.md).
 *
 * A remembered span is approximate on purpose, so it only contradicts a recorded one when the
 * recorded one lies clearly outside it: more than `TOLERANCE_MS` before its start or after its
 * end (a day covers a zone and a night flight). Nothing is changed — the pass writes notices, the
 * user edits the entry or dismisses the notice.
 *
 * A notice is named by `contentKey()` of what the user would recognise (kind, both labels, the
 * recorded day), never by an id, so it exists once, and a dismissal survives deleting and
 * re-importing the entry.
 */
const TOLERANCE_MS = 86_400_000;

export type NoticeKind = "outsideRememberedSpan" | "outsideRecordedSpan";

interface Reading {
  type: string;
  id: string;
  label: string;
  from: string | null;
  to: string | null;
}
export interface NoticeDetail {
  remembered: Reading;
  recorded: Reading;
}
interface Found {
  entryType: string;
  entryId: string;
  contentKey: string;
  kind: NoticeKind;
  detail: NoticeDetail;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const reading = (f: EntryFact): Reading => ({
  type: f.type,
  id: f.id,
  label: f.label,
  from: iso(f.from),
  to: iso(f.to),
});
const isRemembered = (f: EntryFact): boolean => f.provenance === "remembered";

/** Does `inner` stick out of `outer` by more than the tolerance? Without both spans there is no claim. */
function sticksOut(inner: EntryFact, outer: EntryFact): boolean {
  if (!inner.from || !outer.from || !outer.to) return false;
  const innerTo = inner.to ?? inner.from;
  return (
    inner.from.getTime() < outer.from.getTime() - TOLERANCE_MS ||
    innerTo.getTime() > outer.to.getTime() + TOLERANCE_MS
  );
}

function found(kind: NoticeKind, remembered: EntryFact, recorded: EntryFact): Found {
  return {
    entryType: remembered.type,
    entryId: remembered.id,
    contentKey: contentKey(
      "provenance",
      iso(recorded.from) ?? "",
      `${kind}|${remembered.type}:${remembered.label}|${recorded.type}:${recorded.label}`
    ),
    kind,
    detail: { remembered: reading(remembered), recorded: reading(recorded) },
  };
}

/** Every contradiction between a remembered thing and a recorded one of the same trip. */
export async function findContradictions(userId: string): Promise<Found[]> {
  const rememberedTrips = await prisma.trip.findMany({
    where: { userId, provenance: "remembered" },
    select: { id: true },
  });
  const { trips, entries } = await loadEntryFacts(userId, {
    OR: [{ provenance: "remembered" }, { tripId: { in: rememberedTrips.map((t) => t.id) } }],
  });
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const out: Found[] = [];
  for (const entry of entries) {
    const trip = entry.tripId ? tripById.get(entry.tripId) : undefined;
    if (!trip || isRemembered(entry) === isRemembered(trip)) continue;
    // Both remembered: two recollections cannot contradict a record. Both recorded: not our call.
    if (isRemembered(trip) && sticksOut(entry, trip)) {
      out.push(found("outsideRememberedSpan", trip, entry));
    } else if (isRemembered(entry) && sticksOut(entry, trip)) {
      out.push(found("outsideRecordedSpan", entry, trip));
    }
  }
  return out;
}

/**
 * Brings the stored notices in line with the data: a new contradiction becomes ONE pending
 * notice (the unique `(userId, contentKey)` makes a second pass a no-op); a dismissed one stays
 * dismissed; a pending one whose contradiction is gone is `resolved`, and reopens if it returns.
 */
export async function syncProvenanceNotices(userId: string): Promise<void> {
  const current = await findContradictions(userId);
  const existing = await prisma.provenanceNotice.findMany({
    where: { userId },
    select: { id: true, contentKey: true, status: true },
  });
  const byKey = new Map(existing.map((n) => [n.contentKey, n]));
  const liveKeys = new Set(current.map((c) => c.contentKey));

  await prisma.provenanceNotice.createMany({
    data: current
      .filter((c) => !byKey.has(c.contentKey))
      .map((c) => ({
        userId,
        entryType: c.entryType,
        entryId: c.entryId,
        contentKey: c.contentKey,
        kind: c.kind,
        detail: c.detail as unknown as Prisma.InputJsonValue,
      })),
    skipDuplicates: true,
  });
  for (const c of current) {
    const row = byKey.get(c.contentKey);
    if (!row || row.status === "dismissed") continue;
    await prisma.provenanceNotice.update({
      where: { id: row.id },
      data: {
        status: "pending",
        entryType: c.entryType,
        entryId: c.entryId,
        kind: c.kind,
        detail: c.detail as unknown as Prisma.InputJsonValue,
      },
    });
  }
  const gone = existing.filter((n) => n.status === "pending" && !liveKeys.has(n.contentKey));
  if (gone.length > 0) {
    await prisma.provenanceNotice.updateMany({
      where: { id: { in: gone.map((n) => n.id) }, userId },
      data: { status: "resolved" },
    });
  }
}

export interface ProvenanceNoticeView {
  id: string;
  entryType: string;
  entryId: string;
  kind: string;
  detail: NoticeDetail;
  createdAt: string;
}

export async function listProvenanceNotices(userId: string): Promise<ProvenanceNoticeView[]> {
  await syncProvenanceNotices(userId);
  const rows = await prisma.provenanceNotice.findMany({
    where: { userId, status: "pending" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    entryType: r.entryType,
    entryId: r.entryId,
    kind: r.kind,
    detail: r.detail as unknown as NoticeDetail,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Dismisses one pending notice of the caller; false when there is nothing pending to dismiss. */
export async function dismissProvenanceNotice(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.provenanceNotice.updateMany({
    where: { id, userId, status: "pending" },
    data: { status: "dismissed" },
  });
  return count > 0;
}
