import { prisma, setWriteObserver, type WriteEvent } from "../../db";
import logger from "../../utils/logger";
import { startJob } from "../jobs/jobRegistry";
import { autoLinkEnabled, recordRun } from "../places/visitPhotoAutoLink";
import type { EntryKind } from "./entryKinds";
import { runEntries, type EntryRef } from "./entryPhotos";

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
 * The pass runs a few seconds later, once per entry however many writes touched
 * it: an enclosing transaction has committed by then, and an import of a hundred
 * rows is a hundred passes through one memoised search, not a hundred bursts.
 *
 * Not covered, on purpose: `updateMany`/`deleteMany` (no ids in the result; the
 * writes that way — status sweeps, trip moves, share keys — do not change time or
 * place) and a place's catalogue coordinates (a port moved in the catalogue).
 * Those entries are picked up by the pass over everything.
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

type Pending =
  | { kind: EntryKind; id: string }
  | { kind: EntryKind; userId: string; since: number }
  | { cruiseId: string }
  | { lodgingId: string };

export const TRIGGER_DELAY_MS = 4_000;
const timers = new Map<string, NodeJS.Timeout>();
let delayMs = TRIGGER_DELAY_MS;

/** Tests shorten the wait; production keeps the default. */
export function setTriggerDelay(ms: number): void {
  delayMs = ms;
}

function defer(key: string, work: Pending, attempt = 0): void {
  const held = timers.get(key);
  if (held) clearTimeout(held);
  const timer = setTimeout(() => {
    timers.delete(key);
    void resolveAndRun(work, attempt).catch((error) =>
      logger.error({ message: "entry_photo_trigger_failed", context: { key }, error })
    );
  }, delayMs);
  timer.unref();
  timers.set(key, timer);
}

/** Who owns the entry, and which entries a pending item stands for. */
async function resolve(work: Pending): Promise<{ userId: string; refs: EntryRef[] } | null> {
  if ("id" in work) {
    const userId = await ownerOf(work.kind, work.id);
    return userId ? { userId, refs: [{ kind: work.kind, id: work.id }] } : null;
  }
  if ("cruiseId" in work) {
    const cruise = await prisma.cruise.findUnique({
      where: { id: work.cruiseId },
      select: { userId: true, stops: { select: { id: true } } },
    });
    return cruise
      ? { userId: cruise.userId, refs: cruise.stops.map((s) => ({ kind: "cruiseStop", id: s.id })) }
      : null;
  }
  if ("lodgingId" in work) {
    const lodging = await prisma.lodging.findUnique({
      where: { id: work.lodgingId },
      select: { userId: true, stays: { select: { id: true } } },
    });
    return lodging
      ? { userId: lodging.userId, refs: lodging.stays.map((s) => ({ kind: "stay", id: s.id })) }
      : null;
  }
  const rows = await recentIds(work.kind, work.userId, new Date(work.since));
  return { userId: work.userId, refs: rows.map((id) => ({ kind: work.kind, id })) };
}

async function recentIds(kind: EntryKind, userId: string, since: Date): Promise<string[]> {
  const where = { userId, createdAt: { gte: since } };
  const pick = { select: { id: true } } as const;
  const rows =
    kind === "flight"
      ? await prisma.flight.findMany({ where, ...pick })
      : kind === "stay"
        ? await prisma.lodgingStay.findMany({ where, ...pick })
        : kind === "rail"
          ? await prisma.railJourney.findMany({ where, ...pick })
          : kind === "bus"
            ? await prisma.busJourney.findMany({ where, ...pick })
            : kind === "ferry"
              ? await prisma.ferryJourney.findMany({ where, ...pick })
              : kind === "rental"
                ? await prisma.rentalBooking.findMany({ where, ...pick })
                : [];
  return rows.map((r) => r.id);
}

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

/** A transaction that outlasts the delay has not committed yet: look again a few times. */
const MAX_ATTEMPTS = 3;

async function resolveAndRun(work: Pending, attempt: number): Promise<void> {
  const target = await resolve(work);
  if (!target || target.refs.length === 0) {
    if (attempt + 1 < MAX_ATTEMPTS) defer(JSON.stringify(work), work, attempt + 1);
    return;
  }
  if (!(await autoLinkEnabled(target.userId))) return;
  startJob("placeVisitPhotos.autoLink", target.userId, async () => {
    const run = await runEntries(target.userId, target.refs);
    await recordRun(target.userId, run);
    return run;
  });
}

function idsOf(result: unknown): string[] {
  const rows = Array.isArray(result) ? result : [result];
  return rows.flatMap((r) =>
    typeof r === "object" && r !== null && typeof (r as { id?: unknown }).id === "string"
      ? [(r as { id: string }).id]
      : []
  );
}

/** Exported for the test that drives it without a database client. */
export function onWrite({ model, operation, args, result }: WriteEvent): void {
  if (model === undefined) return;
  const a = (args ?? {}) as { data?: unknown };
  if (model === "Lodging") {
    // A hotel geocoded after its stay was saved: the stay had no position before.
    if ((operation === "update" || operation === "upsert") && touches(a.data, ["lat", "lon"])) {
      for (const id of idsOf(result)) defer(`lodging:${id}`, { lodgingId: id });
    }
    return;
  }
  const rule = RELEVANT[model];
  if (!rule) return;
  if (operation === "create" || operation === "createManyAndReturn") {
    for (const id of idsOf(result)) defer(`${rule.kind}:${id}`, { kind: rule.kind, id });
  } else if (operation === "update" || operation === "upsert") {
    const data =
      operation === "upsert"
        ? { ...(a as { create?: object }).create, ...(a as { update?: object }).update }
        : a.data;
    if (touches(data, rule.fields)) {
      for (const id of idsOf(result)) defer(`${rule.kind}:${id}`, { kind: rule.kind, id });
    }
  } else if (operation === "createMany") {
    const rows = Array.isArray(a.data) ? a.data : [a.data];
    for (const row of rows as { userId?: string; cruiseId?: string }[]) {
      if (model === "CruiseStop" && row?.cruiseId) {
        defer(`cruise:${row.cruiseId}`, { cruiseId: row.cruiseId });
      } else if (row?.userId) {
        defer(`since:${rule.kind}:${row.userId}`, {
          kind: rule.kind,
          userId: row.userId,
          since: Date.now() - 60_000,
        });
      }
    }
  }
}

/** Boot-time: every write now feeds the pass. Not installed under test unless a test asks. */
export function installEntryPhotoTriggers(): void {
  setWriteObserver(onWrite);
}

export function uninstallEntryPhotoTriggers(): void {
  setWriteObserver(null);
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
