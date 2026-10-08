import { z } from "./zod";
import { createRentalSchema } from "./rental";

/**
 * POST /rentals/import — one reviewed document applied (spec
 * 2026-10-01-rental-domain-design §4.4, §4.5). The review sends back what the
 * parser read, after the user answered what it could not (a station); the
 * server decides create vs update by the booking number, never the client.
 */

/**
 * A wall clock, or only its day: an invoice that prints the return date
 * without an hour is precision `day`, not a midnight nobody stated.
 */
const LOCAL = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const km = z.number().int().min(0).max(1_000_000).nullable();
const number = z.string().trim().min(1).max(60);

export const rentalInvoiceSchema = z.object({
  provider: z.string().trim().min(1).max(100),
  confirmationNumber: number.nullable(),
  agreementNumber: number.nullable(),
  invoiceNumber: number.nullable(),
  odometerOutKm: km,
  odometerInKm: km,
  distanceKm: km,
  vehicleDriven: z.string().trim().max(120).nullable(),
  actualPickupLocal: z.string().regex(LOCAL).nullable(),
  actualReturnLocal: z.string().regex(LOCAL).nullable(),
  finalAmount: z.number().min(0).max(10_000_000).nullable(),
  finalCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
});

/**
 * The mail's own send time, as the parse answered it. Absent or null for
 * pasted text: such a document cannot be ordered against another and is
 * applied as before.
 */
const mailSentAt = z.string().datetime({ offset: true }).nullable().optional();

export const rentalCancellationFeeSchema = z.object({
  amount: z.number().positive().max(10_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const rentalImportSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("confirmation"), input: createRentalSchema, mailSentAt }),
  z.object({
    kind: z.literal("cancellation"),
    provider: z.string().trim().min(1).max(100),
    confirmationNumber: number,
    /** The fee the cancellation bills; stored as the cancelled rental's cost, flagged as a fee. */
    fee: rentalCancellationFeeSchema.nullable().optional(),
    mailSentAt,
  }),
  z.object({
    kind: z.literal("invoice"),
    invoice: rentalInvoiceSchema,
    mailSentAt,
    /**
     * The review showed the invoice's km beside a figure the user typed and
     * the user chose the invoice's (§4.5). Without it a typed figure stands
     * and the import answers 409 with both.
     */
    replaceUserDistance: z.boolean().optional(),
  }),
]);

export type RentalImportInput = z.infer<typeof rentalImportSchema>;
export type RentalInvoiceInput = z.infer<typeof rentalInvoiceSchema>;
export type RentalCancellationFee = z.infer<typeof rentalCancellationFeeSchema>;
