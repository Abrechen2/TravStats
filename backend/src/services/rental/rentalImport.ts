import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import type { CreateRentalInput, UpdateRentalInput } from "../../schemas/rental";
import type {
  RentalCancellationFee,
  RentalInvoiceInput,
  RentalInvoicePart,
} from "../../schemas/rentalImport";
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
 * 4. Of two dated mails of one booking the NEWER one's data stands, whatever
 *    order they are imported in (`lastMailSentAt`): an older mail only fills
 *    what is still empty, and an older cancellation does not cancel. A mail
 *    without a send time (pasted text) cannot be ordered and applies as before.
 */

type Stored = Prisma.RentalBookingGetPayload<object>;

/** `stale`: an older mail than the newest one applied, with nothing left for it to fill. */
export type ImportOutcome =
  "created" | "updated" | "unchanged" | "stale" | "cancelled" | "invoiced";

/** True when this mail was sent before the newest mail already applied to the row. */
export function isOlderMail(
  existing: { lastMailSentAt: Date | null },
  sentAt: Date | null
): boolean {
  return (
    sentAt !== null &&
    existing.lastMailSentAt !== null &&
    sentAt.getTime() < existing.lastMailSentAt.getTime()
  );
}

/** The newest send time once this mail is applied — never moved backwards. */
function newestMail(existing: { lastMailSentAt: Date | null }, sentAt: Date | null): Date | null {
  if (sentAt === null) return existing.lastMailSentAt;
  return existing.lastMailSentAt && existing.lastMailSentAt > sentAt
    ? existing.lastMailSentAt
    : sentAt;
}

/** Keys that always hold a value, so an older mail has nothing to fill there. */
const ALWAYS_SET = new Set(["pickupLocal", "returnLocal", "pickupStation", "returnStation"]);

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

/** What an OLDER mail may still write: only fields the row holds nothing for. */
function onlyGaps(existing: Stored, update: UpdateRentalInput): UpdateRentalInput {
  const stored = existing as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(update).filter(([key]) => !ALWAYS_SET.has(key) && isEmpty(stored[key]))
  ) as UpdateRentalInput;
}

export async function applyConfirmation(
  userId: string,
  input: CreateRentalInput,
  sentAt: Date | null = null
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
      row: await createRentalRow(userId, input, {
        manual: false,
        externalRef,
        mailSentAt: sentAt,
      }),
    };
  }
  const older = isOlderMail(existing, sentAt);
  const full = mailUpdate(existing, input);
  const update = older ? onlyGaps(existing, full) : full;
  const lastMailSentAt = newestMail(existing, sentAt);
  if (Object.keys(update).length === 0) {
    // Nothing to write but, perhaps, a newer mark — a repeat import rewrites nothing.
    const markMoved = lastMailSentAt?.getTime() !== existing.lastMailSentAt?.getTime();
    const row = markMoved
      ? await prisma.rentalBooking.update({
          where: { id: existing.id },
          data: { lastMailSentAt },
          include: RENTAL_INCLUDE,
        })
      : await prisma.rentalBooking.findUniqueOrThrow({
          where: { id: existing.id },
          include: RENTAL_INCLUDE,
        });
    return { outcome: older && Object.keys(full).length > 0 ? "stale" : "unchanged", row };
  }
  return {
    outcome: "updated",
    row: await updateRentalRow(userId, existing, update, {
      manual: false,
      extra: { lastMailSentAt },
    }),
  };
}

export async function applyCancellation(
  userId: string,
  provider: string,
  confirmationNumber: string,
  fee: RentalCancellationFee | null = null,
  sentAt: Date | null = null
): Promise<{ outcome: ImportOutcome; row: RentalRow }> {
  const existing = await findBooking(userId, provider, { confirmation: confirmationNumber });
  if (!existing) throw new RentalUnknownBookingError();
  // A confirmation sent AFTER this cancellation is the newer word on the booking.
  if (isOlderMail(existing, sentAt)) {
    const row = await prisma.rentalBooking.findUniqueOrThrow({
      where: { id: existing.id },
      include: RENTAL_INCLUDE,
    });
    return { outcome: "stale", row };
  }
  // The fee is the cancelled rental's cost, flagged as a fee — but never
  // over an amount an invoice or the user already set.
  const keepsAmount =
    existing.finalAmountSource === "invoice" || existing.finalAmountSource === "user";
  const feeColumns: Prisma.RentalBookingUncheckedUpdateInput =
    fee && !keepsAmount
      ? {
          finalAmount: fee.amount,
          finalCurrency: fee.currency,
          finalAmountSource: "cancellationFee",
          ...(await finalFxColumns(userId, fee.amount, fee.currency, existing.pickupTime)),
        }
      : {};
  // A cancellation sets the status — never a delete (§4.4).
  const row = await updateRentalRow(
    userId,
    existing,
    { status: "cancelled" },
    { manual: false, extra: { ...feeColumns, lastMailSentAt: newestMail(existing, sentAt) } }
  );
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
  replaceUserDistance = false,
  sentAt: Date | null = null,
  adopt: Partial<Record<RentalInvoicePart, boolean>> = {}
): Promise<{ outcome: ImportOutcome; row: RentalRow }> {
  // A part the review did not untick is taken (absent = taken, as before).
  const takes = (part: RentalInvoicePart): boolean => adopt[part] !== false;
  const existing = await findBooking(userId, invoice.provider, {
    confirmation: invoice.confirmationNumber,
    agreement: invoice.agreementNumber,
    invoice: invoice.invoiceNumber,
  });
  if (!existing) throw new RentalUnknownBookingError();

  const conflict =
    takes("distance") &&
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

  const times: UpdateRentalInput = takes("actualTimes")
    ? {
        ...(invoice.actualPickupLocal ? { actualPickupLocal: invoice.actualPickupLocal } : {}),
        ...(invoice.actualReturnLocal ? { actualReturnLocal: invoice.actualReturnLocal } : {}),
      }
    : {};
  const finalFx =
    takes("finalAmount") && invoice.finalAmount !== null
      ? await finalFxColumns(
          userId,
          invoice.finalAmount,
          invoice.finalCurrency,
          existing.returnTime
        )
      : {};
  // The invoice is the final word on what it carries (§4.5) whenever it
  // arrives; its send time only moves the newest-mail mark forward.
  const extra: Prisma.RentalBookingUncheckedUpdateInput = {
    lastMailSentAt: newestMail(existing, sentAt),
    ...(takes("distance") &&
      invoice.distanceKm !== null && {
        distanceKm: invoice.distanceKm,
        distanceSource: "invoice",
      }),
    ...(takes("odometer") &&
      invoice.odometerOutKm !== null && { odometerOutKm: invoice.odometerOutKm }),
    ...(takes("odometer") &&
      invoice.odometerInKm !== null && { odometerInKm: invoice.odometerInKm }),
    ...(takes("vehicleDriven") &&
      invoice.vehicleDriven && { vehicleDriven: invoice.vehicleDriven }),
    ...(invoice.invoiceNumber && { invoiceNumber: invoice.invoiceNumber }),
    ...(invoice.agreementNumber &&
      !existing.agreementNumber && { agreementNumber: invoice.agreementNumber }),
    // The booked price is never touched: the booking's amount and where it
    // came from stay beside the invoice's (forgejo#237).
    ...(takes("finalAmount") &&
      invoice.finalAmount !== null && {
        finalAmount: invoice.finalAmount,
        finalCurrency: invoice.finalCurrency,
        finalAmountSource: "invoice",
        ...finalFx,
      }),
  };
  const row = await updateRentalRow(userId, existing, times, { manual: false, extra });
  return { outcome: "invoiced", row };
}
