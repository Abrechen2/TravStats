/**
 * Trips named by a source (Polarsteps): one trip per source trip, found again
 * by name + first/last day so a second read does not add it twice.
 *
 * Written with the pieces `POST /trips` is made of (`typedTripDays`,
 * `statusFromOwnDates`, `newTripColor`), not a second idea of what a trip row
 * holds. It runs BEFORE the visits are imported: a visit takes its trip from
 * the one trip whose days contain its own (`tripForVisitDay`), so the trip has
 * to exist when the visits are written. Two overlapping trips leave a visit
 * unlinked, by that rule — a choice for the user, not for a heuristic.
 */

import { prisma } from "../../db";
import { createTripSchema } from "../../schemas/trip";
import { typedTripDays } from "../timeModel/tripColumns";
import { statusFromOwnDates } from "../trips/ownDatesStatus";
import { newTripColor } from "../trip/newTripColor";
import type { RowOutcome } from "../xlsxImport/types";
import type { TripRecord } from "./types";

export async function importTrips(
  userId: string,
  records: TripRecord[],
  dryRun: boolean
): Promise<RowOutcome[]> {
  const out: RowOutcome[] = [];
  let created = 0;
  for (const rec of records) {
    const valid = createTripSchema.safeParse({
      name: rec.name,
      startDate: rec.startDay,
      endDate: rec.endDay,
    });
    if (!valid.success) {
      out.push({
        row: rec.row,
        action: "error",
        id: null,
        label: rec.label,
        message: "invalid_record",
      });
      continue;
    }
    const { startDate, endDate } = valid.data;
    const days = typedTripDays({ startDate, endDate });
    const existing = await prisma.trip.findFirst({
      where: {
        userId,
        name: { equals: rec.name, mode: "insensitive" },
        startDay: days.startDay ?? null,
        endDay: days.endDay ?? null,
      },
      select: { id: true },
    });
    if (existing) {
      out.push({
        row: rec.row,
        action: "skip",
        id: existing.id,
        label: rec.label,
        message: "exists",
      });
      continue;
    }
    let id: string | null = null;
    if (!dryRun) {
      const trip = await prisma.trip.create({
        data: {
          userId,
          name: rec.name,
          color: await newTripColor(userId, created),
          startDate,
          endDate,
          ...days,
          status: (await statusFromOwnDates(userId, startDate, endDate)) ?? undefined,
        },
        select: { id: true },
      });
      id = trip.id;
    }
    created += 1;
    out.push({ row: rec.row, action: "create", id, label: rec.label });
  }
  return out;
}
