import { z } from "./zod";
import { createRentalSchema } from "./rental";

/**
 * POST /rentals/import — one reviewed document applied (spec
 * 2026-10-01-rental-domain-design §4.4, §4.5). The review sends back what the
 * parser read, after the user answered what it could not (a station); the
 * server decides create vs update by the booking number, never the client.
 */

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
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

export const rentalImportSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("confirmation"), input: createRentalSchema }),
  z.object({
    kind: z.literal("cancellation"),
    provider: z.string().trim().min(1).max(100),
    confirmationNumber: number,
  }),
  z.object({
    kind: z.literal("invoice"),
    invoice: rentalInvoiceSchema,
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
