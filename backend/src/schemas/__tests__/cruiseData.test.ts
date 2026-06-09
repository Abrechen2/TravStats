import { describe, it, expect } from "@jest/globals";
import { cruiseDataSchema } from "../cruiseData";

describe("cruiseDataSchema", () => {
  it("accepts empty object (everything optional)", () => {
    expect(cruiseDataSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a fully-populated payload", () => {
    const result = cruiseDataSchema.safeParse({
      shipName: "AIDAnova",
      cruiseLine: "AIDA Cruises",
      startDate: "2026-06-01",
      endDate: "2026-06-08",
      departurePortName: "Barcelona",
      arrivalPortName: "Barcelona",
      cabinNumber: "7218",
      cabinType: "balcony",
      deck: 7,
      bookingReference: "AIDA-XYZ",
      price: 1299.99,
      currency: "EUR",
      stops: [
        { portName: "Barcelona", portCountry: "Spain", dayNumber: 1, isAtSea: false },
        { dayNumber: 2, isAtSea: true },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid cabinType", () => {
    const r = cruiseDataSchema.safeParse({ cabinType: "penthouse" });
    expect(r.success).toBe(false);
  });
});
