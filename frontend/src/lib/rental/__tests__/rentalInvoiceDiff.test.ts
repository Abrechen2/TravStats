import { describe, expect, it } from "vitest";
import { invoiceDifference, rentalInvoiceDiff } from "../rentalInvoiceDiff";
import { makeRental } from "../../../components/rental/__tests__/rentalFixture";
import type { RentalInvoiceReading } from "../../../types/rental";

const fmt = {
  money: (m: { amount: number; currency: string }) => `${m.amount} ${m.currency}`,
  km: (km: number) => `${km} km`,
  time: (local: string) => local,
};
const invoice: RentalInvoiceReading = {
  provider: "Testcar",
  confirmationNumber: "1",
  agreementNumber: null,
  invoiceNumber: null,
  odometerOutKm: 100,
  odometerInKm: 512,
  distanceKm: 412,
  vehicleDriven: "Opel Corsa",
  actualPickupLocal: null,
  actualReturnLocal: "2026-07-05T09:40",
  finalAmount: 150,
  finalCurrency: "EUR",
};

describe("rentalInvoiceDiff (forgejo#237)", () => {
  it("lists each reading the invoice carries against what the rental holds", () => {
    const rows = rentalInvoiceDiff(makeRental({ vehicleDriven: "Opel Corsa" }), invoice, fmt);
    expect(rows.map((r) => r.part)).toEqual([
      "finalAmount",
      "vehicleDriven",
      "odometer",
      "distance",
      "actualTimes",
    ]);
    expect(rows.find((r) => r.part === "vehicleDriven")?.same).toBe(true);
    expect(rows.find((r) => r.part === "finalAmount")).toMatchObject({
      current: null,
      incoming: "150 EUR",
      same: false,
    });
    expect(rows.find((r) => r.part === "odometer")?.incoming).toBe("100 km → 512 km");
  });

  it("makes no row for a reading the invoice does not carry", () => {
    const rows = rentalInvoiceDiff(makeRental(), { ...invoice, vehicleDriven: null }, fmt);
    expect(rows.some((r) => r.part === "vehicleDriven")).toBe(false);
  });

  it("names the difference to the booked price in one currency only", () => {
    expect(invoiceDifference(makeRental({ price: 120, currency: "EUR" }), invoice)).toEqual({
      amount: 30,
      currency: "EUR",
    });
    expect(invoiceDifference(makeRental({ price: 120, currency: "USD" }), invoice)).toBeNull();
  });
});
