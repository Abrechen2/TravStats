import { describe, it, expect } from "@jest/globals";
import { parseAmount, findLabelledTotal, reconcileTotalPrice } from "../documentTotal";

/**
 * Asking the model for "the total price" is not reliable and cannot be made
 * reliable: measured on the owner's Armani confirmation, two identical runs
 * returned 11,662 AED and 9,520 AED — the tax-inclusive total and the bare room
 * rate. Sharpening the wording did not settle it.
 *
 * The document, however, is not ambiguous at all:
 *
 *   Amount:                                    AED 9,520.00
 *   Tax amount excluding Tourism Dirham Fee:   AED 2,142.00
 *   Total amount including all taxes and …:    AED 11,662.00
 *
 * A label followed by a figure is something a regex can prove. So the model
 * keeps proposing, and the document decides.
 */

describe("parseAmount", () => {
  it("reads the English grouping the Armani confirmation prints", () => {
    expect(parseAmount("11,662.00")).toBe(11662);
    expect(parseAmount("9,520.00")).toBe(9520);
  });

  it("reads German grouping", () => {
    expect(parseAmount("1.234,50")).toBe(1234.5);
    expect(parseAmount("11.662,00")).toBe(11662);
  });

  it("decides by the RIGHTMOST separator when both appear", () => {
    // This is the whole trick: 1,234.50 and 1.234,50 are the same money.
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("1.234,50")).toBe(1234.5);
  });

  it("handles a lone separator by what follows it", () => {
    expect(parseAmount("1,50")).toBe(1.5); // two digits -> decimal
    expect(parseAmount("1,500")).toBe(1500); // three digits -> grouping
    expect(parseAmount("89.00")).toBe(89);
    expect(parseAmount("11.662")).toBe(11662);
  });

  it("returns null for what is not an amount", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("N/A")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

const ARMANI = `
Amount:\t AED 9,520.00\t

Tax amount excluding

Tourism Dirham Fee:

AED 2,142.00\t

Total amount including all taxes and excluding Tourism Dirham Fee:\t AED 11,662.00 (excluding Tourism Dirham Fee)\t

The above daily rate is the average rate for the length of stay booked.
Please note that the daily rates displayed reflect the average rate applying
throughout the total number of nights selected.
`;

describe("findLabelledTotal", () => {
  it("finds the tax-inclusive total in a real confirmation", () => {
    expect(findLabelledTotal(ARMANI)).toBe(11662);
  });

  it("is not fooled by the phrase 'total number of nights'", () => {
    // "total" on its own is prose. Only the specific money labels count —
    // otherwise this very document hands back a night count.
    expect(findLabelledTotal("throughout the total number of nights selected, 3 nights")).toBeNull();
  });

  it("reads the German labels", () => {
    expect(findLabelledTotal("Gesamtpreis: 1.234,50 EUR")).toBe(1234.5);
    expect(findLabelledTotal("Gesamtbetrag\t89,00 €")).toBe(89);
    expect(findLabelledTotal("Endpreis  EUR 4.359,14")).toBe(4359.14);
  });

  it("returns null when the document labels no total", () => {
    expect(findLabelledTotal("Zimmerpreis 120,00 EUR pro Nacht")).toBeNull();
  });

  it("ignores a label with no figure anywhere near it", () => {
    expect(findLabelledTotal(`Total amount:\n\n${"filler ".repeat(60)}EUR 99,00`)).toBeNull();
  });
});

describe("reconcileTotalPrice", () => {
  it("lets the document overrule the model", () => {
    // The exact defect: the model returned the room rate.
    expect(reconcileTotalPrice(9520, ARMANI)).toEqual({ value: 11662, source: "document" });
  });

  it("leaves an agreeing value alone", () => {
    expect(reconcileTotalPrice(11662, ARMANI)).toEqual({ value: 11662, source: "model" });
  });

  it("keeps the model's value when the document labels no total", () => {
    expect(reconcileTotalPrice(120, "Zimmerpreis 120,00 EUR")).toEqual({
      value: 120,
      source: "model",
    });
  });

  it("uses the document even when the model found nothing at all", () => {
    expect(reconcileTotalPrice(null, ARMANI)).toEqual({ value: 11662, source: "document" });
  });

  it("has nothing to offer when neither has a figure", () => {
    expect(reconcileTotalPrice(null, "no money here")).toEqual({ value: null, source: "none" });
  });

  it("treats a rounding-level difference as agreement", () => {
    // 11662 vs 11662.00 must not read as a conflict.
    expect(reconcileTotalPrice(11662.004, ARMANI).source).toBe("model");
  });
});

/**
 * REGRESSION, found by the owner on 2026-08-16: a Courtyard confirmation came
 * back as 1 USD.
 *
 * The document says "Gesamtpreis gilt für die von Ihnen gebuchte Anzahl an
 * Gästen (1 Erwachsener)" — a labelled total followed by a GUEST COUNT. The
 * first version of this module took the first digits after the label, read the
 * 1, and — because the document outranks the model — wrote it over a correct
 * $135.87. A fix that replaces a right number with a wrong one is worse than
 * the defect it was written for.
 */
const COURTYARD = `
Zimmerpreis	$118,15
Steuern und Gebühren	$17,72
Gesamtpreis	$135,87

Der Gesamtpreis gilt für die von Ihnen gebuchte Anzahl an Gästen (1 Erwachsener).
Frühstück $15 pro Person, pro Nacht.
`;

describe("findLabelledTotal — a count is not an amount", () => {
  it("skips the guest count and takes the money", () => {
    expect(findLabelledTotal(COURTYARD)).toBe(135.87);
  });

  it("ignores a bare integer that names people, not money", () => {
    expect(findLabelledTotal("Gesamtpreis gilt für 2 Erwachsene")).toBeNull();
  });

  it("accepts a bare integer once it carries a currency", () => {
    expect(findLabelledTotal("Total amount: USD 65")).toBe(65);
    expect(findLabelledTotal("Gesamtpreis 65 EUR")).toBe(65);
  });

  it("accepts a decimal amount without any currency marker", () => {
    expect(findLabelledTotal("Gesamtpreis 135,87")).toBe(135.87);
  });
});
