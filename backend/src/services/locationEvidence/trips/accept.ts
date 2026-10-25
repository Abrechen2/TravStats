/**
 * Answering a trip question (TravTrack plan L4) through the one accept
 * protocol (`acceptFlow.ts`, via `suggestionStore.ts`) — this file is only the
 * trip kind: its re-check and the entry its answer makes.
 *
 * `{ action: "create", name }` makes a trip over the run's days, the way a
 * hand-made trip is born (typed days, the next colour, the status its own
 * dates give). `{ action: "extend", tripId }` widens that trip of the user's
 * to hold the run's days — its dates and nothing else; an end the run does not
 * move keeps its stored day and zone. Both are TravStats writes on the user's
 * decision (rule 6). The question names the trip (`accepted_entry_*`), and a
 * repeat answers it again without writing (the replay).
 *
 * Re-check: the run's away days still hold — `awayPeriods` over the span ± 2
 * days still finds a run holding at least `RECHECK_SHARE` of them. A read that
 * could not be completed, or an account that no longer has a confirmed
 * residence, is `unverifiable`: never accepted on a weaker rule, never
 * invalidated without proof.
 *
 * Rejecting ("Keine Reise" / "Nicht erweitern") is the store's plain reject:
 * nothing but the answer, allowed with TravTrack off; the run is not asked
 * again.
 */
import { prisma, type DbTransaction } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { z } from "../../../schemas/zod";
import { typedTripDays } from "../../timeModel/tripColumns";
import { fromDbDate } from "../../../shared/time/localDate";
import { newTripColor } from "../../trip/newTripColor";
import { statusFromOwnDates } from "../../trips/ownDatesStatus";
import { recomputeTripStatus } from "../../tripStatusService";
import { invalidateTripSuggestions } from "../../tripSuggestions/engine";
import type { AcceptHooks } from "../acceptFlow";
import {
  acceptSuggestion,
  resolved,
  type StoredSuggestion,
  type SuggestionKind,
} from "../suggestionStore";
import { awayPeriods, shiftDay } from "./awayPeriods";
import { parseTripEvidence, type TripEvidence } from "./evidence";

/** The run still holds when a run found now holds this share of its away days. */
export const RECHECK_SHARE = 0.8;

export const tripAcceptSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal("extend"), tripId: z.string().min(1).max(64) }).strict(),
]);
export type TripAnswer = z.infer<typeof tripAcceptSchema>;

const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

function tripOf(row: StoredSuggestion): TripEvidence {
  if (row.kind !== "trip") {
    throw new AppError("Not a trip question", 400, "VALIDATION_FAILED", "id");
  }
  const evidence = parseTripEvidence(row.evidence);
  // A row this build cannot read was written by a newer one: it is not ours to answer.
  if (!evidence) throw resolved();
  return evidence;
}

const tripNotFound = () =>
  new AppError("The trip is not this account's", 400, "VALIDATION_FAILED", "tripId");

/** The trip's span as stored: its local days, or its anchors' UTC days. */
const storedDay = (day: Date | null, anchor: Date | null) =>
  day ? fromDbDate(day) : anchor ? anchor.toISOString().slice(0, 10) : null;

async function widen(tx: DbTransaction, userId: string, tripId: string, run: TripEvidence) {
  const trip = await tx.trip.findFirst({
    where: { id: tripId, userId },
    select: { id: true, startDay: true, endDay: true, startDate: true, endDate: true },
  });
  if (!trip) throw tripNotFound();
  const from = storedDay(trip.startDay, trip.startDate);
  const to = storedDay(trip.endDay, trip.endDate);
  const startDate = !from || run.fromDay < from ? dayDate(run.fromDay) : undefined;
  const endDate = !to || run.toDay > to ? dayDate(run.toDay) : undefined;
  if (startDate || endDate) {
    await tx.trip.update({
      where: { id: trip.id },
      data: {
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        ...typedTripDays({ startDate, endDate }),
      },
    });
  }
  return trip.id;
}

async function create(tx: DbTransaction, userId: string, name: string, run: TripEvidence) {
  const startDate = dayDate(run.fromDay);
  const endDate = dayDate(run.toDay);
  const trip = await tx.trip.create({
    data: {
      userId,
      name,
      color: await newTripColor(userId, 0, tx),
      startDate,
      endDate,
      ...typedTripDays({ startDate, endDate }),
      status: (await statusFromOwnDates(userId, startDate, endDate)) ?? undefined,
    },
    select: { id: true },
  });
  return trip.id;
}

export function tripAcceptKind(answer: TripAnswer): SuggestionKind {
  return {
    async validate(row, db) {
      tripOf(row);
      if (answer.action !== "extend") return;
      const trip = await db.trip.findFirst({
        where: { id: answer.tripId, userId: row.userId },
        select: { id: true },
      });
      if (!trip) throw tripNotFound();
    },
    async recheck(row) {
      const run = tripOf(row);
      const read = await awayPeriods(row.userId, {
        fromDay: shiftDay(run.fromDay, -2),
        untilDay: shiftDay(run.toDay, 2),
      });
      if (read.status !== "ok" || read.coverage !== "complete") {
        // Its own generation when it read; otherwise the store's, captured before.
        return read.status === "ok"
          ? { outcome: "unverifiable", generation: read.generation }
          : "unverifiable";
      }
      const wanted = new Set(run.awayDays);
      const holds = read.runs.some(
        (now) => now.awayDays.filter((d) => wanted.has(d)).length >= RECHECK_SHARE * wanted.size
      );
      return { outcome: holds ? "holds" : "invalidated", generation: read.generation };
    },
    async apply(tx, row) {
      const run = tripOf(row);
      const tripId =
        answer.action === "create"
          ? await create(tx, row.userId, answer.name, run)
          : await widen(tx, row.userId, answer.tripId, run);
      return { status: "accepted", acceptedEntryKind: "trip", acceptedEntryId: tripId };
    },
  };
}

export async function acceptTripSuggestion(
  userId: string,
  id: string,
  answer: TripAnswer,
  hooks: AcceptHooks = {}
): Promise<StoredSuggestion> {
  const row = await acceptSuggestion(userId, id, tripAcceptKind(answer), hooks);
  // A trip was made or widened: the logbook's own trip suggestions are stale,
  // and a trip that holds entries converges its status from them.
  invalidateTripSuggestions(userId);
  if (row.acceptedEntryId) {
    const trip = await prisma.trip.findFirst({
      where: { id: row.acceptedEntryId, userId },
      select: { id: true },
    });
    if (trip) await recomputeTripStatus(trip.id);
  }
  return row;
}
