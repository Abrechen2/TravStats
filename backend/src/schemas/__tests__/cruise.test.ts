import { describe, it, expect } from "@jest/globals";
import { createCruiseSchema, updateCruiseSchema, cruiseQuerySchema } from "../cruise";

describe("cruise schemas", () => {
  const minimalValid = { status: "scheduled" as const };

  it("accepts a minimal cruise", () => {
    expect(createCruiseSchema.safeParse(minimalValid).success).toBe(true);
  });

  it("accepts a full cruise with stops", () => {
    const result = createCruiseSchema.safeParse({
      shipId: 42,
      cruiseLine: "AIDA Cruises",
      departurePortId: 1,
      arrivalPortId: 1,
      startDate: "2026-06-01T12:00:00Z",
      endDate: "2026-06-08T09:00:00Z",
      status: "scheduled",
      cabinNumber: "7218",
      cabinType: "balcony",
      deck: 7,
      bookingReference: "AIDA-XYZ",
      price: 1299.99,
      currency: "EUR",
      tags: ["family"],
      companions: ["Alice"],
      stops: [
        {
          portId: 1,
          dayNumber: 1,
          isAtSea: false,
          arrivalTime: "2026-06-01T12:00:00Z",
          departureTime: "2026-06-01T18:00:00Z",
        },
        { portId: null, dayNumber: 2, isAtSea: true },
        {
          portId: 2,
          dayNumber: 3,
          isAtSea: false,
          arrivalTime: "2026-06-03T07:00:00Z",
          departureTime: "2026-06-03T19:00:00Z",
          excursionNote: "City tour",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("refuses in_progress on the write path although the list filter accepts it", () => {
    // `in_progress` is derived from the dates by the write path and the status
    // sweep; a client may ASK for it (CRUISE_QUERY_STATUSES) but never store it.
    expect(createCruiseSchema.safeParse({ ...minimalValid, status: "in_progress" }).success).toBe(
      false
    );
    expect(updateCruiseSchema.safeParse({ status: "in_progress" }).success).toBe(false);
    expect(cruiseQuerySchema.safeParse({ status: "in_progress" }).success).toBe(true);
  });

  it("rejects invalid cabinType", () => {
    expect(createCruiseSchema.safeParse({ ...minimalValid, cabinType: "penthouse" }).success).toBe(
      false
    );
  });

  it("rejects negative price", () => {
    expect(createCruiseSchema.safeParse({ ...minimalValid, price: -1 }).success).toBe(false);
  });

  it("rejects dayNumber < 1", () => {
    const r = createCruiseSchema.safeParse({
      ...minimalValid,
      stops: [{ dayNumber: 0, isAtSea: true }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects stop that is neither atSea nor has a portId", () => {
    const r = createCruiseSchema.safeParse({
      ...minimalValid,
      stops: [{ dayNumber: 1, isAtSea: false, portId: null }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects endDate before startDate", () => {
    const r = createCruiseSchema.safeParse({
      ...minimalValid,
      startDate: "2026-06-10T00:00:00Z",
      endDate: "2026-06-01T00:00:00Z",
    });
    expect(r.success).toBe(false);
  });

  it("keeps a parser's offset-less stop time as the port's wall clock, never the host's (ADR 0002)", () => {
    // The LLM cruise parser emits "2026-06-17T08:00". It used to be parsed with
    // `new Date(v)`, so the SERVER's zone decided the instant. It is now kept
    // as a wall clock for the route to read on the port's clock — and the
    // route accepts that bare string from a token client (the Companion relays
    // it) only; a browser sends `{local}`.
    const r = createCruiseSchema.safeParse({
      ...minimalValid,
      startDate: "2026-06-15",
      endDate: "2026-06-29",
      stops: [
        { portId: 1, dayNumber: 1, isAtSea: false, departureTime: "2026-06-15T00:00" },
        { portId: null, dayNumber: 2, isAtSea: true },
        { portId: 2, dayNumber: 3, isAtSea: false, arrivalTime: { local: "2026-06-17T08:00" } },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.stops?.[0].departureTime).toEqual({
        kind: "wallClockString",
        local: "2026-06-15T00:00",
      });
      expect(r.data.stops?.[2].arrivalTime).toEqual({ kind: "local", local: "2026-06-17T08:00" });
      // A day is a day: UTC midnight of the date written, whatever the host.
      expect(r.data.startDate).toBe("2026-06-15T00:00:00.000Z");
    }
  });

  it("refuses an offset-less datetime for a cruise DAY with TIME_SHAPE_REQUIRED", () => {
    const r = createCruiseSchema.safeParse({ ...minimalValid, endDate: "2026-06-29T00:00" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message)).toContain("TIME_SHAPE_REQUIRED");
    }
  });

  it("accepts a date-only stop date and coerces it to UTC midnight (#132)", () => {
    const r = createCruiseSchema.safeParse({
      ...minimalValid,
      stops: [
        { portId: 1, dayNumber: 1, isAtSea: false, date: "2027-10-08" },
        { portId: null, dayNumber: 2, isAtSea: true, date: "2027-10-09" },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.stops?.[0].date).toBe("2027-10-08T00:00:00.000Z");
      expect(r.data.stops?.[1].date).toBe("2027-10-09T00:00:00.000Z");
    }
  });

  // CONTRACT CHANGE 2026-08-02: "" collapses to null (an explicit clear on
  // update), no longer to undefined — undefined told the update handler to
  // keep the old value, which made blanking the field a silent no-op.
  it("accepts routeName; the empty string collapses to null, absent stays undefined (#133)", () => {
    const withName = createCruiseSchema.safeParse({
      ...minimalValid,
      routeName: "Kanaren mit Marokko",
    });
    expect(withName.success).toBe(true);
    if (withName.success) expect(withName.data.routeName).toBe("Kanaren mit Marokko");

    const empty = createCruiseSchema.safeParse({ ...minimalValid, routeName: "" });
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.routeName).toBeNull();

    const absent = createCruiseSchema.safeParse({ ...minimalValid });
    expect(absent.success).toBe(true);
    if (absent.success) expect(absent.data.routeName).toBeUndefined();
  });

  it("still rejects a genuinely unparseable datetime", () => {
    const r = createCruiseSchema.safeParse({
      ...minimalValid,
      stops: [{ portId: 1, dayNumber: 1, isAtSea: false, arrivalTime: "not-a-date" }],
    });
    expect(r.success).toBe(false);
  });

  it("updateCruiseSchema requires at least one field", () => {
    expect(updateCruiseSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a valid hex color with or without the leading #", () => {
    const withHash = createCruiseSchema.safeParse({ ...minimalValid, color: "#e88374" });
    expect(withHash.success).toBe(true);
    if (withHash.success) expect(withHash.data.color).toBe("#e88374");

    const withoutHash = createCruiseSchema.safeParse({ ...minimalValid, color: "e88374" });
    expect(withoutHash.success).toBe(true);
  });

  it("accepts an explicit null color (clears back to auto-derived)", () => {
    const r = updateCruiseSchema.safeParse({ color: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.color).toBeNull();
  });

  it("rejects an invalid hex color", () => {
    expect(createCruiseSchema.safeParse({ ...minimalValid, color: "not-a-color" }).success).toBe(
      false
    );
    expect(createCruiseSchema.safeParse({ ...minimalValid, color: "#ff00" }).success).toBe(false);
  });

  it("cruiseQuerySchema accepts line filter", () => {
    expect(cruiseQuerySchema.safeParse({ cruiseLine: "AIDA" }).success).toBe(true);
  });
});

describe("stop 3-state invariant", () => {
  const withStop = (stop: Record<string, unknown>) =>
    createCruiseSchema.safeParse({ stops: [{ dayNumber: 1, ...stop }] });

  it("accepts a matched port", () => {
    expect(withStop({ portId: 5, isAtSea: false }).success).toBe(true);
  });

  it("accepts a sea day", () => {
    expect(withStop({ isAtSea: true }).success).toBe(true);
  });

  it("accepts an unresolved port", () => {
    expect(withStop({ isAtSea: false, unresolvedPortName: "Taranto" }).success).toBe(true);
  });

  it("rejects an empty stop (no port, not at sea, no unresolved name)", () => {
    expect(withStop({ isAtSea: false }).success).toBe(false);
  });

  it("rejects portId together with unresolvedPortName", () => {
    expect(withStop({ portId: 5, isAtSea: false, unresolvedPortName: "X" }).success).toBe(false);
  });

  it("rejects a sea day carrying an unresolved name", () => {
    expect(withStop({ isAtSea: true, unresolvedPortName: "X" }).success).toBe(false);
  });

  it("rejects a whitespace-only unresolved name", () => {
    expect(withStop({ isAtSea: false, unresolvedPortName: "   " }).success).toBe(false);
  });
});
