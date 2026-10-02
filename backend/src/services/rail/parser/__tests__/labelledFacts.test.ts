import { operatorIn, referenceIn, totalIn, withLabelledFacts } from "../labelledFacts";
import type { ParsedRailBooking } from "../types";

/** forgejo#161 — booking facts read from their labels, never guessed. */
describe("labelled rail facts", () => {
  it("names the operator once, and abstains when two are named", () => {
    expect(operatorIn("Deutsche Bahn, ICE 578")).toBe("Deutsche Bahn");
    expect(operatorIn("Ihr Nightjet der ÖBB")).toBe("ÖBB");
    expect(operatorIn("Rail&Fly in allen Zügen der Deutschen Bahn")).toBeNull();
    expect(operatorIn("Deutsche Bahn und ÖBB Nightjet")).toBeNull();
  });

  it("copies a labelled reference in German and English, never a word of prose", () => {
    expect(referenceIn("Buchungsnummer: QARAIL20261002")).toBe("QARAIL20261002");
    expect(referenceIn("Booking reference: XK7Q2P")).toBe("XK7Q2P");
    expect(referenceIn("Auftragsnummer 123456789")).toBe("123456789");
    expect(referenceIn("Booking reference: please keep it")).toBeNull();
  });

  it("reads a labelled total only together with its currency", () => {
    expect(totalIn("Gesamtpreis: 59,90 EUR")).toEqual({ price: 59.9, currency: "EUR" });
    expect(totalIn("Total price: £45.50")).toEqual({ price: 45.5, currency: "GBP" });
    expect(totalIn("Total EUR 1.234,50")).toEqual({ price: 1234.5, currency: "EUR" });
    expect(totalIn("Gesamtpreis: 59,90")).toBeNull();
    expect(totalIn("Zwischensumme: 10,00 EUR")).toBeNull();
  });

  it("fills only what is missing", () => {
    const booking: ParsedRailBooking = {
      bookingReference: "KEEP1",
      travelClass: null,
      tariff: null,
      price: 10,
      currency: "CHF",
      operator: null,
      legs: [],
      source: "ollama",
    };
    const text = "Deutsche Bahn\nBuchungsnummer: OTHER2\n1. Klasse\nGesamtpreis: 59,90 EUR";
    expect(withLabelledFacts(booking, text)).toMatchObject({
      bookingReference: "KEEP1",
      travelClass: "first",
      price: 10,
      currency: "CHF",
      operator: "Deutsche Bahn",
    });
  });
});
