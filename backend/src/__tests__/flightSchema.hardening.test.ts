/**
 * Schema hardening for v1.5.0-rc.3 — locks in the validation gaps that
 * Norberts UAT (issue #99) surfaced:
 *  - chronological order applies to ALL statuses, not just flown/scheduled
 *  - historical / flown can't have a future departureLocal
 *  - the same chronological refine now applies to update payloads too
 */
import { createFlightSchema, updateFlightSchema } from "../schemas/flight";

const baseValid = {
  departure: { iata: "MUC", icao: "EDDM", name: "Munich", lat: 48.35, lon: 11.78 },
  arrival: { iata: "FCO", icao: "LIRF", name: "Rome", lat: 41.8, lon: 12.25 },
  departureLocal: "2024-06-15T09:30:00",
  depTimezone: "Europe/Berlin",
  arrivalLocal: "2024-06-15T11:15:00",
  arrTimezone: "Europe/Rome",
  status: "flown" as const,
};

describe("createFlightSchema — chronological order applies to historicals (G1)", () => {
  it("rejects historical with arrivalLocal before departureLocal", () => {
    const r = createFlightSchema.safeParse({
      ...baseValid,
      status: "historical",
      departureLocal: "1986-03-02T05:00:00",
      arrivalLocal: "1986-03-01T20:53:00",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /arrivalLocal must not precede/.test(i.message))).toBe(true);
    }
  });

  it("still accepts a historical row with NULL arrivalLocal (legitimate date-only import)", () => {
    const r = createFlightSchema.safeParse({
      ...baseValid,
      status: "historical",
      arrivalLocal: undefined,
      arrTimezone: undefined,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a historical row where dep ≤ arr", () => {
    const r = createFlightSchema.safeParse({
      ...baseValid,
      status: "historical",
      departureLocal: "1986-03-02T05:00:00",
      arrivalLocal: "1986-03-02T13:53:00",
    });
    expect(r.success).toBe(true);
  });
});

describe("createFlightSchema — year-axis sanity (G2/G3)", () => {
  it("rejects historical with a future departureLocal", () => {
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 19);
    const r = createFlightSchema.safeParse({
      ...baseValid,
      status: "historical",
      departureLocal: future,
      arrivalLocal: undefined,
      arrTimezone: undefined,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) => /historical flights cannot have a departureLocal in the future/.test(i.message)),
      ).toBe(true);
    }
  });

  it("rejects flown with a future departureLocal", () => {
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 19);
    const r = createFlightSchema.safeParse({
      ...baseValid,
      status: "flown",
      departureLocal: future,
      arrivalLocal: future.replace("T09", "T11"),
    });
    expect(r.success).toBe(false);
  });

  it("accepts scheduled with a future departureLocal (the normal case)", () => {
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 19);
    const r = createFlightSchema.safeParse({
      ...baseValid,
      status: "scheduled",
      departureLocal: future,
      arrivalLocal: future.replace("T09", "T11"),
    });
    expect(r.success).toBe(true);
  });

  it("accepts scheduled with a past departureLocal (G4 — soft warn at handler, schema allows)", () => {
    const r = createFlightSchema.safeParse({
      ...baseValid,
      status: "scheduled",
    });
    expect(r.success).toBe(true);
  });
});

describe("updateFlightSchema — chronological refine now applies (G5)", () => {
  it("rejects an update that would make arr precede dep", () => {
    const r = updateFlightSchema.safeParse({
      departureLocal: "2024-06-15T11:00:00",
      depTimezone: "Europe/Berlin",
      arrivalLocal: "2024-06-15T09:00:00",
      arrTimezone: "Europe/Rome",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /arrivalLocal must not precede/.test(i.message))).toBe(true);
    }
  });

  it("allows an update that touches only one of dep/arr (no chronological check possible)", () => {
    const r = updateFlightSchema.safeParse({
      departureLocal: "2024-06-15T11:00:00",
      depTimezone: "Europe/Berlin",
    });
    expect(r.success).toBe(true);
  });

  it("rejects historical update with future departureLocal", () => {
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 19);
    const r = updateFlightSchema.safeParse({
      status: "historical",
      departureLocal: future,
    });
    expect(r.success).toBe(false);
  });
});
