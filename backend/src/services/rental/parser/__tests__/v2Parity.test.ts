import {
  snapshotStatus,
  snapshotTemplates,
} from "../../../parsers/templates/v2/__tests__/snapshotTemplates";
import type { TemplateTestInput } from "../../../parsers/templates/v2/envelope";
import {
  SIXT_INVOICE_ONE_CAR,
  SIXT_INVOICE_SWAP,
  SIXT_LAYOUT_A,
  SIXT_LAYOUT_B,
} from "./sixtFixtures";
import { legacyConfirmation, legacyInvoice, v2Confirmation, v2Invoice } from "./readers";
import type { ParsedRentalInvoice } from "../types";

/**
 * Plan 2026-10-09 P4b: the Sixt readers became v2 template files. This is the
 * proof nothing was lost in the move — every fixture of the old suites and
 * every test input of the two files, read by the old reader and by the file,
 * gives the same document, field for field (or the same "no").
 */
const asMail = (input: TemplateTestInput): { text: string; subject?: string; from?: string } =>
  typeof input === "string" ? { text: input } : input;

/** How `parseRentalBookingText` handed the old readers a mail: subject, blank line, body. */
const combined = (mail: { text: string; subject?: string }): string =>
  mail.subject ? `${mail.subject}\n\n${mail.text}` : mail.text;

const withoutFees = (
  read: ParsedRentalInvoice | null
): Omit<ParsedRentalInvoice, "fees"> | null => {
  if (!read) return null;
  const { fees: _fees, ...rest } = read;
  return rest;
};

const CONFIRMATIONS: Array<[string, string, string | undefined]> = [
  ["layout A", SIXT_LAYOUT_A, "reservation@e.sixt.com"],
  ["layout B", SIXT_LAYOUT_B, "buchung@sixt.com"],
  ["layout A without a sender", SIXT_LAYOUT_A, undefined],
  ["an offer", "Sommerangebote bei SIXT", "news@e.sixt.com"],
  [
    "unreadable dates",
    SIXT_LAYOUT_A.replace("Montag, 06. Jul, 2026 um 09:15", "bald"),
    "reservation@e.sixt.com",
  ],
  ["an invoice", SIXT_INVOICE_ONE_CAR, "noreply@sixt.com"],
];

const INVOICES: Array<[string, string, string | undefined]> = [
  ["one car", SIXT_INVOICE_ONE_CAR, "Ihre Rechnung 1111222233334444 für die Miete 9876543210"],
  ["a swap", SIXT_INVOICE_SWAP, undefined],
  [
    "km that do not add up",
    SIXT_INVOICE_ONE_CAR.replace("10000 10412 412", "10000 10412 999"),
    undefined,
  ],
  ["a confirmation", SIXT_LAYOUT_A, undefined],
];

describe("rental templates — legacy reader and v2 file agree", () => {
  it("the snapshot activates both Sixt files and rejects none", () => {
    const status = snapshotStatus("rental");
    expect(status.filter((t) => t.state !== "active")).toEqual([]);
    expect(status.map((t) => t.id).sort()).toEqual([
      "rental:sixt-confirmation",
      "rental:sixt-invoice",
    ]);
  });

  it.each(CONFIRMATIONS)("confirmation fixture: %s", (_name, text, from) => {
    expect(v2Confirmation(text, from)).toEqual(legacyConfirmation(text, from));
  });

  it.each(INVOICES)("invoice fixture: %s", (_name, text, subject) => {
    const body = subject ? `${subject}\n\n${text}` : text;
    expect(v2Invoice(text, subject)).toEqual(legacyInvoice(body, subject));
  });

  const cases = snapshotTemplates("rental").flatMap((t) =>
    t.testCases.map((c) => [t.id, c.name, asMail(c.input)] as const)
  );

  it.each(cases)("%s — %s", (id, _name, mail) => {
    if (id === "rental:sixt-invoice") {
      // Fee lines are new in the file (forgejo#237); the compiled reader never
      // read them, so they are compared apart, below.
      expect(withoutFees(v2Invoice(combined(mail), mail.subject))).toEqual(
        withoutFees(legacyInvoice(combined(mail), mail.subject))
      );
    } else {
      expect(v2Confirmation(combined(mail), mail.from)).toEqual(
        legacyConfirmation(combined(mail), mail.from)
      );
    }
  });
});
