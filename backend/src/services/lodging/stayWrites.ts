/**
 * Writing a stay — the one implementation behind every path that does it.
 *
 * Moved out of `routes/lodging/stays.ts` so the form (POST/PATCH) and the
 * spreadsheet import write a stay through the SAME derivations: status from
 * the dates, overall rating from its components, total price from the
 * per-night rate, and an FX snapshot. A second, importer-only copy of this is
 * exactly how a stay created from a sheet would end up with a status its dates
 * contradict or a price with no base-currency value.
 *
 * Callers check that the lodging (and, for an update, the stay) belongs to the
 * user BEFORE calling in; the references a stay carries (trip, booking,
 * membership) are checked here, because every caller needs that check and
 * forgetting it is the AUD-038 hole.
 */

import { propagateWrite, shareSnapshot, SHARE_TX_TIMEOUT_MS } from "../sharing/propagate";
import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { Prisma } from "../../prisma";
import type { createStaySchema, updateStaySchema } from "../../schemas/lodging";
import type { z } from "zod";
import { deriveLodgingStatus } from "../../shared/statusDerivation";
import { deriveStayOverallRating } from "../../shared/ratingDerivation";
import { deriveStayTotalPrice } from "../../shared/stayPricing";
import logger from "../../utils/logger";
import { assertReferencesOwned } from "../../utils/ownedReferences";
import { resolveEffectiveStayDates } from "./stayPatchMerge";
import { legacyDay, stayTimeColumns, zoneOfLodging } from "../timeModel/stayColumns";
import type { LocalTimeOrigin } from "../../shared/time/instant";
import { dayAnchorNowFor } from "../../shared/time/profileZone";
import { getBaseCurrency } from "../fx/snapshot";
import { resolveDeadlineColumns } from "../deadlines/bookingDeadlines";
import {
  applyFxSnapshot,
  applyManualRate,
  resolveFxFields,
  type FxSnapshotFields,
} from "../fx/stayFx";

export type CreateStayData = z.infer<typeof createStaySchema>;
export type UpdateStayData = z.infer<typeof updateStaySchema>;
type StoredStay = Prisma.LodgingStayGetPayload<Record<string, never>>;

/** Extra columns a caller may stamp on a new stay — provenance, never user input. */
export interface StayProvenance {
  dataSource?: string;
  /**
   * Who produced the check-in/-out times: a person in the editor ("typed", a
   * time the hotel's clock skipped is refused) or an import ("machine").
   */
  origin?: LocalTimeOrigin;
  /** The write came with a personal access token (the Companion) — see `resolveInput.ts`. */
  viaToken?: boolean;
}

export async function createStayRecord(
  userId: string,
  lodgingId: string,
  data: CreateStayData,
  provenance: StayProvenance = {},
  /** Runs in the creating transaction: the route's client-ref claim and receipts (forgejo#283). */
  inTx?: (tx: DbTransaction, stayId: string) => Promise<void>
): Promise<StoredStay> {
  // Prisma only enforces that the trip, booking and membership EXIST — not
  // whose they are. Without this, a stay could be filed under a stranger's
  // trip and would then show up on their timeline (AUD-038).
  await assertReferencesOwned(userId, data);
  const columns = await buildStayCreateData(
    userId,
    await zoneOfLodging(lodgingId),
    data,
    provenance
  );
  // One transaction: on a shared trip the copies are created with the stay or
  // not at all (design 2026-10-09, D8 of 2026-10-16).
  return prisma.$transaction(
    async (tx) => {
      const created = await tx.lodgingStay.create({ data: { ...columns, lodgingId, userId } });
      await propagateWrite(tx, userId, "lodgingStay", created.id);
      await inTx?.(tx, created.id);
      return created;
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}

/** A new stay's columns, without its lodging and owner. */
export type StayCreateColumns = Omit<
  Prisma.LodgingStayUncheckedCreateInput,
  "lodgingId" | "userId"
>;

/**
 * Every derivation a new stay goes through, as columns — split from
 * `createStayRecord` so a caller that writes inside its own transaction (the
 * package-tour commit, whose lodging may not exist before it) gets the same
 * row. Reads no reference: the caller has checked the trip/booking ids are the
 * user's own, and supplies the lodging's zone (null for a lodging without a
 * place yet).
 */
export async function buildStayCreateData(
  userId: string,
  lodgingZone: string | null,
  data: CreateStayData,
  provenance: StayProvenance = {}
): Promise<StayCreateColumns> {
  // totalPrice is the source of truth: the UI types it, but an importer or
  // API client may send only a per-night price — derive the total so it is
  // always stored, and the FX snapshot below converts the right amount.
  // `manualFxRate` is a request field, not a stay column — it must not reach
  // the spread below, where Prisma would reject it as an unknown argument.
  // The deadlines (forgejo#285) are resolved on the hotel's clock, not spread.
  const { manualFxRate, freeCancellationUntil, paymentDueOn, ...body } = data;
  const input = { ...body, totalPrice: deriveStayTotalPrice(body) };
  const deadlineColumns = await resolveDeadlineColumns(
    { freeCancellationUntil, paymentDueOn },
    { userId, placeZone: () => lodgingZone, viaToken: provenance.viaToken ?? false }
  );
  const timeColumns = stayTimeColumns(
    {
      checkIn: legacyDay(input.checkIn),
      checkOut: legacyDay(input.checkOut),
      checkInTime: input.checkInTime ?? null,
      checkOutTime: input.checkOutTime ?? null,
    },
    lodgingZone,
    provenance.origin
  );

  const baseCurrency = await getBaseCurrency(userId);
  const fxOutcome = await applyFxSnapshot(input, baseCurrency);
  if (fxOutcome.status === "lookupFailed") {
    logger.warn({ operation: "lodging_fx_lookup_failed", userId });
  }
  const fxFields =
    manualFxRate != null
      ? applyManualRate(
          fxOutcome,
          manualFxRate,
          input.totalPrice,
          // A manual rate still needs a day to be stamped with. An undated
          // stay cannot have one, and applyFxSnapshot has already refused
          // the conversion above — this argument is then never read.
          input.checkIn ?? new Date(),
          baseCurrency
        )
      : resolveFxFields(fxOutcome);

  return {
    ...input,
    ...fxFields,
    ...timeColumns,
    ...deadlineColumns,
    // Status follows the dates (see deriveLodgingStatus). Whatever the
    // client sent is only consulted for the one value derivation honours,
    // "cancelled" — so an old client, an importer or a stale form can no
    // longer store a status the dates contradict.
    // With no dates there is nothing to derive from and the deriver
    // returns `current` — which is correct: an undated stay is recorded
    // after the fact, so what the client says is a statement, not a cache.
    status: deriveLodgingStatus({
      checkIn: input.checkIn ? new Date(input.checkIn) : null,
      checkOut: input.checkOut ? new Date(input.checkOut) : null,
      current: input.status,
      now: await dayAnchorNowFor(userId),
    }),
    // Likewise derived, not accepted: the overall score follows the three
    // components wherever a stay is written — form, CSV, e-mail/PDF — so
    // an importer cannot leave it null and a client cannot store one that
    // contradicts them. `current` only carries a source-supplied overall
    // through for a stay that has no component rating at all.
    ratingOverall: deriveStayOverallRating({
      room: input.ratingRoom ?? null,
      breakfast: input.ratingBreakfast ?? null,
      service: input.ratingService ?? null,
      current: input.ratingOverall ?? null,
    }),
    ...(provenance.dataSource ? { dataSource: provenance.dataSource } : {}),
  };
}

/**
 * Lay an update over a stored stay. `stay` must already be the caller's —
 * it is read by the caller, scoped by user, before this runs.
 *
 * Throws `AppError(400)` for a time the merged stay cannot carry.
 */
export async function updateStayRecord(
  userId: string,
  stay: StoredStay,
  data: UpdateStayData,
  origin: LocalTimeOrigin = "typed",
  viaToken = false
): Promise<StoredStay> {
  // Re-linking is a write too — see the create path (AUD-038).
  await assertReferencesOwned(userId, data);
  // Same reason as the create path: these are not stay columns as sent.
  const { manualFxRate, freeCancellationUntil, paymentDueOn, ...input } = data;

  // The whole merge rule, and the trap in it, live in `stayPatchMerge`.
  const effective = resolveEffectiveStayDates(input, stay);
  const effectiveCheckIn = effective.checkIn;
  const effectiveCheckOut = effective.checkOut;

  // Times are claims about a DAY-precise date (see schemas/lodging.ts).
  // The schema can only check the body; here the MERGED stay is checked:
  // an explicit time the merged stay cannot carry is a contradiction and
  // refused, while a STORED time whose date/precision is being edited away
  // is cleared alongside — the row must never carry a time without its day.
  const effectiveDatePrecision = effective.datePrecision;
  // Feeds the price derivation below: a stay whose length is stated rather
  // than measured still has one (AUD-040).
  const effectiveNights = effective.nights;
  const supportsTime = (date: Date | null): boolean =>
    date !== null && effectiveDatePrecision === "DAY";
  if (input.checkInTime != null && !supportsTime(effectiveCheckIn)) {
    throw new AppError("checkInTime requires a DAY-precision check-in date", 400);
  }
  if (input.checkOutTime != null && !supportsTime(effectiveCheckOut)) {
    throw new AppError("checkOutTime requires a DAY-precision check-out date", 400);
  }
  const timeClears = {
    ...(input.checkInTime === undefined &&
    stay.checkInTime !== null &&
    !supportsTime(effectiveCheckIn)
      ? { checkInTime: null }
      : {}),
    ...(input.checkOutTime === undefined &&
    stay.checkOutTime !== null &&
    !supportsTime(effectiveCheckOut)
      ? { checkOutTime: null }
      : {}),
  };

  // Only re-run the FX snapshot when a field that feeds the conversion
  // ACTUALLY CHANGED VALUE — an unrelated edit (e.g. notes) must not touch
  // a previously-good snapshot, and must never fail the request either way.
  //
  // This MUST be a value comparison, not a key-presence check ("totalPrice"
  // in input): the real StayEditor UI always sends checkIn/checkOut/
  // status/currency/board/isAwardStay unconditionally, re-sending the
  // stay's EXISTING totalPrice/currency/checkIn on every edit (e.g. a
  // notes-only edit). A key-presence check would treat every such edit as
  // "FX inputs changed" and — if the ECB lookup happens to be down at that
  // moment — silently clear a perfectly good historical snapshot (finding
  // 1, CRITICAL). Comparing against the CURRENT stored values means a
  // resend of the same value is correctly seen as "nothing changed".
  // totalPrice is authoritative, and what the client EXPLICITLY sends drives
  // the result — a stored total must not override a field the user just
  // changed:
  //   - an explicit totalPrice (incl. null = clear) wins outright;
  //   - else an explicit pricePerNight re-derives total = per-night × nights;
  //   - else nothing pricing-relevant was sent, so the stored total stands.
  // `undefined` means "not sent"; an explicit `null` is a clear and survives.
  let effectiveTotalPrice: number | null;
  if (input.totalPrice !== undefined) {
    effectiveTotalPrice = input.totalPrice;
  } else if (input.pricePerNight !== undefined) {
    effectiveTotalPrice = deriveStayTotalPrice({
      totalPrice: null,
      pricePerNight: input.pricePerNight,
      checkIn: effectiveCheckIn,
      checkOut: effectiveCheckOut,
      datePrecision: effectiveDatePrecision,
      nights: effectiveNights,
    });
  } else {
    // Dates alone can change what a per-night-priced stay costs, but only when
    // the total was itself derived from per-night (no explicit total on file).
    effectiveTotalPrice =
      stay.totalPrice ??
      deriveStayTotalPrice({
        totalPrice: null,
        pricePerNight: stay.pricePerNight,
        checkIn: effectiveCheckIn,
        checkOut: effectiveCheckOut,
        datePrecision: effectiveDatePrecision,
        nights: effectiveNights,
      });
  }

  // A manual rate sent on its own changes NOTHING about price, currency or
  // date — it is the ordinary way a user fills the gap after saving a stay
  // they were told had no rate. Without this the recompute below would skip,
  // and the rate they just typed would be dropped without a word.
  const fxInputsChanged =
    manualFxRate !== undefined ||
    effectiveTotalPrice !== stay.totalPrice ||
    (input.currency !== undefined && input.currency !== stay.currency) ||
    (input.checkIn !== undefined &&
      (input.checkIn === null
        ? stay.checkIn !== null
        : new Date(input.checkIn).getTime() !== (stay.checkIn?.getTime() ?? NaN)));
  let fxFields: Partial<FxSnapshotFields> = {};
  if (fxInputsChanged) {
    const baseCurrency = await getBaseCurrency(userId);
    const fxOutcome = await applyFxSnapshot(
      {
        totalPrice: effectiveTotalPrice,
        currency: input.currency ?? stay.currency,
        checkIn: effectiveCheckIn,
      },
      baseCurrency
    );
    if (fxOutcome.status === "lookupFailed") {
      logger.warn({ operation: "lodging_fx_lookup_failed", stayId: stay.id, userId });
    }
    // An explicit null is the user TAKING THE RATE BACK: fall through to the
    // automatic answer, which for a gap currency is "no rate" — the honest
    // state, not the old estimate left standing.
    fxFields =
      manualFxRate != null
        ? applyManualRate(
            fxOutcome,
            manualFxRate,
            effectiveTotalPrice,
            effectiveCheckIn ?? new Date(),
            baseCurrency
          )
        : resolveFxFields(fxOutcome);
  }

  // Same merge rule as the dates above, and the same explicit-null trap as
  // the FX block: `undefined` means "not sent" and falls back to the stored
  // value, while an explicit `null` is the user CLEARING that rating and
  // must survive into the derivation. `??` would collapse the two and make
  // a cleared component silently keep its old score.
  const effectiveRating = (
    sent: number | null | undefined,
    stored: number | null
  ): number | null => (sent !== undefined ? sent : stored);

  // The new time columns follow the MERGED stay — dates, times and the
  // clears above — so a PATCH of one field re-derives from what is stored.
  const effectiveTime = (key: "checkInTime" | "checkOutTime"): string | null => {
    if (input[key] !== undefined) return input[key] ?? null;
    if (key in timeClears) return null;
    return stay[key];
  };
  const lodgingZone = await zoneOfLodging(stay.lodgingId);
  const timeColumns = stayTimeColumns(
    {
      checkIn: effectiveCheckIn,
      checkOut: effectiveCheckOut,
      checkInTime: effectiveTime("checkInTime"),
      checkOutTime: effectiveTime("checkOutTime"),
    },
    lodgingZone,
    origin
  );
  // Only the deadlines sent: absent leaves them, null clears (forgejo#285).
  const deadlineColumns = await resolveDeadlineColumns(
    { freeCancellationUntil, paymentDueOn },
    { userId, placeZone: () => lodgingZone, viaToken }
  );

  // Awaited above the transaction: it holds no network or settings read.
  const statusNow = await dayAnchorNowFor(userId);
  // One transaction: a shared stay's copies follow the edit or it does not happen.
  return prisma.$transaction(
    async (tx) => {
      const before = await shareSnapshot(tx, "lodgingStay", stay.id);
      const updated = await tx.lodgingStay.update({
        where: { id: stay.id },
        data: {
          ...input,
          ...timeClears,
          ...timeColumns,
          ...deadlineColumns,
          // totalPrice is authoritative and derived above from the merged view,
          // so it overrides whatever `...input` carried (which may be a stale
          // re-send or absent while only the per-night price changed).
          totalPrice: effectiveTotalPrice,
          ...fxFields,
          // Derived from the EFFECTIVE (merged) dates, not from `input`, so a
          // PATCH that moves only one date still re-derives against the range
          // that will actually be stored. `current` is likewise the effective
          // status — a body omitting `status` must not lose an existing
          // cancellation, which is the one value derivation passes through.
          status: deriveLodgingStatus({
            checkIn: effectiveCheckIn,
            checkOut: effectiveCheckOut,
            current: input.status ?? stay.status,
            now: statusNow,
          }),
          // Derived from the EFFECTIVE (merged) ratings for the same reason: a
          // PATCH sending one component must score the row that will actually
          // be stored, not the partial body.
          ratingOverall: deriveStayOverallRating({
            room: effectiveRating(input.ratingRoom, stay.ratingRoom),
            breakfast: effectiveRating(input.ratingBreakfast, stay.ratingBreakfast),
            service: effectiveRating(input.ratingService, stay.ratingService),
            current: effectiveRating(input.ratingOverall, stay.ratingOverall),
          }),
        },
      });
      await propagateWrite(tx, userId, "lodgingStay", stay.id, before);
      return updated;
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}
