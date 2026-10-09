import { prisma } from "../../db";
import { propagateWrite, shareSnapshot } from "../sharing/propagate";
import { Prisma } from "../../prisma";
import type { CreateRentalInput, UpdateRentalInput } from "../../schemas/rental";
import { resolveCompanions, linkRowsFor } from "../companionService";
import { fxColumnsFor, getBaseCurrency } from "../fx/snapshot";
import { recomputeTripStatus } from "../tripStatusService";
import { resolveRentalStation } from "./rentalStations";
import {
  assertOdometerOrder,
  distanceColumns,
  mergeRental,
  type ResolvedStations,
} from "./rentalWrite";
import { rentalDayRange, soleOverlappingTrip } from "./rentalLinks";

/**
 * The one write path of a rental row — the form (`routes/rental.ts`) and the
 * mail import (`rentalImport.ts`) both go through here, so a row written from
 * a booking mail obeys every rule a typed one does: placed stations, the
 * station clocks, return after pickup, FX snapshots, companions.
 *
 * `manual` is the one difference. A person's write records the fields it set
 * in `userEditedFields`; an import's does not — that list is what keeps a
 * later mail from overwriting a hand-made correction (§4.4).
 */

export const RENTAL_INCLUDE = {
  trip: { select: { id: true, name: true, color: true } },
  route: { select: { id: true, name: true } },
  pickupAirport: { select: { iata: true } },
  returnAirport: { select: { iata: true } },
} satisfies Prisma.RentalBookingInclude;

export type RentalRow = Prisma.RentalBookingGetPayload<{ include: typeof RENTAL_INCLUDE }>;
type StoredRental = Prisma.RentalBookingGetPayload<object>;

export interface WriteOptions {
  manual: boolean;
  /** The import key; only a create from a mail sets it. */
  externalRef?: string | null;
  /** The send time of the mail a create came from (`lastMailSentAt`). */
  mailSentAt?: Date | null;
}

/** Everything but the derived columns, companions and FX, which this file owns. */
function plainColumns(input: UpdateRentalInput) {
  const {
    pickupStation: _p,
    returnStation: _r,
    pickupLocal: _pl,
    returnLocal: _rl,
    pickupFold: _pf,
    returnFold: _rf,
    actualPickupLocal: _ap,
    actualReturnLocal: _ar,
    distanceKm: _d,
    status: _s,
    companions: _c,
    ...rest
  } = input;
  return rest;
}

export async function resolveStations(input: UpdateRentalInput): Promise<ResolvedStations> {
  return {
    ...(input.pickupStation && {
      pickup: await resolveRentalStation(input.pickupStation, "pickupStation"),
    }),
    ...(input.returnStation !== undefined && {
      return:
        input.returnStation === null
          ? null
          : await resolveRentalStation(input.returnStation, "returnStation"),
    }),
  };
}

/** The fields a person set by hand, added to the ones already recorded. */
function editedFields(input: UpdateRentalInput, existing: string[] = []): string[] {
  return [...new Set([...existing, ...Object.keys(input).filter((k) => !/Fold$/.test(k))])].sort();
}

/**
 * The invoice amount's own FX snapshot, dated by the return (the day it was
 * charged) — the price's columns stay the booking's.
 */
export async function finalFxColumns(
  userId: string,
  amount: number | null,
  currency: string | null,
  date: Date
): Promise<Prisma.RentalBookingUncheckedUpdateInput> {
  const fx = await fxColumnsFor({ amount, currency, date }, await getBaseCurrency(userId));
  return {
    finalAmountBase: fx.priceBase,
    finalFxRate: fx.fxRate,
    finalFxRateDate: fx.fxRateDate,
    finalFxBaseCurrency: fx.fxBaseCurrency,
    finalFxSource: fx.fxSource,
  };
}

export async function restatusTrips(...tripIds: Array<string | null | undefined>): Promise<void> {
  for (const id of new Set(tripIds.filter((t): t is string => Boolean(t)))) {
    await recomputeTripStatus(id);
  }
}

export async function createRentalRow(
  userId: string,
  input: CreateRentalInput,
  options: WriteOptions
): Promise<RentalRow> {
  const state = mergeRental(null, input, await resolveStations(input));
  assertOdometerOrder(null, input);
  // Linked by itself only when EXACTLY one trip overlaps; a trip the client
  // named (or an explicit null) is never second-guessed.
  const tripId =
    input.tripId !== undefined
      ? input.tripId
      : await soleOverlappingTrip(userId, rentalDayRange(state));
  const companions = await resolveCompanions(userId, input.companions ?? []);
  const finalFx =
    input.finalAmount != null
      ? await finalFxColumns(
          userId,
          input.finalAmount,
          input.finalCurrency ?? null,
          state.returnTime
        )
      : {};
  const fxColumns = await fxColumnsFor(
    { amount: input.price ?? null, currency: input.currency ?? null, date: state.pickupTime },
    await getBaseCurrency(userId)
  );

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.rentalBooking.create({
      data: {
        ...plainColumns(input),
        ...state,
        ...distanceColumns(input),
        ...(input.finalAmount != null && { finalAmountSource: "user" }),
        ...(finalFx as Prisma.RentalBookingUncheckedCreateInput),
        ...fxColumns,
        userId,
        tripId,
        externalRef: options.externalRef ?? null,
        lastMailSentAt: options.mailSentAt ?? null,
        companions: companions.map((c) => c.displayName),
        userEditedFields: options.manual ? editedFields(input) : [],
      },
    });
    if (companions.length > 0) {
      await tx.rentalBookingCompanion.createMany({
        data: linkRowsFor(companions.map((c) => c.id)).map((link) => ({
          ...link,
          rentalBookingId: created.id,
        })),
        skipDuplicates: true,
      });
    }
    await propagateWrite(tx, userId, "rental", created.id);
    return tx.rentalBooking.findUniqueOrThrow({
      where: { id: created.id },
      include: RENTAL_INCLUDE,
    });
  });
  await restatusTrips(row.tripId);
  return row;
}

export async function updateRentalRow(
  userId: string,
  existing: StoredRental,
  input: UpdateRentalInput,
  options: WriteOptions & { extra?: Prisma.RentalBookingUncheckedUpdateInput }
): Promise<RentalRow> {
  // The MERGED state, so a one-field PATCH is checked against the stored rest
  // (a return moved before an untouched pickup is refused here).
  const state = mergeRental(existing, input, await resolveStations(input));
  assertOdometerOrder(existing, input);
  const resolved =
    input.companions === undefined ? undefined : await resolveCompanions(userId, input.companions);
  // Re-snapshotted only when an input it depends on moved (silent-failure
  // class 4: a re-derivation never runs for nothing and never downgrades).
  const fxInputsChanged =
    input.price !== undefined ||
    input.currency !== undefined ||
    state.pickupTime.getTime() !== existing.pickupTime.getTime();
  const fxColumns = fxInputsChanged
    ? await fxColumnsFor(
        {
          amount: input.price !== undefined ? input.price : existing.price,
          currency: input.currency !== undefined ? input.currency : existing.currency,
          date: state.pickupTime,
        },
        await getBaseCurrency(userId)
      )
    : undefined;
  const finalChanged =
    input.finalAmount !== undefined ||
    input.finalCurrency !== undefined ||
    state.returnTime.getTime() !== existing.returnTime.getTime();
  const finalFx = finalChanged
    ? await finalFxColumns(
        userId,
        input.finalAmount !== undefined ? input.finalAmount : existing.finalAmount,
        input.finalCurrency !== undefined ? input.finalCurrency : existing.finalCurrency,
        state.returnTime
      )
    : {};

  const row = await prisma.$transaction(async (tx) => {
    const before = await shareSnapshot(tx, "rental", existing.id);
    if (resolved !== undefined) {
      await tx.rentalBookingCompanion.deleteMany({ where: { rentalBookingId: existing.id } });
      if (resolved.length > 0) {
        await tx.rentalBookingCompanion.createMany({
          data: linkRowsFor(resolved.map((c) => c.id)).map((link) => ({
            ...link,
            rentalBookingId: existing.id,
          })),
          skipDuplicates: true,
        });
      }
    }
    await tx.rentalBooking.update({
      where: { id: existing.id },
      data: {
        ...plainColumns(input),
        ...state,
        ...distanceColumns(input),
        ...(input.finalAmount !== undefined && {
          finalAmountSource: input.finalAmount === null ? null : "user",
        }),
        ...finalFx,
        ...fxColumns,
        ...(resolved !== undefined && { companions: resolved.map((c) => c.displayName) }),
        ...(options.manual && { userEditedFields: editedFields(input, existing.userEditedFields) }),
        ...options.extra,
      },
    });
    await propagateWrite(tx, userId, "rental", existing.id, before);
    return tx.rentalBooking.findUniqueOrThrow({
      where: { id: existing.id },
      include: RENTAL_INCLUDE,
    });
  });
  await restatusTrips(existing.tripId, row.tripId);
  return row;
}
