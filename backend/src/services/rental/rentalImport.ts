import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import type { CreateRentalInput, UpdateRentalInput } from "../../schemas/rental";
import type { RentalInvoiceInput } from "../../schemas/rentalImport";
import { toLocal } from "../../shared/time/instant";
import { rentalExternalRef } from "./parser/rentalCandidates";
import {
  RENTAL_INCLUDE,
  createRentalRow,
  finalFxColumns,
  updateRentalRow,
  type RentalRow,
} from "./rentalRowWrite";

/**
 * Applying one reviewed rental document (spec 2026-10-01-rental-domain-design
 * §4.4, §4.5). Three rules, each a silent-failure guard:
 *
 * 1. Identity is provider + booking number. A known number UPDATES; only a
 *    confirmation with an unknown number creates.
 * 2. A cancellation or an invoice never creates. Without a matching booking it
 *    is refused (`RENTAL_UNKNOWN_BOOKING`) and nothing is written.
 * 3. A mail never overwrites what a person set (`userEditedFields`), never
 *    replaces a value with nothing, and never a richer value with a poorer
 *    one (a time with a bare day, an airport with a name alone).
 */

type Stored = Prisma.RentalBookingGetPayload<object>;

export type ImportOutcome = "created" | "updated" | "unchanged" | "cancelled" | "invoiced";

export class RentalUnknownBookingError extends AppError {
  constructor() {
    super("No rental with this booking number", 404, "RENTAL_UNKNOWN_BOOKING");
    this.name = "RentalUnknownBookingError";
  }
}

async function findBooking(
  userId: string,
  provider: string,
  numbers: { confirmation?: string | null; agreement?: string | null; invoice?: string | null }
): Promise<Stored | null> {
  const or = [
    ...(numbers.confirmation ? [{ confirmationNumber: numbers.confirmation }] : []),
    ...(numbers.agreement ? [{ agreementNumber: numbers.agreement }] : []),
    ...(numbers.invoice ? [{ invoiceNumber: numbers.invoice }] : []),
  ];
  if (or.length === 0) return null;
  return prisma.rentalBooking.findFirst({
    where: { userId, provider: { equals: provider, mode: "insensitive" }, OR: or },
    orderBy: { createdAt: "asc" },
  });
}

const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Whether a mail's value says what the row already holds — so a second import
 * of the same mail is "unchanged", not an update that rewrites nothing.
 */
function sameAsStored(existing: Stored, key: string, value: unknown): boolean {
  if (key === "pickupLocal" || key === "returnLocal") {
    const [time, zone] =
      key === "pickupLocal"
        ? [existing.pickupTime, existing.pickupTimezone]
        : [existing.returnTime, existing.returnTimezone];
    const local = toLocal(time, zone).local;
    return String(value).length === 10
      ? local.startsWith(String(value))
      : local.startsWith(String(value).slice(0, 16));
  }
  if (key === "pickupStation") {
    const airportId = (value as { airportId?: number | null }).airportId ?? null;
    return airportId !== null && airportId === existing.pickupAirportId;
  }
  if (key === "returnStation") {
    const airportId = (value as { airportId?: number | null }).airportId ?? null;
    return airportId !== null && airportId === existing.returnAirportId;
  }
  const stored = (existing as unknown as Record<string, unknown>)[key];
  if (Array.isArray(value) && Array.isArray(stored)) {
    return value.length === stored.length && value.every((v) => stored.includes(v));
  }
  return stored === value;
}

/**
 * The part of a later mail that may change the stored booking. A field is
 * dropped when the user edited it, when the mail says nothing about it, or
 * when the mail's value is poorer than the stored one.
 */
export function mailUpdate(existing: Stored, input: CreateRentalInput): UpdateRentalInput {
  const edited = new Set(existing.userEditedFields);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (edited.has(key) || isEmpty(value)) continue;
    // A mail never revives a cancelled booking or re-opens a finished one.
    if (key === "status") continue;
    // A bare day is poorer than a time (§4.4).
    if (
      key === "pickupLocal" &&
      String(value).length === 10 &&
      existing.pickupPrecision === "minute"
    )
      continue;
    if (
      key === "returnLocal" &&
      String(value).length === 10 &&
      existing.returnPrecision === "minute"
    )
      continue;
    // A station by name alone is poorer than the airport already stored.
    if (
      key === "pickupStation" &&
      existing.pickupAirportId !== null &&
      !(value as { airportId?: number }).airportId
    )
      continue;
    if (sameAsStored(existing, key, value)) continue;
    out[key] = value;
  }
  // "Returned where picked up" (null) never collapses a one-way rental the row already holds.
  if (input.returnStation === null) delete out.returnStation;
  return out as UpdateRentalInput;
}

export async function applyConfirmation(
  userId: string,
  input: CreateRentalInput
): Promise<{ outcome: ImportOutcome; row: RentalRow }> {
  const existing = input.confirmationNumber
    ? await findBooking(userId, input.provider, { confirmation: input.confirmationNumber })
    : null;
  if (!existing) {
    const externalRef = input.confirmationNumber
      ? rentalExternalRef(input.provider, input.confirmationNumber)
      : null;
    return {
      outcome: "created",
      row: await createRentalRow(userId, input, { manual: false, externalRef }),
    };
  }
  const update = mailUpdate(existing, input);
  if (Object.keys(update).length === 0) {
    const row = await prisma.rentalBooking.findUniqueOrThrow({
      where: { id: existing.id },
      include: RENTAL_INCLUDE,
    });
    return { outcome: "unchanged", row };
  }
  return {
    outcome: "updated",
    row: await updateRentalRow(userId, existing, update, { manual: false }),
  };
}

export async function applyCancellation(
  userId: string,
  provider: string,
  confirmationNumber: string
): Promise<{ outcome: ImportOutcome; row: RentalRow }> {
  const existing = await findBooking(userId, provider, { confirmation: confirmationNumber });
  if (!existing) throw new RentalUnknownBookingError();
  // A cancellation sets the status — never a delete (§4.4).
  const row = await updateRentalRow(userId, existing, { status: "cancelled" }, { manual: false });
  return { outcome: "cancelled", row };
}

/**
 * The invoice fills the booking it names (§4.5): driven km (source `invoice`),
 * the car actually driven, the actual times and the amount charged. A km
 * figure the user typed is replaced only when the review showed both and the
 * user chose the invoice's.
 */
export async function applyInvoice(
  userId: string,
  invoice: RentalInvoiceInput,
  replaceUserDistance = false
): Promise<{ outcome: ImportOutcome; row: RentalRow }> {
  const existing = await findBooking(userId, invoice.provider, {
    confirmation: invoice.confirmationNumber,
    agreement: invoice.agreementNumber,
    invoice: invoice.invoiceNumber,
  });
  if (!existing) throw new RentalUnknownBookingError();

  const conflict =
    existing.distanceSource === "user" &&
    invoice.distanceKm !== null &&
    existing.distanceKm !== invoice.distanceKm &&
    !replaceUserDistance;
  if (conflict) {
    throw new AppError(
      `The invoice says ${invoice.distanceKm} km; a typed correction says ${existing.distanceKm} km`,
      409,
      "RENTAL_INVOICE_KM_CONFLICT",
      "distanceKm"
    );
  }

  const times: UpdateRentalInput = {
    ...(invoice.actualPickupLocal ? { actualPickupLocal: invoice.actualPickupLocal } : {}),
    ...(invoice.actualReturnLocal ? { actualReturnLocal: invoice.actualReturnLocal } : {}),
  };
  const finalFx =
    invoice.finalAmount !== null
      ? await finalFxColumns(
          userId,
          invoice.finalAmount,
          invoice.finalCurrency,
          existing.returnTime
        )
      : {};
  const extra: Prisma.RentalBookingUncheckedUpdateInput = {
    ...(invoice.distanceKm !== null && {
      distanceKm: invoice.distanceKm,
      distanceSource: "invoice",
    }),
    ...(invoice.odometerOutKm !== null && { odometerOutKm: invoice.odometerOutKm }),
    ...(invoice.odometerInKm !== null && { odometerInKm: invoice.odometerInKm }),
    ...(invoice.vehicleDriven && { vehicleDriven: invoice.vehicleDriven }),
    ...(invoice.invoiceNumber && { invoiceNumber: invoice.invoiceNumber }),
    ...(invoice.agreementNumber &&
      !existing.agreementNumber && { agreementNumber: invoice.agreementNumber }),
    ...(invoice.finalAmount !== null && {
      finalAmount: invoice.finalAmount,
      finalCurrency: invoice.finalCurrency,
      finalAmountSource: "invoice",
      ...finalFx,
    }),
  };
  const row = await updateRentalRow(userId, existing, times, { manual: false, extra });
  return { outcome: "invoiced", row };
}
