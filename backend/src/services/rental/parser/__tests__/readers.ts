/**
 * The two ways a Sixt document can be read, for tests that must hold for
 * both: the compiled-in reader it started as (`legacy/`) and the v2 template
 * FILE it became (plan 2026-10-09 P4b), loaded from the bundled snapshot.
 */
import { snapshotTemplate } from "../../../parsers/templates/v2/__tests__/snapshotTemplates";
import { applyV2RentalTemplate } from "../v2Rental";
import type { ParsedRentalConfirmation, ParsedRentalInvoice } from "../types";
import { parseSixtConfirmation } from "./legacy/sixtConfirmation";
import { parseSixtInvoice } from "./legacy/sixtInvoice";

export type ConfirmationReader = (
  text: string,
  from?: string | null
) => ParsedRentalConfirmation | null;
export type InvoiceReader = (text: string, subject?: string | null) => ParsedRentalInvoice | null;

export const v2Confirmation: ConfirmationReader = (text, from) =>
  applyV2RentalTemplate(snapshotTemplate("rental:sixt-confirmation"), {
    text,
    ...(from ? { from } : {}),
  }) as ParsedRentalConfirmation | null;

export const v2Invoice: InvoiceReader = (text, subject) =>
  applyV2RentalTemplate(snapshotTemplate("rental:sixt-invoice"), {
    text,
    ...(subject ? { subject } : {}),
  }) as ParsedRentalInvoice | null;

export const CONFIRMATION_READERS: Array<[string, ConfirmationReader]> = [
  ["legacy reader", parseSixtConfirmation],
  ["v2 template", v2Confirmation],
];

export const INVOICE_READERS: Array<[string, InvoiceReader]> = [
  ["legacy reader", parseSixtInvoice],
  ["v2 template", v2Invoice],
];

export { parseSixtConfirmation as legacyConfirmation, parseSixtInvoice as legacyInvoice };
