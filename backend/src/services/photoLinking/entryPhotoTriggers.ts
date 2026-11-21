import { prisma, setWriteObserver, type WriteEvent } from "../../db";
import logger from "../../utils/logger";
import { autoLinkEnabled, recordRun } from "../places/visitPhotoAutoLink";
import { entryIdsOf, type EntryKind } from "./entryKinds";
import { ownsEntry, runEntries, type EntryRef } from "./entryPhotos";

/**
 * Who starts the automatic photo pass for an entry. Not each creator: there are
 * some fifty paths that write a flight, a stay, a journey, a rental, a cruise
 * stop or a roadtrip station (web, batch, import sheets, trip exchange, package
 * commit, Companion, sharing copies, planning handover), and a pass that depends
 * on each of them remembering a call is a pass a new creator will silently miss —
 * the place visit's per-creator list needs a source scanner to hold it. Here the
 * one place every write goes through, the database client, reports it
 * (`db.setWriteObserver`), and this file decides whether the write can change
 * where or when the entry happened.
 *
 * A write marks the entry DIRTY in the database (`entry_photo_dirty`, one row per
 * entry; `'*'` = every entry of that kind of the account, for a bulk write that
 * cannot name its rows); the pass runs a few seconds later, once per account,
 * and consumes the marks it covered only AFTER it ran. A restart, an import that
 * outlasts any timer, or a pass that failed leaves the marks for the next drain
 * (also run at boot). An entry that is not visible yet (an enclosing transaction
 * has not committed) keeps its mark for a few minutes.
 *
 * `updateMany` that touches a time or position column marks by its `where`
 * (`userId`, `id`, `id in`); one that names neither is left to the next full
 * pass. A place's catalogue coordinates (a port moved) likewise.
 */

/** Columns whose change moves an entry's window or location, per model. */
const RELEVANT: Record<string, { kind: EntryKind; fields: readonly string[] }> = {
  Flight: {
    kind: "flight",
    fields: ["departureTime", "arrivalTime", "depLat", "depLon", "arrLat", "arrLon"],
  },
  LodgingStay: {
    kind: "stay",
    fields: [
      "checkInAt",
      "checkOutAt",
      "checkInDate",
      "checkOutDate",
      "stayZone",
      "datePrecision",
      "lodgingId",
    ],
  },
  RailJourney: { kind: "rail", fields: journeyFields() },
  BusJourney: { kind: "bus", fields: journeyFields() },
  FerryJourney: { kind: "ferry", fields: journeyFields() },
  RentalBooking: {
    kind: "rental",
    fields: [
      "pickupTime",
      "returnTime",
      "actualPickupTime",
      "actualReturnTime",
      "pickupPrecision",
      "returnPrecision",
      "pickupLat",
      "pickupLon",
      "returnLat",
      "returnLon",
    ],
  },
  CruiseStop: {
    kind: "cruiseStop",
    fields: ["portId", "stopDate", "arrivalUtc", "isAtSea", "stopZone"],
  },
  TripStop: {
    kind: "roadtripStop",
    fields: ["lat", "lon", "startUtc", "endUtc", "startDate", "endDate", "stopZone"],
  },
};

function journeyFields(): string[] {
  return [
    "departureTime",
    "arrivalTime",
    "actualDepartureTime",
    "actualArrivalTime",
    "depPrecision",
    "arrPrecision",
    "depLat",
    "depLon",
    "arrLat",
    "arrLon",
  ];
}

const touches = (data: unknown, fields: readonly string[]): boolean =>
  typeof data === "object" && data !== null && fields.some((f) => f in (data as object));

export const TRIGGER_DELAY_MS = 4_000;
/** A mark whose entry still does not exist after this long names a rolled-back write. */
const MARK_PATIENCE_MS = 5 * 60_000;
const timers = new Map<string, NodeJS.Timeout>();
let delayMs = TRIGGER_DELAY_MS;

/** Tests shorten the wait; production keeps the default. */
export function setTriggerDelay(ms: number): void {
  delayMs = ms;
}

const WILDCARD = "*";

async function ownerOf(kind: EntryKind, id: string): Promise<string | null> {
  const pick = { where: { id }, select: { userId: true } } as const;
  switch (kind) {
    case "flight":
      return (await prisma.flight.findUnique(pick))?.userId ?? null;
    case "stay":
      return (await prisma.lodgingStay.findUnique(pick))?.userId ?? null;
    case "rail":
      return (await prisma.railJourney.findUnique(pick))?.userId ?? null;
    case "bus":
      return (await prisma.busJourney.findUnique(pick))?.userId ?? null;
    case "ferry":
      return (await prisma.ferryJourney.findUnique(pick))?.userId ?? null;
    case "rental":
      return (await prisma.rentalBooking.findUnique(pick))?.userId ?? null;
    case "cruiseStop":
      return (
        (
          await prisma.cruiseStop.findUnique({
            where: { id },
            select: { cruise: { select: { userId: true } } },
          })
        )?.cruise.userId ?? null
      );
    case "roadtripStop":
      return (
        (
          await prisma.tripStop.findUnique({
            where: { id },
            select: { route: { select: { userId: true } } },
          })
        )?.route?.userId ?? null
      );
  }
}

interface Mark {
  userId: string;
  kind: EntryKind;
  entryId: string;
}

/** Upsert the marks and arm the account's drain. Never throws into a write. */
async function mark(marks: Mark[]): Promise<void> {
  for (const m of marks) {
    await prisma.entryPhotoDirty.upsert({
      where: { userId_kind_entryId: m },
      create: m,
      update: { markedAt: new Date() },
    });
  }
  for (const userId of new Set(marks.map((m) => m.userId))) armDrain(userId);
}

function armDrain(userId: string): void {
  const held = timers.get(userId);
  if (held) clearTimeout(held);
  const timer = setTimeout(() => {
    timers.delete(userId);
    void drain(userId).catch((error) =>
      logger.error({ message: "entry_photo_drain_failed", context: { userId }, error })
    );
  }, delayMs);
  timer.unref();
  timers.set(userId, timer);
}

/**
 * Run the passes the account's marks ask for and consume the marks that were
 * covered. A mark set while the pass ran (newer `markedAt`) survives.
 */
export async function drain(userId: string): Promise<void> {
  const claimedAt = new Date();
  const rows = await prisma.entryPhotoDirty.findMany({ where: { userId } });
  if (rows.length === 0) return;
  const done: string[] = [];
  const refs = new Map<string, EntryRef>();
  let waiting = false;
  for (const row of rows) {
    const kind = row.kind as EntryKind;
    if (row.entryId === WILDCARD) {
      for (const id of await entryIdsOf(userId, kind)) refs.set(`${kind}:${id}`, { kind, id });
      done.push(row.id);
    } else if (await ownsEntry(userId, kind, row.entryId)) {
      refs.set(`${kind}:${row.entryId}`, { kind, id: row.entryId });
      done.push(row.id);
    } else if (Date.now() - row.markedAt.getTime() > MARK_PATIENCE_MS) {
      done.push(row.id);
    } else {
      waiting = true;
    }
  }
  if (refs.size > 0 && (await autoLinkEnabled(userId))) {
    const run = await runEntries(userId, [...refs.values()]);
    await recordRun(userId, run);
  }
  await prisma.entryPhotoDirty.deleteMany({
    where: { id: { in: done }, markedAt: { lte: claimedAt } },
  });
  if (waiting) armDrain(userId);
}

/** At boot and on demand: every account that still has marks. */
export async function drainAllDirty(): Promise<void> {
  const users = await prisma.entryPhotoDirty.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });
  for (const { userId } of users) armDrain(userId);
}

function idsOf(result: unknown): string[] {
  const rows = Array.isArray(result) ? result : [result];
  return rows.flatMap((r) =>
    typeof r === "object" && r !== null && typeof (r as { id?: unknown }).id === "string"
      ? [(r as { id: string }).id]
      : []
  );
}

/** The ids and/or owner a bulk write's `where` names, or null when it names neither. */
function scopeOf(where: unknown): { ids: string[]; userId: string | null } | null {
  if (typeof where !== "object" || where === null) return null;
  const w = where as { id?: unknown; userId?: unknown };
  const ids =
    typeof w.id === "string"
      ? [w.id]
      : typeof w.id === "object" && w.id !== null && Array.isArray((w.id as { in?: unknown }).in)
        ? ((w.id as { in: unknown[] }).in.filter((x) => typeof x === "string") as string[])
        : [];
  const userId = typeof w.userId === "string" ? w.userId : null;
  return ids.length > 0 || userId ? { ids, userId } : null;
}

async function marksFor(kind: EntryKind, ids: string[], userId: string | null): Promise<Mark[]> {
  if (ids.length === 0) return userId ? [{ userId, kind, entryId: WILDCARD }] : [];
  const marks: Mark[] = [];
  for (const id of ids) {
    const owner = userId ?? (await ownerOf(kind, id));
    if (owner) marks.push({ userId: owner, kind, entryId: id });
  }
  return marks;
}

async function onWriteAsync({ model, operation, args, result }: WriteEvent): Promise<void> {
  if (model === undefined) return;
  const a = (args ?? {}) as { data?: unknown; create?: object; update?: object; where?: unknown };
  const written = operation === "upsert" ? { ...a.create, ...a.update } : a.data;
  if (model === "Lodging") {
    // A hotel geocoded after its stay was saved: the stay had no position before.
    if ((operation === "update" || operation === "upsert") && touches(written, ["lat", "lon"])) {
      for (const lodgingId of idsOf(result)) {
        const stays = await prisma.lodgingStay.findMany({
          where: { lodgingId },
          select: { id: true, userId: true },
        });
        await mark(stays.map((s) => ({ userId: s.userId, kind: "stay", entryId: s.id })));
      }
    }
    return;
  }
  const rule = RELEVANT[model];
  if (!rule) return;
  if (operation === "create" || operation === "createManyAndReturn") {
    await mark(await marksFor(rule.kind, idsOf(result), null));
  } else if (operation === "update" || operation === "upsert") {
    if (touches(written, rule.fields)) await mark(await marksFor(rule.kind, idsOf(result), null));
  } else if (operation === "updateMany") {
    const scope = scopeOf(a.where);
    if (touches(a.data, rule.fields) && scope) {
      await mark(await marksFor(rule.kind, scope.ids, scope.userId));
    }
  } else if (operation === "createMany") {
    const rows = (Array.isArray(a.data) ? a.data : [a.data]) as {
      id?: string;
      userId?: string;
      cruiseId?: string;
    }[];
    const marks: Mark[] = [];
    for (const row of rows) {
      if (model === "CruiseStop" && row?.cruiseId) {
        const cruise = await prisma.cruise.findUnique({
          where: { id: row.cruiseId },
          select: { userId: true },
        });
        if (cruise) marks.push({ userId: cruise.userId, kind: "cruiseStop", entryId: WILDCARD });
      } else if (row?.userId) {
        marks.push({ userId: row.userId, kind: rule.kind, entryId: row.id ?? WILDCARD });
      }
    }
    await mark(marks);
  }
}

/** Exported for the test that drives it without a database client. */
export function onWrite(event: WriteEvent): void {
  void onWriteAsync(event).catch((error) =>
    logger.error({ message: "entry_photo_mark_failed", context: { model: event.model }, error })
  );
}

/** Boot-time: every write now feeds the pass. Not installed under test unless a test asks. */
export function installEntryPhotoTriggers(): void {
  setWriteObserver(onWrite);
  // Marks left by a restart are consumed once the server is up.
  const boot = setTimeout(() => void drainAllDirty().catch(() => undefined), 30_000);
  boot.unref();
}

export function uninstallEntryPhotoTriggers(): void {
  setWriteObserver(null);
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
