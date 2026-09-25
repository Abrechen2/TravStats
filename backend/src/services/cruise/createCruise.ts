/**
 * Creating a cruise — one implementation for the form and the spreadsheet.
 *
 * Moved out of `routes/cruises.ts` so a cruise created from an imported sheet
 * goes through the same derivations as one typed into the form: status from
 * the dates, companions resolved to entities (dual-written into the legacy
 * array), an FX snapshot on the start day, stops written under the 3-state
 * invariant, legs recomputed, and the trip's own status re-derived.
 *
 * The caller has validated `data` through `createCruiseSchema` and checked the
 * trip/booking references it carries are the user's own (AUD-038). Import
 * provenance (batch id, external ref) is decided by the caller, because that
 * is a property of the request, not of the cruise.
 */

import { prisma } from "../../db";
import type { createCruiseSchema } from "../../schemas/cruise";
import type { z } from "zod";
import { CRUISE_INCLUDE } from "../../routes/cruises/include";
import { recomputeLegsForCruise } from "../cruiseDistance/cruiseLegService";
import { deriveCruiseStatus, CRUISE_PASSTHROUGH } from "../../shared/statusDerivation";
import { recomputeTripStatus } from "../tripStatusService";
import { resolveCompanions, linkRowsFor } from "../companionService";
import { fxColumnsFor, getBaseCurrency } from "../fx/snapshot";

export type CreateCruiseData = Omit<z.infer<typeof createCruiseSchema>, "importBatchId">;

export interface CruiseProvenance {
  importBatchId?: string | null;
  externalRef?: string | null;
  dataSource?: string;
}

export async function createCruiseRecord(
  userId: string,
  data: CreateCruiseData,
  provenance: CruiseProvenance = {}
) {
  const { stops, startDate, endDate, tripId, bookingId, status, companions, ...rest } = data;

  const startDateUtc = startDate ? new Date(startDate) : null;
  const endDateUtc = endDate ? new Date(endDate) : null;

  // The status field is a client-sent HINT, not the source of truth (spec
  // 2026-07-17-status-from-dates) — passthrough statuses (cancelled,
  // historical) are assigned verbatim, everything else (including the
  // schema's 'scheduled' default) is derived from the dates being written.
  const effectiveStatus = (CRUISE_PASSTHROUGH as readonly string[]).includes(status)
    ? status
    : deriveCruiseStatus({ startDate: startDateUtc, endDate: endDateUtc, current: status });

  // Resolve companion names to Companion entities up front (find-or-create
  // is idempotent via companionService, so it's safe to run outside the
  // transaction below — it cannot participate in a passed `tx` anyway). The
  // cruise row and its links are written together inside the transaction so
  // a failure never leaves the legacy `companions` array and the
  // `companionLinks` table disagreeing. Mirrors routes/trips.ts.
  const resolvedCompanions = await resolveCompanions(userId, companions ?? []);

  // FX snapshot (#267), same rule as `Flight`/`Booking` — the ONLY priced
  // model that lacked one, which is what let a large-face-value-but-small
  // currency (e.g. KRW) beat a euro trip on the trips page (compared by raw
  // number, never converted). Rated on the START day; a cruise with no
  // price, no currency or no start date gets the all-null columns instead
  // of a guessed rate.
  const fxColumns = await fxColumnsFor(
    { amount: rest.price, currency: rest.currency, date: startDateUtc },
    await getBaseCurrency(userId)
  );

  const cruise = await prisma.$transaction(async (tx) => {
    const created = await tx.cruise.create({
      data: {
        userId,
        ...rest,
        ...fxColumns,
        importBatchId: provenance.importBatchId ?? null,
        externalRef: provenance.externalRef ?? null,
        ...(provenance.dataSource ? { dataSource: provenance.dataSource } : {}),
        status: effectiveStatus,
        startDate: startDateUtc,
        endDate: endDateUtc,
        tripId: tripId ?? null,
        bookingId: bookingId ?? null,
        // Dual write: resolved display names keep this legacy array in
        // agreement with `companionLinks` below (trimmed, blanks dropped,
        // newest spelling wins) — the previous image still reads this column.
        companions: resolvedCompanions.map((c) => c.displayName),
      },
    });

    if (resolvedCompanions.length > 0) {
      await tx.cruiseCompanion.createMany({
        data: linkRowsFor(resolvedCompanions.map((c) => c.id)).map((row) => ({
          ...row,
          cruiseId: created.id,
        })),
        skipDuplicates: true,
      });
    }

    if (stops && stops.length > 0) {
      await tx.cruiseStop.createMany({
        data: stops.map((s) => ({
          cruiseId: created.id,
          portId: s.portId ?? null,
          dayNumber: s.dayNumber,
          date: s.date ? new Date(s.date) : null,
          isAtSea: s.isAtSea,
          arrivalTime: s.arrivalTime ? new Date(s.arrivalTime) : null,
          departureTime: s.departureTime ? new Date(s.departureTime) : null,
          excursionNote: s.excursionNote ?? null,
          unresolvedPortName: s.unresolvedPortName ?? null,
        })),
      });
    }

    await recomputeLegsForCruise(created.id, tx);
    return tx.cruise.findUniqueOrThrow({ where: { id: created.id }, include: CRUISE_INCLUDE });
  });

  // Status derivation (spec 2026-07-17-status-from-dates) needs to read
  // the cruise it just linked, so recomputeTripStatus() runs AFTER the
  // transaction commits — same after-commit idiom as flightsBatch.ts.
  if (cruise.tripId) {
    await recomputeTripStatus(cruise.tripId);
  }
  return cruise;
}
